#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
COMMAND=$PROJECT_ROOT/dist/server/bin/check-support-diagnostic-probe.js

if [ ! -f "$COMMAND" ]; then
  printf 'ERR no existe el ejecutor compilado de diagnostico: %s\n' "$COMMAND" >&2
  exit 1
fi

exec node "$COMMAND" "$@"
