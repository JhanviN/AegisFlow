import { v4 as uuidv4 } from "uuid";

interface ChatMessage {
  role: string;
  content: string;
}

export function buildMockCompletion(body: Record<string, unknown>): Record<string, unknown> {
  const messages = (body.messages as ChatMessage[] | undefined) ?? [];
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const sanitizedPrompt = lastUser?.content ?? "";
  const model = (body.model as string) ?? "gpt-4o-mini";

  const content = sanitizedPrompt
    ? `[AegisFlow Compliance Mock] Processed sanitized prompt through the full proxy pipeline. ` +
      `PII was masked before this simulated LLM call and will be rehydrated in the response. ` +
      `Sanitized input: "${sanitizedPrompt.slice(0, 500)}${sanitizedPrompt.length > 500 ? "…" : ""}"`
    : "[AegisFlow Compliance Mock] No user message received.";

  const promptTokens = Math.max(1, Math.ceil(sanitizedPrompt.length / 4));
  const completionTokens = Math.max(1, Math.ceil(content.length / 4));

  return {
    id: `chatcmpl-mock-${uuidv4().replace(/-/g, "").slice(0, 24)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    system_fingerprint: "aegisflow-mock-v1",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        logprobs: null,
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

export async function simulateMockLlm(
  body: Record<string, unknown>,
  delayMs = 25,
): Promise<{ response: unknown; statusCode: number; latencyMs: number }> {
  const start = performance.now();
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return {
    response: buildMockCompletion(body),
    statusCode: 200,
    latencyMs: performance.now() - start,
  };
}
