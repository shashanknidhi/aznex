#!/usr/bin/env bash
# Aznex developer installer — served by the Aznex service at /install.sh.
# Usage:  curl -fsSL <SERVICE_URL>/install.sh | bash -s -- --api-key axk_…
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

# stdin is the script itself under `curl | bash`; prompt via the terminal.
if [ -z "$API_KEY" ] && [ -e /dev/tty ]; then
  printf "Aznex API key (axk_…): " > /dev/tty
  read -r API_KEY < /dev/tty
fi
if [ -z "$API_KEY" ]; then
  echo "✗ no API key. Re-run with: --api-key axk_…  (or set AZNEX_API_KEY)" >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1 && [ ! -x "$HOME/.bun/bin/bun" ]; then
  echo "→ installing Bun"
  curl -fsSL https://bun.sh/install | bash
fi
export PATH="$HOME/.bun/bin:$PATH"

echo "→ installing @aznex/worker"
bun install -g @aznex/worker

echo "→ running setup"
AZNEX_BIN="$(command -v aznex-worker || echo "$HOME/.bun/bin/aznex-worker")"
"$AZNEX_BIN" setup --service-url "$SERVICE_URL" --api-key "$API_KEY"
