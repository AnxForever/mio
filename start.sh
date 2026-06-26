#!/usr/bin/env bash
# Mio 一键启动
#    ./start.sh        → 后端 :3000
#    ./start.sh serve  → 后端 :3000
set -e
cd "$(dirname "$0")"

# 加载 .env
set -a; source .env 2>/dev/null; set +a

# 重新构建
npx tsc 2>/dev/null || true
cd web && npx vite build 2>/dev/null && cd ..

echo "========================================="
echo "  Mio Server"
echo "  http://localhost:${MIO_HTTP_PORT:-3000}"
echo "  Provider: ${MIO_PROVIDER:-auto}"
echo "========================================="

node dist/index.js serve
