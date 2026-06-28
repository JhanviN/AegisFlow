# AegisFlow

**High-throughput, low-latency distributed compliance proxy that sits between internal corporate applications and third-party LLM providers.

AegisFlow intercepts outgoing prompt traffic, strips or masks PII locally in real-time using lightweight ML, forwards sanitized data to the cloud LLM, and transparently rehydrates the model's response before returning it to the user. All transactional metadata is archived via an asynchronous Kafka pipeline for SOC 2 compliant audit trails.

## Architecture

```
                +--------------------------------------------------+
                |               API Ingestion Gateway              |
                |                  (TypeScript)                    |
                +----+-------------------+--------------------+----+
                     |                   |                    ^
    1. Authenticate  |                   | 2. Sync            | 5. Sync
    & Validate       |                   |    Mask Call       |    Rehydrate
                     v                   v                    |
              +------+------+    +-------+-------+     +------+------+
              |    Redis    |    |  ML Inference |     | OpenAI API  |
              |  Idempotency|    |    (Python)   |     |  (Cloud)    |
              +-------------+    +---------------+     +-------------+
                     |
                     | 6. Async Fire-and-Forget
                     v
              +-------------+
              | Apache Kafka| ---> [Compliance Worker] ---> [PostgreSQL]
              +-------------+
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Ingestion Gateway | Node.js / TypeScript (Fastify) |
| ML Inference | Python / FastAPI (Presidio + Hugging Face NER) |
| Event Streaming | Apache Kafka + Zookeeper |
| Cache / State | Redis |
| Audit Store | PostgreSQL |
| Observability | Prometheus + Grafana |

## Quick Start

### Prerequisites

- Docker & Docker Compose v2
- OpenAI API key (or mock server)

### Launch

```bash
cp .env.example .env
# Edit .env with your OPENAI_API_KEY

docker compose up -d --build
```

### Verify Services

| Service | URL |
|---------|-----|
| Gateway API | http://localhost:3000 |
| ML Inference | http://localhost:8000 |
| Grafana | http://localhost:3001 (admin / aegisflow) |
| Prometheus | http://localhost:9090 |

### Example Request

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer dev-api-key-1" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "Contact John Smith at john@example.com or 555-123-4567"}
    ]
  }'
```

## Core Features

### Idempotency (Exactly-Once)

Every request requires an `Idempotency-Key` header. The gateway tracks in-flight and completed requests in Redis (60s TTL) to prevent duplicate processing on network retries.

### PII Masking Pipeline

1. Raw prompt sent to ML Inference Engine (Presidio + `distilbert-base-uncased-finetuned-conll03-ner`)
2. Masked text + placeholder mapping returned
3. Mapping stored in Redis (`tx_map:{key}`, 60s TTL)
4. Sanitized prompt forwarded to OpenAI
5. Response rehydrated using mapping before client delivery

### Circuit Breaker / Fallback

If ML inference times out or crashes, the gateway falls back to regex-based PII detection. If structural verification fails, the request is blocked with HTTP 503 — unsanitized prompts never pass the perimeter.

### Async Audit Trail

After response dispatch, the gateway emits audit events to Kafka topic `raw-audit-events`. The Compliance Worker consumes events, computes SHA-256 structural signatures, and batch-writes to PostgreSQL.

Failed consumer processing routes to `dlq-compliance-errors` with exception headers.

## Observability

Grafana dashboard **AegisFlow Compliance Proxy** includes:

- **p95 / p99 Gateway Latency** — internal overhead target < 25ms
- **Redis Cache Hit/Miss Rates** and eviction metrics
- **Kafka Log End Offsets & Consumer Lag** — proves background workers keep up
- **ML Inference & Fallback Metrics** — circuit breaker visibility
- **Pipeline Stage Latency Breakdown** — Redis, ML, OpenAI, rehydration

## Stress Benchmarks

### Artillery

```bash
cd benchmarks
bash run-benchmark.sh
```

### Locust (5,000 rps target)

```bash
pip install locust
locust -f benchmarks/locust/locustfile.py --host=http://localhost:3000 \
       --headless -u 5000 -r 500 --run-time 5m \
       --csv=benchmarks/results/locust_report
```

### Performance Results

> Run benchmarks after `docker compose up` to populate these charts.

#### Gateway Latency Under Load

| Metric | Target | Baseline Result |
|--------|--------|-----------------|
| p95 Internal Overhead | < 25ms | _Run benchmark to measure_ |
| p99 Internal Overhead | < 50ms | _Run benchmark to measure_ |
| Sustained Throughput | 5,000 rps | _Run benchmark to measure_ |
| Error Rate | < 0.1% | _Run benchmark to measure_ |

#### Latency Distribution (Placeholder)

```
p50  ████████████████████░░░░░░░░░░  ~12ms
p95  ████████████████████████████░░  ~22ms  ✓ under 25ms target
p99  ██████████████████████████████  ~38ms
```

#### Redis & Kafka Health (Placeholder)

```
Redis Hit Rate:     ████████████████████  ~94%
Consumer Lag:       ░░░░░░░░░░░░░░░░░░░░  ~0 msgs (healthy)
Kafka Throughput:   ████████████████████  keeping pace
```

## Project Structure

```
AegisFlow/
├── gateway/                 # TypeScript API Ingestion Gateway
├── ml-inference/            # Python FastAPI PII masking engine
├── compliance-worker/       # TypeScript Kafka consumer → PostgreSQL
├── infrastructure/          # Postgres, Prometheus, Grafana configs
├── benchmarks/              # Artillery + Locust stress tests
└── docker-compose.yml       # Full stack orchestration
```

## License

MIT
