import Fastify from "fastify";
import cors from "@fastify/cors";
import Redis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import { loadConfig, ChatCompletionRequest, AuditEvent } from "./config";
import { createAuthMiddleware, sha256 } from "./middleware/auth";
import { createRateLimitMiddleware } from "./middleware/rateLimit";
import {
  createIdempotencyMiddleware,
  completeIdempotency,
  failIdempotency,
  saveTxMapping,
  getTxMapping,
} from "./middleware/idempotency";
import { maskAllMessages, MlInferenceError } from "./services/mlInference";
import { forwardToOpenAI, rehydrateResponse } from "./services/openai";
import { initKafkaProducer, publishAuditEvent, disconnectKafka } from "./services/kafkaProducer";
import {
  promClient,
  httpRequestDuration,
  httpRequestsTotal,
  pipelineStageDuration,
} from "./metrics";

const config = loadConfig();

if (config.isMockMode) {
  console.log("⚠️ AegisFlow running in COMPLIANCE MOCK MODE. Cloud LLM calls will be simulated.");
}

const app = Fastify({
  logger: true,
  requestIdHeader: "x-request-id",
  genReqId: () => uuidv4(),
});

const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

app.register(cors, { origin: true });

app.addHook("onResponse", async (request, reply) => {
  const route = request.routeOptions?.url ?? request.url;
  const duration = reply.elapsedTime / 1000;
  httpRequestDuration.observe(
    { method: request.method, route, status_code: String(reply.statusCode) },
    duration,
  );
  httpRequestsTotal.inc({
    method: request.method,
    route,
    status_code: String(reply.statusCode),
  });
});

app.get("/health", async () => ({
  status: "healthy",
  service: "aegisflow-gateway",
  mockMode: config.isMockMode,
  timestamp: new Date().toISOString(),
}));

app.get("/metrics", async (_request, reply) => {
  reply.header("Content-Type", promClient.register.contentType);
  return promClient.register.metrics();
});

app.post(
  "/v1/chat/completions",
  {
    preHandler: [
      createAuthMiddleware(config),
      createRateLimitMiddleware(config, redis),
      createIdempotencyMiddleware(config, redis),
    ],
  },
  async (request, reply) => {
    const startTime = performance.now();
    const tenantId = (request as typeof request & { tenantId: string }).tenantId;
    const idempotencyKey = (request as typeof request & { idempotencyKey: string }).idempotencyKey;
    const idempotencyRedisKey = (request as typeof request & { idempotencyRedisKey: string })
      .idempotencyRedisKey;
    const transactionId = uuidv4();

    const latencies = {
      totalMs: 0,
      redisMs: 0,
      mlMs: 0,
      openaiMs: 0,
      rehydrateMs: 0,
    };

    let maskingEngine = "unknown";
    let entitiesMasked = 0;
    let promptHash = "";
    let responseHash = "";
    let statusCode = 200;

    try {
      const body = request.body as ChatCompletionRequest;

      if (!body.messages?.length) {
        reply.code(400).send({ error: "messages array is required" });
        return;
      }

      promptHash = sha256(JSON.stringify(body.messages));

      const mlStart = performance.now();
      const maskResult = await maskAllMessages(config, body.messages);
      latencies.mlMs = performance.now() - mlStart;
      maskingEngine = maskResult.engine;
      entitiesMasked = maskResult.entitiesFound;

      const redisStart = performance.now();
      await saveTxMapping(redis, idempotencyKey, maskResult.mapping, config.txMapTtlSeconds);
      latencies.redisMs = performance.now() - redisStart;

      const maskedBody = {
        ...body,
        messages: maskResult.maskedMessages,
        stream: false,
      };

      const openaiResult = await forwardToOpenAI(config, maskedBody as unknown as Record<string, unknown>);
      latencies.openaiMs = openaiResult.latencyMs;
      statusCode = openaiResult.statusCode;

      if (statusCode >= 400) {
        await failIdempotency(redis, idempotencyRedisKey, config.idempotencyTtlSeconds);
        reply.code(statusCode).send(openaiResult.response);
        return;
      }

      const rehydrateStart = performance.now();
      const mapping = await getTxMapping(redis, idempotencyKey);
      const rehydrated = mapping
        ? rehydrateResponse(openaiResult.response as Record<string, unknown>, mapping)
        : openaiResult.response;
      latencies.rehydrateMs = performance.now() - rehydrateStart;

      responseHash = sha256(JSON.stringify(rehydrated));
      latencies.totalMs = performance.now() - startTime;

      await completeIdempotency(
        redis,
        idempotencyRedisKey,
        config.idempotencyTtlSeconds,
        statusCode,
        rehydrated,
      );

      const auditEvent: AuditEvent = {
        transactionId,
        idempotencyKey,
        tenantId,
        timestamp: new Date().toISOString(),
        latencies,
        entitiesMasked,
        maskingEngine,
        promptHash,
        responseHash,
        model: body.model ?? "unknown",
        statusCode,
      };

      publishAuditEvent(auditEvent).catch((err) =>
        request.log.error({ err }, "Async audit publish failed"),
      );

      reply.code(statusCode).send(rehydrated);
    } catch (error) {
      if (error instanceof MlInferenceError && !error.recoverable) {
        await failIdempotency(redis, idempotencyRedisKey, config.idempotencyTtlSeconds);
        reply.code(503).send({
          error: "Service Unavailable",
          message: "PII sanitization failed — request blocked for compliance safety",
        });
        return;
      }

      request.log.error(error);
      await failIdempotency(redis, idempotencyRedisKey, config.idempotencyTtlSeconds);
      reply.code(500).send({ error: "Internal server error" });
    }
  },
);

async function start(): Promise<void> {
  try {
    await initKafkaProducer(config.kafkaBrokers);
    await app.listen({ port: config.port, host: "0.0.0.0" });
    app.log.info(
      `AegisFlow Gateway listening on port ${config.port}${config.isMockMode ? " (COMPLIANCE MOCK MODE)" : ""}`,
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

const shutdown = async (): Promise<void> => {
  await app.close();
  await disconnectKafka();
  redis.disconnect();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

start();
