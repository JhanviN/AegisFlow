import { createHash } from "crypto";
import { Pool } from "pg";

export interface WorkerConfig {
  kafkaBrokers: string[];
  kafkaGroupId: string;
  kafkaTopic: string;
  kafkaDlqTopic: string;
  postgresUrl: string;
  batchSize: number;
  batchIntervalMs: number;
}

export function loadConfig(): WorkerConfig {
  return {
    kafkaBrokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
    kafkaGroupId: process.env.KAFKA_GROUP_ID ?? "compliance-worker-group",
    kafkaTopic: process.env.KAFKA_TOPIC ?? "raw-audit-events",
    kafkaDlqTopic: process.env.KAFKA_DLQ_TOPIC ?? "dlq-compliance-errors",
    postgresUrl: process.env.POSTGRES_URL ?? "postgres://aegisflow:aegisflow_secret@localhost:5432/aegisflow_audit",
    batchSize: parseInt(process.env.BATCH_SIZE ?? "50", 10),
    batchIntervalMs: parseInt(process.env.BATCH_INTERVAL_MS ?? "2000", 10),
  };
}

export interface AuditEventPayload {
  transactionId: string;
  idempotencyKey: string;
  tenantId: string;
  timestamp: string;
  latencies: Record<string, number>;
  entitiesMasked: number;
  maskingEngine: string;
  promptHash: string;
  responseHash: string;
  model: string;
  statusCode: number;
}

export function computeStructuralSignature(payload: AuditEventPayload): string {
  const canonical = JSON.stringify({
    transactionId: payload.transactionId,
    idempotencyKey: payload.idempotencyKey,
    tenantId: payload.tenantId,
    promptHash: payload.promptHash,
    responseHash: payload.responseHash,
    model: payload.model,
    statusCode: payload.statusCode,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function computePayloadHash(payload: AuditEventPayload): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function createPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export async function insertAuditEvents(
  pool: Pool,
  events: AuditEventPayload[],
): Promise<void> {
  if (events.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const event of events) {
      const payloadHash = computePayloadHash(event);
      const structuralSignature = computeStructuralSignature(event);

      await client.query(
        `INSERT INTO audit_events
          (transaction_id, idempotency_key, tenant_id, event_type, payload_hash, structural_signature, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (transaction_id) DO NOTHING`,
        [
          event.transactionId,
          event.idempotencyKey,
          event.tenantId,
          "compliance_audit",
          payloadHash,
          structuralSignature,
          JSON.stringify(event),
        ],
      );
    }

    const batchHash = createHash("sha256")
      .update(events.map((e) => e.transactionId).join(":"))
      .digest("hex");

    await client.query(
      `INSERT INTO audit_batches (batch_hash, event_count, events)
       VALUES ($1, $2, $3)`,
      [batchHash, events.length, JSON.stringify(events.map((e) => e.transactionId))],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function insertDlqRecord(
  pool: Pool,
  topic: string,
  partition: number,
  offset: string,
  errorMessage: string,
  payload: unknown,
  headers: Record<string, string>,
): Promise<void> {
  await pool.query(
    `INSERT INTO dlq_events (topic, partition_id, message_offset, error_message, payload, headers)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [topic, partition, offset, errorMessage, JSON.stringify(payload), JSON.stringify(headers)],
  );
}
