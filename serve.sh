#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

bun run build:web
exec ./scripts/start-server.ts "$@"
