import { FastifyRequest, FastifyReply } from "fastify";
import Redis from "ioredis";
import { Config, IdempotencyRecord } from "../config";
import { recordCacheHit, recordCacheMiss } from "./rateLimit";

const IDEMPOTENCY_HEADER = "idempotency-key";

export function createIdempotencyMiddleware(config: Config, redis: Redis) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const key = request.headers[IDEMPOTENCY_HEADER] as string | undefined;
    if (!key) {
      reply.code(400).send({
        error: "Missing required Idempotency-Key header",
      });
      return;
    }

    if (key.length < 8 || key.length > 128) {
      reply.code(400).send({
        error: "Idempotency-Key must be between 8 and 128 characters",
      });
      return;
    }

    const redisKey = `idempotency:${key}`;
    const existing = await redis.get(redisKey);

    if (existing) {
      await recordCacheHit("idempotency");
      const record: IdempotencyRecord = JSON.parse(existing);

      if (record.status === "in-flight") {
        reply.header("Retry-After", "2");
        reply.code(409).send({
          error: "Request in-flight",
          retry_backoff: true,
          idempotency_key: key,
        });
        return;
      }

      if (record.status === "completed" && record.response !== undefined) {
        reply.code(record.statusCode ?? 200).send(record.response);
        return;
      }

      if (record.status === "failed") {
        reply.code(503).send({
          error: "Previous request with this idempotency key failed",
          idempotency_key: key,
        });
        return;
      }
    } else {
      await recordCacheMiss("idempotency");
    }

    const inFlight: IdempotencyRecord = {
      status: "in-flight",
      createdAt: Date.now(),
    };
    await redis.setex(redisKey, config.idempotencyTtlSeconds, JSON.stringify(inFlight));

    (request as FastifyRequest & { idempotencyKey: string }).idempotencyKey = key;
    (request as FastifyRequest & { idempotencyRedisKey: string }).idempotencyRedisKey = redisKey;
  };
}

export async function completeIdempotency(
  redis: Redis,
  redisKey: string,
  ttl: number,
  statusCode: number,
  response: unknown,
): Promise<void> {
  const record: IdempotencyRecord = {
    status: "completed",
    response,
    statusCode,
    createdAt: Date.now(),
  };
  await redis.setex(redisKey, ttl, JSON.stringify(record));
}

export async function failIdempotency(redis: Redis, redisKey: string, ttl: number): Promise<void> {
  const record: IdempotencyRecord = {
    status: "failed",
    createdAt: Date.now(),
  };
  await redis.setex(redisKey, ttl, JSON.stringify(record));
}

export async function saveTxMapping(
  redis: Redis,
  idempotencyKey: string,
  mapping: Record<string, string>,
  ttl: number,
): Promise<void> {
  const key = `tx_map:${idempotencyKey}`;
  await redis.setex(key, ttl, JSON.stringify(mapping));
}

export async function getTxMapping(
  redis: Redis,
  idempotencyKey: string,
): Promise<Record<string, string> | null> {
  const key = `tx_map:${idempotencyKey}`;
  const data = await redis.get(key);
  if (data) {
    await recordCacheHit("tx_map");
    return JSON.parse(data);
  }
  await recordCacheMiss("tx_map");
  return null;
}
