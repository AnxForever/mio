#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

export MIO_COMPANION_REQUIRE_REAL_PROVIDER="${MIO_COMPANION_REQUIRE_REAL_PROVIDER:-true}"
scripts/wechat-bridge/preflight-companion-gate.sh
scripts/wechat-bridge/stop.sh
scripts/wechat-bridge/start.sh
scripts/wechat-bridge/status.sh
