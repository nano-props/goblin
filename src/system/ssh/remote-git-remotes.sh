#!/usr/bin/env bash

set -euo pipefail

REPO_PATH=$1
REMOTE_OUTPUT=$(git -C "$REPO_PATH" remote)

if [[ -z "$REMOTE_OUTPUT" ]]; then
  exit 0
fi

while IFS= read -r REMOTE; do
  FETCH_URL=$(git -C "$REPO_PATH" remote get-url -- "$REMOTE")
  PUSH_URL=$(git -C "$REPO_PATH" remote get-url --push -- "$REMOTE")
  [[ -n "$FETCH_URL" && -n "$PUSH_URL" ]]
  printf '%s\0%s\0%s\0' "$REMOTE" "$FETCH_URL" "$PUSH_URL"
done <<< "$REMOTE_OUTPUT"
