# Android Worktree Terminal MVP Design

## Goal

Phase 3 delivers the core emergency workflow around remote Git worktrees: open a terminal in a selected worktree, create a remote worktree from a branch, and remove a remote worktree only when safety checks pass and the user confirms.

## Scope

In scope:

- Worktree-scoped terminal ownership using the existing SSH terminal implementation.
- Create a remote worktree from a selected branch/base ref.
- Default worktree path suggestion with user override.
- Refresh repository snapshot after create/remove operations.
- Safe remove checks for primary, locked, dirty, missing, and protected-branch worktrees.
- Confirmation text that clearly states removal affects the remote SSH server worktree.

Out of scope:

- Branch checkout/pull/push flows.
- Branch deletion.
- Force removal of dirty/locked worktrees.
- Prunable/missing worktree cleanup.
- Local Android terminal or local Git worktree management.

## Architecture

Keep `RemoteRepositoryGitService` focused on read snapshots. Add a small `RemoteWorktreeService` for explicit remote worktree mutations. This keeps read model code and write-action safety code separate.

Repository UI remains the orchestration surface:

- `RepositoryWorkspaceScreen` displays worktrees from the current snapshot.
- It calls `RemoteWorktreeService.createWorktree()` for create actions.
- It calls `RemoteWorktreeService.removeWorktree()` only after a safety check and confirmation.
- It opens `TerminalScreen` with the selected worktree path using the existing route.

Terminal internals stay runtime-only. Any worktree terminal state should be derived from route owner info and not persisted in repository records.

## Safety Model

Removal is blocked when:

- The worktree is primary.
- The worktree is dirty.
- The worktree is locked.
- The worktree is missing/prunable.
- The branch is protected: `main`, `master`, `develop`, or `release/*`.

Removal is allowed only for linked, clean, unlocked, existing, non-protected worktrees. The confirmation dialog must say it removes the remote worktree on the SSH server.

## Testing

Use TDD:

- Unit tests for path suggestions and worktree terminal path selection.
- Service tests for worktree create/remove scripts and host-key trust gating.
- Safety tests for every blocked removal condition and allowed removal.
- UI state tests for create/remove action visibility and confirmation copy helpers.

