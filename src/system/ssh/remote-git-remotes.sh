#!/usr/bin/env bash

set -euo pipefail

REPO_PATH=$1

while IFS= read -r REMOTE; do
  mapfile -t FETCH_URLS < <(git -C "$REPO_PATH" remote get-url --all -- "$REMOTE")
  mapfile -t PUSH_URLS < <(git -C "$REPO_PATH" remote get-url --push --all -- "$REMOTE")
  ((${#FETCH_URLS[@]} > 0 && ${#PUSH_URLS[@]} > 0))
  printf '%s\t%s\t%s\n' "$REMOTE" "${FETCH_URLS[-1]}" "${PUSH_URLS[-1]}"
done < <(git -C "$REPO_PATH" remote)
