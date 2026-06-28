import { Config } from "../config";
import { pipelineStageDuration } from "../metrics";

export async function forwardToOpenAI(
  config: Config,
  body: Record<string, unknown>,
): Promise<{ response: unknown; statusCode: number; latencyMs: number }> {
  const endTimer = pipelineStageDuration.startTimer({ stage: "openai" });

  try {
    const start = performance.now();
    const response = await fetch(`${config.openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.openaiApiKey}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    const latencyMs = performance.now() - start;

    return {
      response: data,
      statusCode: response.status,
      latencyMs,
    };
  } finally {
    endTimer();
  }
}

export function rehydrateResponse(
  response: Record<string, unknown>,
  mapping: Record<string, string>,
): Record<string, unknown> {
  const rehydrated = JSON.parse(JSON.stringify(response)) as Record<string, unknown>;

  function replaceInValue(value: unknown): unknown {
    if (typeof value === "string") {
      let result = value;
      const sortedKeys = Object.keys(mapping).sort((a, b) => b.length - a.length);
      for (const key of sortedKeys) {
        result = result.split(key).join(mapping[key]);
      }
      return result;
    }
    if (Array.isArray(value)) {
      return value.map(replaceInValue);
    }
    if (value !== null && typeof value === "object") {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        obj[k] = replaceInValue(v);
      }
      return obj;
    }
    return value;
  }

  return replaceInValue(rehydrated) as Record<string, unknown>;
}
