#!/usr/bin/env bash
# Run Artillery stress benchmark against local AegisFlow gateway.
# Applies throughput-friendly gateway settings before the run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RESULTS_DIR="$SCRIPT_DIR/results"
mkdir -p "$RESULTS_DIR"

echo "==> Applying benchmark gateway profile (regex PII, zero mock delay, high rate limit)..."
export PII_MASK_MODE=regex
export MOCK_LLM_DELAY_MS=0
export RATE_LIMIT_RPM=360000
export MOCK_LLM_MODE=true

cd "$ROOT_DIR"
docker compose up -d --no-deps --build gateway

echo "==> Waiting for gateway..."
for i in {1..30}; do
  if curl -sf http://localhost:3000/health >/dev/null; then
    break
  fi
  sleep 1
done
curl -sf http://localhost:3000/health | tee /dev/stderr
echo ""

echo "==> Running Artillery stress test..."
npx artillery run \
  "$SCRIPT_DIR/artillery/stress-test.yml" \
  --output "$RESULTS_DIR/report.json"

echo "==> Generating HTML report..."
npx artillery report "$RESULTS_DIR/report.json" --output "$RESULTS_DIR/report.html"

echo "==> Done. Results at benchmarks/results/"
