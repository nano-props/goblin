# Workspace Pane View PR TODO

Context: PR https://github.com/nano-props/goblin/pull/68, branch `feat/tabs`, base `main`.

## Final PR Review

- [ ] Confirm the PR is based on the latest `main`.
- [ ] Review the full PR diff one final time, focusing on:
  - workspace pane view type boundaries
  - server-side ordering and static view state
  - renderer reconciliation and optimistic rollback
  - branch action entry points for status/changes views
  - leftover legacy naming that is not migration-only
- [ ] Verify `detailTabByRepo` remains migration-only and no new code writes it.
- [ ] Run the required local checks:
  - `bun run typecheck`
  - `bun run check:architecture`
  - focused tests for workspace pane view, terminal registry, branch toolbar, and shared validators
- [ ] Record any full-test limitation explicitly if `bun run test` is blocked by the Electron install path.

## Push And PR Readiness

- [ ] Confirm the working tree is clean with `git status --short --branch`.
- [ ] Confirm `git stash list` is empty.
- [ ] Push the final branch state to `origin/feat/tabs`.
- [ ] Confirm the PR is open, not draft, and targets `main`.
- [ ] Confirm GitHub reports the PR merge state as `CLEAN`.
- [ ] Confirm any required GitHub checks are passing, or note when no checks are reported.

## Squash Merge To Main

- [ ] Squash merge PR #68 into `main`.
- [ ] Use a final squash title that describes the architectural change, for example:
  `Refactor detail tabs into workspace pane views`
- [ ] After merge, update local `main` from `origin/main`.
- [ ] Confirm the squash commit is present on local `main`.

## Local Branch Cleanup

- [ ] Switch off `feat/tabs` before deleting it.
- [ ] Delete the local branch only after the squash merge is confirmed on `main`.
- [ ] Confirm `git branch --list feat/tabs` returns no local branch.
- [ ] Leave the worktree clean.
