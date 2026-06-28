#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

WECLAW_REPO="${WECLAW_REPO:-https://github.com/fastclaw-ai/weclaw.git}"
WECLAW_REF="${WECLAW_REF:-v0.7.1}"
CACHE_ROOT="${MIO_WECLAW_CACHE_ROOT:-$HOME/.cache/mio}"
SRC_DIR="${MIO_WECLAW_SRC_DIR:-$CACHE_ROOT/weclaw-src}"
OUT_BIN="${MIO_WECLAW_BIN:-$HOME/.local/bin/weclaw-mio-session}"
PATCH_FILE="$REPO_ROOT/scripts/wechat-bridge/weclaw-session.patch"

command -v git >/dev/null 2>&1 || { echo "git is required" >&2; exit 1; }
command -v go >/dev/null 2>&1 || { echo "go is required" >&2; exit 1; }
command -v realpath >/dev/null 2>&1 || { echo "realpath is required" >&2; exit 1; }

resolve_path() {
  realpath -m "$1"
}

require_safe_src_dir() {
  local src_real cache_real home_real repo_real
  src_real="$(resolve_path "$SRC_DIR")"
  cache_real="$(resolve_path "$CACHE_ROOT")"
  home_real="$(resolve_path "$HOME")"
  repo_real="$(resolve_path "$REPO_ROOT")"

  case "$src_real" in
    ""|"/"|"$home_real"|"$cache_real"|"$repo_real")
      echo "Refusing unsafe MIO_WECLAW_SRC_DIR: $src_real" >&2
      exit 1
      ;;
  esac

  case "$src_real/" in
    "$repo_real"/*)
      echo "Refusing to build WeClaw inside the Mio repository: $src_real" >&2
      exit 1
      ;;
  esac

  case "$src_real/" in
    "$cache_real"/*) ;;
    *)
      if [[ "${MIO_WECLAW_ALLOW_UNSAFE_SRC_DIR:-}" != "true" ]]; then
        echo "Refusing MIO_WECLAW_SRC_DIR outside $cache_real: $src_real" >&2
        echo "Set MIO_WECLAW_ALLOW_UNSAFE_SRC_DIR=true only for a dedicated throwaway clone path." >&2
        exit 1
      fi
      ;;
  esac

  if [[ -e "$src_real" && ! -d "$src_real/.git" && "$(basename "$src_real")" != "weclaw-src" ]]; then
    echo "Refusing to replace non-git directory: $src_real" >&2
    exit 1
  fi

  SRC_DIR="$src_real"
  CACHE_ROOT="$cache_real"
}

require_safe_src_dir

mkdir -p "$(dirname "$SRC_DIR")" "$(dirname "$OUT_BIN")"

if [[ ! -d "$SRC_DIR/.git" ]]; then
  rm -rf "$SRC_DIR"
  git clone --depth 1 --branch "$WECLAW_REF" "$WECLAW_REPO" "$SRC_DIR"
else
  git -C "$SRC_DIR" fetch --tags origin "$WECLAW_REF"
  git -C "$SRC_DIR" checkout "$WECLAW_REF"
  git -C "$SRC_DIR" reset --hard "$WECLAW_REF"
fi

if grep -q 'X-Mio-Session-Id' "$SRC_DIR/agent/http_agent.go"; then
  echo "WeClaw session patch already present"
else
  git -C "$SRC_DIR" apply "$PATCH_FILE"
fi

go -C "$SRC_DIR" test ./agent ./messaging
go -C "$SRC_DIR" build -o "$OUT_BIN" .
chmod +x "$OUT_BIN"

echo "Built patched WeClaw: $OUT_BIN"
