import client from "prom-client";

client.collectDefaultMetrics({ prefix: "aegisflow_" });

export const httpRequestDuration = new client.Histogram({
  name: "aegisflow_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

export const httpRequestsTotal = new client.Counter({
  name: "aegisflow_http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status_code"] as const,
});

export const redisCacheHits = new client.Counter({
  name: "aegisflow_redis_cache_hits_total",
  help: "Redis cache hits",
  labelNames: ["key_type"] as const,
});

export const redisCacheMisses = new client.Counter({
  name: "aegisflow_redis_cache_misses_total",
  help: "Redis cache misses",
  labelNames: ["key_type"] as const,
});

export const pipelineStageDuration = new client.Histogram({
  name: "aegisflow_pipeline_stage_duration_seconds",
  help: "Pipeline stage duration",
  labelNames: ["stage"] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

export const mlInferenceCalls = new client.Counter({
  name: "aegisflow_ml_inference_calls_total",
  help: "ML inference calls",
  labelNames: ["status"] as const,
});

export const regexFallbackTotal = new client.Counter({
  name: "aegisflow_regex_fallback_total",
  help: "Regex fallback invocations",
});

export const circuitBreakerOpen = new client.Counter({
  name: "aegisflow_circuit_breaker_open_total",
  help: "Circuit breaker open events",
});

export const kafkaEventsPublished = new client.Counter({
  name: "aegisflow_kafka_events_published_total",
  help: "Kafka audit events published",
  labelNames: ["status"] as const,
});

export { client as promClient };
