#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME=Goblin
DEST="$HOME/Applications"
BINARY_PATH_FRAGMENT="/$APP_NAME.app/Contents/MacOS/"
WAS_RUNNING=false
if pgrep -f "$BINARY_PATH_FRAGMENT" > /dev/null; then
  WAS_RUNNING=true
fi

# Collect flags (e.g. --clean) to forward to the build script.
EXTRA_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --clean)
      EXTRA_ARGS+=("$1")
      shift
      ;;
    *)
      shift
      ;;
  esac
done

# Go through bun to match `package.json`'s `build` script — the build
# script itself shells out to `bun install` / `bun run ...`, so requiring
# bun here keeps the toolchain assumption in one place.
bun scripts/build.ts install "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}"

if [ "$WAS_RUNNING" = true ]; then
  echo "Restarting $APP_NAME..."
  open "$DEST/$APP_NAME.app"
fi
