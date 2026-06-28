import { Kafka, Producer } from "kafkajs";
import { AuditEvent } from "../config";
import { kafkaEventsPublished } from "../metrics";

let producer: Producer | null = null;

export async function initKafkaProducer(brokers: string[]): Promise<Producer> {
  const kafka = new Kafka({
    clientId: "aegisflow-gateway",
    brokers,
    retry: { initialRetryTime: 300, retries: 5 },
  });

  producer = kafka.producer({ allowAutoTopicCreation: false });
  await producer.connect();
  return producer;
}

export async function publishAuditEvent(event: AuditEvent): Promise<void> {
  if (!producer) {
    throw new Error("Kafka producer not initialized");
  }

  try {
    await producer.send({
      topic: "raw-audit-events",
      messages: [
        {
          key: event.transactionId,
          value: JSON.stringify(event),
          headers: {
            "content-type": "application/json",
            "tenant-id": event.tenantId,
            "idempotency-key": event.idempotencyKey,
          },
        },
      ],
    });
    kafkaEventsPublished.inc({ status: "success" });
  } catch (error) {
    kafkaEventsPublished.inc({ status: "error" });
    console.error("Failed to publish audit event:", error);
  }
}

export async function disconnectKafka(): Promise<void> {
  if (producer) {
    await producer.disconnect();
    producer = null;
  }
}
