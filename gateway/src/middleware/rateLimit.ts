import { FastifyRequest, FastifyReply } from "fastify";
import Redis from "ioredis";
import { Config } from "../config";
import { redisCacheHits, redisCacheMisses } from "../metrics";

export function createRateLimitMiddleware(config: Config, redis: Redis) {
  const windowMs = 60_000;

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId ?? "anonymous";
    const key = `rate_limit:${tenantId}:${Math.floor(Date.now() / windowMs)}`;

    const count = await redis.incr(key);
    if (count === 1) {
      await redis.pexpire(key, windowMs);
    }

    const limit = config.rateLimitRpm;
    reply.header("X-RateLimit-Limit", limit);
    reply.header("X-RateLimit-Remaining", Math.max(0, limit - count));

    if (count > limit) {
      reply.header("Retry-After", "60");
      reply.code(429).send({
        error: "Rate limit exceeded",
        retry_after_seconds: 60,
      });
    }
  };
}

export async function recordCacheHit(keyType: string): Promise<void> {
  redisCacheHits.inc({ key_type: keyType });
}

export async function recordCacheMiss(keyType: string): Promise<void> {
  redisCacheMisses.inc({ key_type: keyType });
}
