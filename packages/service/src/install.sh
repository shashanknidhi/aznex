#!/usr/bin/env bash
# Aznex developer installer — served by the Aznex service at /install.sh.
# Usage:  curl -fsSL <SERVICE_URL>/install.sh | bash
# Auth happens in your browser (GitHub login). Headless: pass --api-key axk_…
set -euo pipefail

SERVICE_URL="__SERVICE_URL__"
API_KEY="${AZNEX_API_KEY:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --api-key) API_KEY="$2"; shift 2 ;;
    --service-url) SERVICE_URL="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

if ! command -v bun >/dev/null 2>&1 && [ ! -x "$HOME/.bun/bin/bun" ]; then
  echo "→ installing Bun"
  curl -fsSL https://bun.sh/install | bash
fi
export PATH="$HOME/.bun/bin:$PATH"

echo "→ installing @aznex/worker"
bun install -g @aznex/worker

echo "→ running setup (your browser will open to authorize this device)"
AZNEX_BIN="$(command -v aznex-worker || echo "$HOME/.bun/bin/aznex-worker")"
if [ -n "$API_KEY" ]; then
  "$AZNEX_BIN" setup --service-url "$SERVICE_URL" --api-key "$API_KEY"
else
  "$AZNEX_BIN" setup --service-url "$SERVICE_URL"
fi
