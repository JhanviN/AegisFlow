import client from "prom-client";

client.collectDefaultMetrics({ prefix: "aegisflow_worker_" });

export const eventsProcessed = new client.Counter({
  name: "aegisflow_worker_events_processed_total",
  help: "Total audit events processed",
  labelNames: ["status"] as const,
});

export const batchWriteDuration = new client.Histogram({
  name: "aegisflow_worker_batch_write_duration_seconds",
  help: "Batch write duration",
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

export const dlqEvents = new client.Counter({
  name: "aegisflow_worker_dlq_events_total",
  help: "Events sent to DLQ",
});

export { client as promClient };
