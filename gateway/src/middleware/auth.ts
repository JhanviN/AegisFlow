import { createHash } from "crypto";
import { FastifyRequest, FastifyReply } from "fastify";
import { Config } from "../config";

export function createAuthMiddleware(config: Config) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      reply.code(401).send({ error: "Missing or invalid Authorization header" });
      return;
    }

    const token = authHeader.slice(7);
    if (!config.apiKeys.has(token)) {
      reply.code(403).send({ error: "Invalid API key" });
      return;
    }

    (request as FastifyRequest & { tenantId: string }).tenantId = token.slice(0, 16);
  };
}

export function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}
