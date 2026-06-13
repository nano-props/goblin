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

# Defaults tuned for a fast reinstall. Override via env (handy for CI) or the
# CLI flags below. `bun run build` (no `install` positional) keeps upstream
# behaviour: typecheck runs, rebuild runs, no mirror is forced.
#
# Mirror env vars take a URL; leave unset/empty to disable a mirror:
#   ELECTRON_MIRROR, ELECTRON_BUILDER_BINARIES_MIRROR
#   --npmmirror sets both to the npmmirror defaults.
SKIP_TYPECHECK=${SKIP_TYPECHECK:-1}
SKIP_REBUILD=${SKIP_REBUILD:-1}
NPM_MIRROR_ELECTRON=${NPM_MIRROR_ELECTRON:-https://npmmirror.com/mirrors/electron/}
NPM_MIRROR_BINARIES=${NPM_MIRROR_BINARIES:-https://npmmirror.com/mirrors/electron-builder-binaries/}

usage() {
  cat <<EOF
Usage: ./install.sh [options]

Fast-reinstall Goblin.app into ~/Applications. Defaults enable the
skip-rebuild + skip-typecheck fast path but do NOT touch mirrors — pass
--npmmirror (or set ELECTRON_MIRROR / ELECTRON_BUILDER_BINARIES_MIRROR) when
GitHub is unreachable. Pass --full to run the full typecheck + rebuild
pipeline.

  --clean                Clear electron/electron-builder caches before building.
  --npmmirror            Route electron + electron-builder-binaries downloads
                         through npmmirror (equivalent to setting both
                         ELECTRON_MIRROR and ELECTRON_BUILDER_BINARIES_MIRROR
                         to the npmmirror URLs).
  --mirror=URL           Electron download mirror (overrides --npmmirror).
  --binaries-mirror=URL  electron-builder-binaries mirror (overrides --npmmirror).
  --full                 Force-run typecheck + @electron/rebuild (disable the
                         skip-* fast-path defaults).

Mirror env vars take a URL; leave unset/empty to disable:
  ELECTRON_MIRROR, ELECTRON_BUILDER_BINARIES_MIRROR
EOF
}

EXTRA_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --clean) EXTRA_ARGS+=("$1") ;;
    --npmmirror)
      # Shortcut: populate both mirror env vars. Explicit --mirror/--binaries-mirror
      # later in argv overrides these.
      ELECTRON_MIRROR="$NPM_MIRROR_ELECTRON"
      ELECTRON_BUILDER_BINARIES_MIRROR="$NPM_MIRROR_BINARIES"
      ;;
    --mirror=*) ELECTRON_MIRROR="${1#*=}" ;;
    --binaries-mirror=*) ELECTRON_BUILDER_BINARIES_MIRROR="${1#*=}" ;;
    --full)
      # Disable the skip-* shortcuts; mirror config is independent so the
      # user keeps whatever mirror they asked for.
      SKIP_TYPECHECK=0
      SKIP_REBUILD=0
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown flag: $1" >&2; usage; exit 2 ;;
  esac
  shift
done

export SKIP_TYPECHECK SKIP_REBUILD
export ELECTRON_MIRROR ELECTRON_BUILDER_BINARIES_MIRROR

# Go through bun to match `package.json`'s `build` script — the build
# script itself shells out to `bun install` / `bun run ...`, so requiring
# bun here keeps the toolchain assumption in one place.
bun scripts/build.ts install ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}

if [ "$WAS_RUNNING" = true ]; then
  echo "Restarting $APP_NAME..."
  open "$DEST/$APP_NAME.app"
fi
