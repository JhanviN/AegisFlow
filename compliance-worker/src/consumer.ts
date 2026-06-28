import { Kafka, Consumer, Producer, EachMessagePayload } from "kafkajs";
import { Pool } from "pg";
import {
  WorkerConfig,
  AuditEventPayload,
  insertAuditEvents,
  insertDlqRecord,
} from "./db";
import { eventsProcessed, batchWriteDuration, dlqEvents } from "./metrics";

interface DlqMessage {
  value?: Buffer | null;
  offset: string;
  headers?: Record<string, string | Buffer | (string | Buffer)[] | undefined>;
}

export class ComplianceConsumer {
  private consumer: Consumer;
  private dlqProducer: Producer;
  private batch: AuditEventPayload[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private config: WorkerConfig,
    private pool: Pool,
  ) {
    const kafka = new Kafka({
      clientId: "aegisflow-compliance-worker",
      brokers: config.kafkaBrokers,
      retry: { initialRetryTime: 300, retries: 10 },
    });

    this.consumer = kafka.consumer({
      groupId: config.kafkaGroupId,
      sessionTimeout: 30_000,
      heartbeatInterval: 3_000,
    });

    this.dlqProducer = kafka.producer();
  }

  async start(): Promise<void> {
    await this.consumer.connect();
    await this.dlqProducer.connect();

    await this.consumer.subscribe({
      topic: this.config.kafkaTopic,
      fromBeginning: false,
    });

    this.flushTimer = setInterval(() => {
      this.flushBatch().catch((err) =>
        console.error("Periodic flush failed:", err),
      );
    }, this.config.batchIntervalMs);

    await this.consumer.run({
      autoCommit: false,
      eachMessage: async (payload) => this.handleMessage(payload),
    });

    console.log(`Compliance worker consuming from ${this.config.kafkaTopic}`);
  }

  private async handleMessage(payload: EachMessagePayload): Promise<void> {
    const { topic, partition, message } = payload;

    try {
      if (!message.value) {
        throw new Error("Empty message value");
      }

      const event = JSON.parse(message.value.toString()) as AuditEventPayload;

      if (!event.transactionId || !event.idempotencyKey) {
        throw new Error("Invalid audit event: missing required fields");
      }

      this.batch.push(event);

      if (this.batch.length >= this.config.batchSize) {
        await this.flushBatch();
      }

      await this.consumer.commitOffsets([
        {
          topic,
          partition,
          offset: (BigInt(message.offset) + 1n).toString(),
        },
      ]);

      eventsProcessed.inc({ status: "success" });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Failed to process message at ${topic}:${partition}:${message.offset}:`, errorMessage);

      eventsProcessed.inc({ status: "error" });
      dlqEvents.inc();

      await this.sendToDlq(topic, partition, message, errorMessage);

      await this.consumer.commitOffsets([
        {
          topic,
          partition,
          offset: (BigInt(message.offset) + 1n).toString(),
        },
      ]);
    }
  }

  private async flushBatch(): Promise<void> {
    if (this.batch.length === 0) return;

    const toWrite = [...this.batch];
    this.batch = [];

    const endTimer = batchWriteDuration.startTimer();
    try {
      await insertAuditEvents(this.pool, toWrite);
      console.log(`Flushed batch of ${toWrite.length} audit events to PostgreSQL`);
    } catch (error) {
      console.error("Batch write failed:", error);
      for (const event of toWrite) {
        await this.sendToDlq(
          this.config.kafkaTopic,
          -1,
          { value: Buffer.from(JSON.stringify(event)), offset: "batch", headers: {} },
          error instanceof Error ? error.message : String(error),
        );
      }
    } finally {
      endTimer();
    }
  }

  private async sendToDlq(
    topic: string,
    partition: number,
    message: DlqMessage,
    errorMessage: string,
  ): Promise<void> {
    let payload: unknown = null;
    try {
      payload = message.value ? JSON.parse(message.value.toString()) : null;
    } catch {
      payload = message.value?.toString() ?? null;
    }

    const headers: Record<string, string> = {};
    if (message.headers) {
      for (const [key, val] of Object.entries(message.headers)) {
        if (Array.isArray(val)) {
          headers[key] = val[0]?.toString() ?? "";
        } else {
          headers[key] = val?.toString() ?? "";
        }
      }
    }
    headers["x-error-message"] = errorMessage;
    headers["x-failed-at"] = new Date().toISOString();

    try {
      await this.dlqProducer.send({
        topic: this.config.kafkaDlqTopic,
        messages: [
          {
            key: headers["idempotency-key"] ?? message.offset,
            value: JSON.stringify({ originalPayload: payload, error: errorMessage }),
            headers: Object.fromEntries(
              Object.entries(headers).map(([k, v]) => [k, Buffer.from(v)]),
            ),
          },
        ],
      });

      await insertDlqRecord(
        this.pool,
        topic,
        partition,
        message.offset,
        errorMessage,
        payload,
        headers,
      );
    } catch (dlqError) {
      console.error("Failed to send to DLQ:", dlqError);
    }
  }

  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    await this.flushBatch();
    await this.consumer.disconnect();
    await this.dlqProducer.disconnect();
  }
}
