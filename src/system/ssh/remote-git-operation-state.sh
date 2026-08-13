#!/usr/bin/env bash

set -euo pipefail

REPO_PATH=$1
ATTACHED_BRANCH=$2
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

REBASE_DIRECTORY=
if [ -d "$REBASE_MERGE" ]; then
  REBASE_DIRECTORY=$REBASE_MERGE
elif [ -d "$REBASE_APPLY" ]; then
  REBASE_DIRECTORY=$REBASE_APPLY
fi

if [ -n "$REBASE_DIRECTORY" ]; then
  OPERATION=rebase
elif [ -e "$CHERRY_PICK_HEAD" ]; then
  OPERATION=cherry-pick
elif [ -e "$REVERT_HEAD" ]; then
  OPERATION=revert
elif [ -e "$MERGE_HEAD" ]; then
  OPERATION=merge
elif [ -e "$BISECT_LOG" ]; then
  OPERATION=bisect
else
  OPERATION=none
fi

MATERIALIZED_BRANCH=$ATTACHED_BRANCH
if [ -z "$MATERIALIZED_BRANCH" ] && [ -n "$REBASE_DIRECTORY" ] && [ -f "$REBASE_DIRECTORY/head-name" ]; then
  REBASE_HEAD_NAME=$(<"$REBASE_DIRECTORY/head-name")
  if [[ "$REBASE_HEAD_NAME" == refs/heads/* ]]; then
    MATERIALIZED_BRANCH=$REBASE_HEAD_NAME
  fi
fi
if [ -z "$MATERIALIZED_BRANCH" ] && [ -e "$BISECT_LOG" ] && [ -f "$BISECT_START" ]; then
  MATERIALIZED_BRANCH=$(<"$BISECT_START")
  if [ "$MATERIALIZED_BRANCH" = 'detached HEAD' ] || [[ "$MATERIALIZED_BRANCH" =~ ^[0-9a-fA-F]{40,64}$ ]]; then
    MATERIALIZED_BRANCH=
  elif [ "$OPERATION" = rebase ] && [[ "$MATERIALIZED_BRANCH" != refs/heads/* ]]; then
    MATERIALIZED_BRANCH=refs/heads/$MATERIALIZED_BRANCH
  fi
fi

printf 'operation %s\n' "$OPERATION"
if [ -n "$MATERIALIZED_BRANCH" ]; then
  printf 'materialized-branch %s\n' "$MATERIALIZED_BRANCH"
else
  printf 'materialized-branch\n'
fi
