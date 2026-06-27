#!/usr/bin/env bash
set -euo pipefail

NAME="${MIO_NAPCAT_CONTAINER:-napcat-mio}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not installed or not in PATH" >&2
  exit 1
fi

if docker ps --format '{{.Names}}' | grep -Fxq "$NAME"; then
  docker stop "$NAME" >/dev/null
  echo "Stopped NapCat container: $NAME"
else
  echo "NapCat container is not running: $NAME"
fi

echo "Persistent data kept under data/runtime/napcat/."
