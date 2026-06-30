#!/usr/bin/env bash
# Run Artillery stress benchmark against local AegisFlow gateway.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RESULTS_DIR="$SCRIPT_DIR/results"
PROFILE="${STRESS_PROFILE:-local}"
COMPOSE_NETWORK="aegisflow_aegisflow"

if [[ "$PROFILE" == "full" ]]; then
  CONFIG_NAME="stress-test.yml"
  CONFIG_HOST="$SCRIPT_DIR/artillery/stress-test.yml"
else
  CONFIG_NAME="stress-test-local.yml"
  CONFIG_HOST="$SCRIPT_DIR/artillery/stress-test-local.yml"
fi

mkdir -p "$RESULTS_DIR"

# Git Bash on Windows rewrites /results → C:/Program Files/Git/... — disable for docker runs
docker_volume_src() {
  if [[ "${OSTYPE:-}" == msys* ]] || [[ "${OSTYPE:-}" == cygwin* ]]; then
    (cd "$1" && pwd -W | sed 's|\\|/|g')
  else
    echo "$1"
  fi
}
RESULTS_MOUNT="$(docker_volume_src "$RESULTS_DIR")"

echo "==> Profile: $PROFILE"
echo "==> Applying benchmark gateway settings (regex PII, zero mock delay, high rate limit)..."
export PII_MASK_MODE=regex
export MOCK_LLM_DELAY_MS=0
export RATE_LIMIT_RPM=360000
export MOCK_LLM_MODE=true

cd "$ROOT_DIR"

if [[ "${BENCHMARK_REBUILD:-false}" == "true" ]]; then
  docker compose up -d --build
else
  docker compose up -d
fi

wait_for_gateway() {
  local i
  for i in {1..60}; do
    if docker compose exec -T gateway wget -qO- --timeout=2 http://127.0.0.1:3000/health >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

echo "==> Waiting for gateway (up to 60s)..."
if ! wait_for_gateway; then
  echo "ERROR: Gateway not healthy. Check: docker compose logs gateway --tail 30"
  exit 1
fi

docker compose exec -T gateway wget -qO- http://127.0.0.1:3000/health
echo ""

# Detect whether host port forwarding works (often broken on Windows Docker Desktop)
USE_DOCKER_ARTILLERY=false
if curl -sf --max-time 3 http://localhost:3000/health >/dev/null 2>&1; then
  echo "==> Host port localhost:3000 OK — running Artillery via npx"
  TARGET="http://localhost:3000"
else
  echo "==> Host port localhost:3000 unreachable — running Artillery inside Docker network"
  echo "    (Common on Windows after heavy load; restart Docker Desktop to fix host access)"
  USE_DOCKER_ARTILLERY=true
  TARGET="http://gateway:3000"
fi

if [[ "$USE_DOCKER_ARTILLERY" == "true" ]]; then
  # Rewrite target for in-network run
  sed "s|target: \"http://localhost:3000\"|target: \"http://gateway:3000\"|" \
    "$CONFIG_HOST" > "$RESULTS_DIR/$CONFIG_NAME"

  export MSYS_NO_PATHCONV=1
  export MSYS2_ARG_CONV_EXCL="*"

  docker run --rm \
    --network "$COMPOSE_NETWORK" \
    -v "${RESULTS_MOUNT}:/results" \
    -v "${RESULTS_MOUNT}/${CONFIG_NAME}:/artillery.yml:ro" \
    artilleryio/artillery:2.0.21 \
    run /artillery.yml --output //results/report.json

  docker run --rm \
    -v "${RESULTS_MOUNT}:/results" \
    artilleryio/artillery:2.0.21 \
    report //results/report.json --output //results/report.html
else
  npx --yes artillery run "$CONFIG_HOST" --output "$RESULTS_DIR/report.json"
  npx --yes artillery report "$RESULTS_DIR/report.json" --output "$RESULTS_DIR/report.html"
fi

echo "==> Done."
echo "    JSON:  benchmarks/results/report.json"
echo "    HTML:  benchmarks/results/report.html"
echo "    Full PRD profile: STRESS_PROFILE=full ./benchmarks/run-benchmark.sh"
