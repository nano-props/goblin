#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# No build:server here: this path serves the web bundle while the
# standalone server runs from source via scripts/start-server.ts.
# Keeping dist/server out of this flow avoids stale server artifacts.
bun run build:web
exec ./scripts/start-server.ts "$@"
