#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/data/runtime/wechat-bridge"
cd "$ROOT_DIR"

load_env_file() {
  local env_file="$1"
  [[ -f "$env_file" ]] || return 0
  while IFS='=' read -r key value; do
    [[ -n "$key" ]] || continue
    export "$key=$value"
  done < <(node scripts/wechat-bridge/read-env.mjs "$env_file")
}

timestamp() {
  date -u +"%Y%m%dT%H%M%SZ"
}

load_env_file "$ROOT_DIR/.env"
mkdir -p "$RUNTIME_DIR"

MODE="${MIO_COMPANION_GATE_MODE:-smoke}"
PROVIDERS="${MIO_COMPANION_PROVIDERS:-mock}"
MODELS="${MIO_COMPANION_MODELS:-}"
REQUIRE_REAL_PROVIDER="${MIO_COMPANION_REQUIRE_REAL_PROVIDER:-false}"
RESULT_DIR="${MIO_COMPANION_GATE_RESULT_DIR:-$RUNTIME_DIR/companion-gate/$(timestamp)}"

case "$MODE" in
  smoke)
    LOOP_ARGS=(
      --skip-actors
      --skip-persona-cases
      --skip-pairwise
      --skip-mining
    )
    ;;
  full)
    LOOP_ARGS=()
    ;;
  *)
    echo "Unknown MIO_COMPANION_GATE_MODE=$MODE. Use smoke or full." >&2
    exit 2
    ;;
esac

echo "Mio companion preflight gate"
echo "  mode: $MODE"
echo "  providers: $PROVIDERS"
echo "  requireRealProvider: $REQUIRE_REAL_PROVIDER"
if [[ -n "$MODELS" ]]; then
  echo "  models: $MODELS"
fi
echo "  resultDir: $RESULT_DIR"

node scripts/wechat-bridge/companion-gate-policy.mjs \
  "--providers=$PROVIDERS" \
  "--require-real-provider=$REQUIRE_REAL_PROVIDER"

CMD=(
  node
  --experimental-strip-types
  eval/companion-provider-matrix.ts
  "--providers=$PROVIDERS"
  "--result-dir=$RESULT_DIR"
)

if [[ -n "$MODELS" ]]; then
  CMD+=("--models=$MODELS")
fi

CMD+=(--)
CMD+=("${LOOP_ARGS[@]}")

echo "+ ${CMD[*]}"
set +e
"${CMD[@]}"
MATRIX_STATUS=$?
set -e

node scripts/wechat-bridge/write-companion-gate-record.mjs \
  "--runtime-dir=$RUNTIME_DIR" \
  "--result-dir=$RESULT_DIR" \
  "--mode=$MODE" \
  "--providers=$PROVIDERS" \
  "--models=$MODELS"

if [[ "$MATRIX_STATUS" -ne 0 ]]; then
  echo "Companion preflight failed."
  echo "Report: $RESULT_DIR/report.md"
  exit "$MATRIX_STATUS"
fi

echo "Companion preflight passed."
echo "Report: $RESULT_DIR/report.md"
