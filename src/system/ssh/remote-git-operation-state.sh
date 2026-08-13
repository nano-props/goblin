#!/usr/bin/env bash

set -euo pipefail

REPO_PATH=$1
cd -- "$REPO_PATH"

GIT_PATH_OUTPUT=$(git rev-parse \
  --git-path rebase-merge \
  --git-path rebase-apply \
  --git-path CHERRY_PICK_HEAD \
  --git-path REVERT_HEAD \
  --git-path BISECT_LOG \
  --git-path BISECT_START \
  --git-path MERGE_HEAD)
GIT_PATHS=()
while IFS= read -r GIT_PATH; do
  GIT_PATHS[${#GIT_PATHS[@]}]=$GIT_PATH
done <<<"$GIT_PATH_OUTPUT"
[ "${#GIT_PATHS[@]}" -eq 7 ] || exit 1
for GIT_PATH in "${GIT_PATHS[@]}"; do
  [ -n "$GIT_PATH" ] || exit 1
done

REBASE_MERGE=${GIT_PATHS[0]}
REBASE_APPLY=${GIT_PATHS[1]}
CHERRY_PICK_HEAD=${GIT_PATHS[2]}
REVERT_HEAD=${GIT_PATHS[3]}
BISECT_LOG=${GIT_PATHS[4]}
BISECT_START=${GIT_PATHS[5]}
MERGE_HEAD=${GIT_PATHS[6]}

if [ -d "$REBASE_MERGE" ]; then
  printf 'rebase\n'
  [ ! -f "$REBASE_MERGE/head-name" ] || cat "$REBASE_MERGE/head-name"
  exit 0
fi

if [ -d "$REBASE_APPLY" ]; then
  printf 'rebase\n'
  [ ! -f "$REBASE_APPLY/head-name" ] || cat "$REBASE_APPLY/head-name"
  exit 0
fi

if [ -e "$CHERRY_PICK_HEAD" ]; then
  printf 'cherry-pick\n'
  exit 0
fi

if [ -e "$REVERT_HEAD" ]; then
  printf 'revert\n'
  exit 0
fi

if [ -e "$BISECT_LOG" ]; then
  printf 'bisect\n'
  [ ! -f "$BISECT_START" ] || cat "$BISECT_START"
  exit 0
fi

if [ -e "$MERGE_HEAD" ]; then
  printf 'merge\n'
  exit 0
fi

printf 'none\n'
