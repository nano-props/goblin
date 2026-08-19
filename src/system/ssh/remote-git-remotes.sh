#!/usr/bin/env bash

set -euo pipefail

REPO_PATH=$1
REMOTE_OUTPUT=$(git -C "$REPO_PATH" remote)

if [[ -z "$REMOTE_OUTPUT" ]]; then
  exit 0
fi

while IFS= read -r REMOTE; do
  FETCH_OUTPUT=$(git -C "$REPO_PATH" remote get-url --all -- "$REMOTE")
  PUSH_OUTPUT=$(git -C "$REPO_PATH" remote get-url --push --all -- "$REMOTE")
  mapfile -t FETCH_URLS <<< "$FETCH_OUTPUT"
  mapfile -t PUSH_URLS <<< "$PUSH_OUTPUT"
  [[ -n "$FETCH_OUTPUT" && -n "$PUSH_OUTPUT" ]]
  printf '%s\t%s\t%s\n' "$REMOTE" "${FETCH_URLS[-1]}" "${PUSH_URLS[-1]}"
done <<< "$REMOTE_OUTPUT"
