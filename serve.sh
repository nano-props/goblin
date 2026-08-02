#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# The standalone runtime has its own freshly cleaned output. Electron keeps
# owning dist/server, while this path never falls back to a stale artifact.
bun run build:web
bun run build:standalone-server
exec node ./dist/standalone-server/main.js "$@"
