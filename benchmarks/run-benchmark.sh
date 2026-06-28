#!/usr/bin/env bash
# Run Artillery stress benchmark against local AegisFlow gateway
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="$SCRIPT_DIR/../results"
mkdir -p "$RESULTS_DIR"

echo "==> Checking gateway health..."
curl -sf http://localhost:3000/health || { echo "Gateway not reachable on :3000"; exit 1; }

echo "==> Running Artillery stress test..."
npx artillery run \
  "$SCRIPT_DIR/artillery/stress-test.yml" \
  --output "$RESULTS_DIR/report.json"

echo "==> Generating HTML report..."
npx artillery report "$RESULTS_DIR/report.json" --output "$RESULTS_DIR/report.html"

echo "==> Done. Results at benchmarks/results/"
