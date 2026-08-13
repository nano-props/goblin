#!/usr/bin/env bash

set -euo pipefail

COMMON_DIR=${1%/}
WORKTREE_PATH=${2%/}
IS_PRIMARY=$3
ATTACHED_BRANCH=$4

if [ "$IS_PRIMARY" = 1 ]; then
  GIT_DIR=$COMMON_DIR
elif [ "$IS_PRIMARY" = 0 ]; then
  GIT_DIR=
  MATCH_COUNT=0
  for CANDIDATE_GIT_DIR in "$COMMON_DIR"/worktrees/*; do
    [ -d "$CANDIDATE_GIT_DIR" ] || continue
    [ -f "$CANDIDATE_GIT_DIR/gitdir" ] || continue
    GITDIR_POINTER=$(<"$CANDIDATE_GIT_DIR/gitdir")
    case "$GITDIR_POINTER" in
      /*/.git) CANDIDATE_WORKTREE_PATH=${GITDIR_POINTER%/.git} ;;
      *) continue ;;
    esac
    if [ "${CANDIDATE_WORKTREE_PATH%/}" = "$WORKTREE_PATH" ]; then
      GIT_DIR=$CANDIDATE_GIT_DIR
      MATCH_COUNT=$((MATCH_COUNT + 1))
    fi
  done
  [ "$MATCH_COUNT" -eq 1 ] || exit 1
else
  exit 1
fi

GIT_PATH_OUTPUT=$(git --git-dir="$GIT_DIR" rev-parse \
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
