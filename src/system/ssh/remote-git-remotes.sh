#!/usr/bin/env bash

set -euo pipefail

REPO_PATH=$1
REMOTE_OUTPUT=$(git -C "$REPO_PATH" remote)

read_git_scalar() {
  local FRAMED_OUTPUT
  # Command substitution strips trailing newlines. The sentinel preserves them
  # until we can remove exactly one Git record terminator. The result is REPLY.
  FRAMED_OUTPUT=$("$@" && printf '\x1f')
  FRAMED_OUTPUT=${FRAMED_OUTPUT%$'\x1f'}
  [[ "$FRAMED_OUTPUT" == *$'\n' ]]
  REPLY=${FRAMED_OUTPUT%$'\n'}
}

if [[ -z "$REMOTE_OUTPUT" ]]; then
  exit 0
fi

while IFS= read -r REMOTE; do
  read_git_scalar git -C "$REPO_PATH" remote get-url -- "$REMOTE"
  FETCH_URL=$REPLY
  read_git_scalar git -C "$REPO_PATH" remote get-url --push -- "$REMOTE"
  PUSH_URL=$REPLY
  [[ -n "$FETCH_URL" && -n "$PUSH_URL" ]]
  printf '%s\0%s\0%s\0' "$REMOTE" "$FETCH_URL" "$PUSH_URL"
done <<< "$REMOTE_OUTPUT"
