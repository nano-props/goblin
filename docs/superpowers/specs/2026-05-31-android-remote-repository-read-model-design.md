# Android Remote Repository Read Model Design

## Goal

Phase 2 completes the Android remote repository read model on top of the Phase 1 SSH foundation. The app should let a user browse remote directories over SSH, validate and save a remote Git repository without cloning it locally, reopen saved repository records, manually refresh repository state, and inspect branches, commits, dirty status, and worktrees.

## Scope

In scope:

- Remote directory browsing over a trusted SSH host.
- Save only app-local remote repository records.
- Validate a remote path with Git before saving it.
- Load current branch/ref, default branch, recent commits, status lines, branch list, and worktree list.
- Distinguish primary, linked, locked, missing, dirty, and bare worktrees.
- Show loading, loaded, stale, failed, empty, and retry states in repository UI.
- Preserve the existing terminal entry that opens at the selected repository or worktree path.

Out of scope:

- Local Android clone.
- `git pull`, `git push`, checkout, branch mutation, or remote worktree deletion.
- Deleting anything from the SSH server.
- Background polling or hidden refresh.

## Architecture

Keep the existing boundaries:

- `RemoteRepositoryProfile` remains the persistent saved repository record.
- `RemoteRepositoryStore` stores only local metadata: repository id, host profile id, alias, and remote path.
- `RemoteRepositoryGitService` owns SSH read commands and Git output parsing.
- `RepositorySetupScreen` owns adding/browsing saved repositories.
- `RepositoryWorkspaceScreen` owns snapshot display and manual refresh.

Add small read-only domain models for directory entries, validation results, commits, and richer worktree state. The SSH service should validate host-key trust before every read operation, then run quoted shell commands through `SshClientFacade.runCommand`.

## Data Flow

1. Add Project receives authenticated host profiles only.
2. User browses or types a remote path.
3. User triggers validation/save.
4. `RemoteRepositoryGitService.inspectRepository()` verifies the path is a Git repo and returns display metadata.
5. UI saves a `RemoteRepositoryProfile` locally.
6. Repository workspace manually calls `loadSnapshot()` when opened or refreshed.
7. UI renders snapshot data; failed refresh keeps the last loaded snapshot as stale when available.

## Error Handling

SSH host key mismatch or unknown trust must block repository reads. Missing paths, non-Git paths, missing Git binary, and command failures should surface concise messages with retry actions. If refresh fails after a successful load, show stale data plus the failure reason instead of blanking the screen.

## Testing

Use TDD for Phase 2 behavior:

- Parser tests for directory entries, commits, default branch, dirty counts, locked and missing worktrees.
- Service tests with fake SSH client and fake host-key store for trust blocking and validation failure messages.
- UI state tests for browse/save enablement, stale fallback, and local-only deletion.
- Store tests that persistent payload excludes SSH/session/secret fields.

