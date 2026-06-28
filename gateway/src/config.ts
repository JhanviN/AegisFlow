export interface Config {
  port: number;
  redisUrl: string;
  kafkaBrokers: string[];
  mlInferenceUrl: string;
  openaiApiKey: string;
  openaiBaseUrl: string;
  apiKeys: Set<string>;
  rateLimitRpm: number;
  idempotencyTtlSeconds: number;
  txMapTtlSeconds: number;
  mlTimeoutMs: number;
}

export function loadConfig(): Config {
  const apiKeysRaw = process.env.API_KEYS ?? "dev-api-key-1";
  return {
    port: parseInt(process.env.PORT ?? "3000", 10),
    redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
    kafkaBrokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
    mlInferenceUrl: process.env.ML_INFERENCE_URL ?? "http://localhost:8000",
    openaiApiKey: process.env.OPENAI_API_KEY ?? "",
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    apiKeys: new Set(apiKeysRaw.split(",").map((k) => k.trim()).filter(Boolean)),
    rateLimitRpm: parseInt(process.env.RATE_LIMIT_RPM ?? "6000", 10),
    idempotencyTtlSeconds: parseInt(process.env.IDEMPOTENCY_TTL_SECONDS ?? "60", 10),
    txMapTtlSeconds: parseInt(process.env.TX_MAP_TTL_SECONDS ?? "60", 10),
    mlTimeoutMs: parseInt(process.env.ML_TIMEOUT_MS ?? "5000", 10),
  };
}

export interface ChatMessage {
  role: string;
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface PiiMapping {
  [placeholder: string]: string;
}

export interface MaskResponse {
  masked_text: string;
  mapping: PiiMapping;
  entities_found: number;
  engine: string;
  latency_ms: number;
}

export type IdempotencyStatus = "in-flight" | "completed" | "failed";

export interface IdempotencyRecord {
  status: IdempotencyStatus;
  response?: unknown;
  statusCode?: number;
  createdAt: number;
}

export interface AuditEvent {
  transactionId: string;
  idempotencyKey: string;
  tenantId: string;
  timestamp: string;
  latencies: {
    totalMs: number;
    redisMs: number;
    mlMs: number;
    openaiMs: number;
    rehydrateMs: number;
  };
  entitiesMasked: number;
  maskingEngine: string;
  promptHash: string;
  responseHash: string;
  model: string;
  statusCode: number;
}
