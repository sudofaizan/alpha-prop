#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q -r requirements.txt

MOCK="${TICK_HUB_MOCK:-}"
ARGS=()
if [[ "$MOCK" == "1" || "$MOCK" == "true" ]]; then
  ARGS+=(--mock)
fi

exec python hub.py "${ARGS[@]}" "$@"
