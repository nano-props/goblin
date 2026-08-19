#!/usr/bin/env bash

set -euo pipefail

REPO_PATH=$1

while IFS= read -r REMOTE; do
  FETCH_URL=$(git -C "$REPO_PATH" remote get-url --all -- "$REMOTE")
  PUSH_URL=$(git -C "$REPO_PATH" remote get-url --push --all -- "$REMOTE")
  printf '%s\t%s\t%s\n' "$REMOTE" "$FETCH_URL" "$PUSH_URL"
done < <(git -C "$REPO_PATH" remote)
