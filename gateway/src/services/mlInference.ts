import { Config, MaskResponse } from "../config";
import {
  mlInferenceCalls,
  regexFallbackTotal,
  circuitBreakerOpen,
  pipelineStageDuration,
} from "../metrics";
import { regexMaskPii, verifyStructuralSafety } from "../fallback/regexPii";

export class MlInferenceError extends Error {
  constructor(
    message: string,
    public readonly recoverable: boolean,
  ) {
    super(message);
    this.name = "MlInferenceError";
  }
}

export async function callMlInference(
  config: Config,
  text: string,
): Promise<MaskResponse> {
  const endTimer = pipelineStageDuration.startTimer({ stage: "ml_inference" });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.mlTimeoutMs);

    const response = await fetch(`${config.mlInferenceUrl}/mask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      mlInferenceCalls.inc({ status: "error" });
      throw new MlInferenceError(`ML service returned ${response.status}`, true);
    }

    const result = (await response.json()) as MaskResponse;
    mlInferenceCalls.inc({ status: "success" });
    return result;
  } catch (error) {
    mlInferenceCalls.inc({ status: "timeout" });
    throw new MlInferenceError(
      error instanceof Error ? error.message : "ML inference failed",
      true,
    );
  } finally {
    endTimer();
  }
}

export async function maskWithFallback(
  config: Config,
  text: string,
): Promise<{ maskedText: string; mapping: Record<string, string>; engine: string; entitiesFound: number }> {
  try {
    const result = await callMlInference(config, text);
    return {
      maskedText: result.masked_text,
      mapping: result.mapping,
      engine: result.engine,
      entitiesFound: result.entities_found,
    };
  } catch {
    regexFallbackTotal.inc();
    const fallback = regexMaskPii(text);

    if (!verifyStructuralSafety(fallback.maskedText)) {
      circuitBreakerOpen.inc();
      throw new MlInferenceError(
        "ML service unavailable and regex fallback failed structural verification",
        false,
      );
    }

    return {
      maskedText: fallback.maskedText,
      mapping: fallback.mapping,
      engine: "regex_fallback",
      entitiesFound: fallback.entitiesFound,
    };
  }
}

export async function maskAllMessages(
  config: Config,
  messages: Array<{ role: string; content: string }>,
): Promise<{
  maskedMessages: Array<{ role: string; content: string }>;
  mapping: Record<string, string>;
  engine: string;
  entitiesFound: number;
}> {
  const combinedMapping: Record<string, string> = {};
  let totalEntities = 0;
  let engine = "presidio+hf_ner";

  const maskedMessages = [];
  for (const msg of messages) {
    const result = await maskWithFallback(config, msg.content);
    Object.assign(combinedMapping, result.mapping);
    totalEntities += result.entitiesFound;
    if (result.engine === "regex_fallback") engine = "regex_fallback";
    maskedMessages.push({ role: msg.role, content: result.maskedText });
  }

  return {
    maskedMessages,
    mapping: combinedMapping,
    engine,
    entitiesFound: totalEntities,
  };
}
