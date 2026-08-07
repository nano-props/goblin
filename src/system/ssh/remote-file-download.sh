#!/bin/sh

set -eu

ROOT_PATH=$1
MARKER=$2
shift 2

fail() {
  printf '%s\n' "$1" >&2
  exit "$2"
}

[ "$#" -gt 0 ] || fail error.invalid-path 65
[ -n "$MARKER" ] || fail error.file-download-protocol-invalid 65
cd -- "$ROOT_PATH" || fail error.workspace-path-not-found 66

# Reject every symlinked segment so the opened file cannot escape the
# authoritative workspace root between validation and read.
while [ "$#" -gt 1 ]; do
  ENTRY=$1
  [ ! -L "$ENTRY" ] || fail error.file-download-symlink-unsupported 68
  cd -- "$ENTRY" || fail error.file-not-found 69
  shift
done

FILE=$1
[ ! -L "$FILE" ] || fail error.file-download-symlink-unsupported 68
[ -e "$FILE" ] || fail error.file-not-found 69
[ -f "$FILE" ] || fail error.file-download-regular-file-required 70
[ -r "$FILE" ] || fail error.workspace-permission-denied 71

printf '%s\n' "$MARKER"
exec cat -- "$FILE"
