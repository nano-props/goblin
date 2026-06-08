# Create Worktree Modes Design

## Goal

The create-worktree flow should support all common Git worktree creation semantics instead of always creating a new branch. Users should be able to create a worktree from a new branch, an existing local branch, a remote-tracking branch, or a detached ref.

## Scope

In scope:

- Replace the current positional create-worktree arguments with an explicit mode object.
- Preserve the existing "new branch from base" behavior as the default mode.
- Support creating a worktree for an existing local branch without creating a new branch.
- Support selecting a remote-tracking branch and creating a local tracking branch for it.
- Support detached worktree creation from a selected ref.
- Read remote-tracking refs for the dialog without automatically fetching on open.
- Add a manual refresh action that runs fetch and then reloads remote-tracking refs.
- Show detached worktrees in a separate worktree area instead of attaching them to branch rows.
- Keep local and remote SSH repositories behaviorally aligned.

Out of scope:

- Promoting remote branches into the primary branch list model.
- Reworking pull, push, checkout, or pull request behavior around remote branches.
- Accepting arbitrary unlisted refs from free-form user input.
- Automatically fetching when the dialog opens.
- Making detached worktrees participate in branch selection, pull, push, checkout, or PR workflows.

## Current State

`CreateWorktreeDialog` currently emits `worktreePath`, `newBranch`, and `baseBranch`. The renderer store forwards those fields through `repo.createWorktree`, the server route passes them to `createRepositoryWorktree`, and the system layer always runs:

```text
git worktree add -b <newBranch> -- <worktreePath> <baseBranch>
```

Remote SSH worktree creation uses the same fixed semantic through `RemoteCommandKind.gitWorktreeAdd`. Both local and remote branch snapshots read only `refs/heads/`, so the create dialog cannot currently select `origin/foo` style remote-tracking refs.

The renderer branch selection model is branch-centric through `selectedBranch`. Detached worktrees do not have a `refs/heads/*` owner, so treating them as branch rows would misrepresent Git state and risk leaking detached behavior into branch actions.

## Architecture

Use an explicit create-worktree input object and keep all mode interpretation below the UI boundary. This avoids fragile boolean combinations and keeps command construction centralized in the local Git and SSH command layers.

```ts
type CreateWorktreeInput = {
  cwd: string
  worktreePath: string
  mode:
    | { kind: 'newBranch'; newBranch: string; baseRef: string }
    | { kind: 'existingBranch'; branch: string }
    | { kind: 'trackRemoteBranch'; remoteRef: string; localBranch: string }
    | { kind: 'detached'; ref: string }
}
```

The route, web client, RPC type, branch action type, and repository store should carry this object as-is. `createRepositoryWorktree` should validate the request, choose local or remote execution based on the repo id, call the corresponding system helper, and reuse existing read-model invalidation after success.

Local command construction belongs in `src/system/git/worktrees.ts`. Remote SSH command construction belongs in `src/system/ssh/commands.ts`; the server layer should not assemble shell strings.

## Git Semantics

The four modes map to these commands:

```text
newBranch:
git worktree add -b <newBranch> -- <path> <baseRef>

existingBranch:
git worktree add -- <path> <branch>

trackRemoteBranch:
git worktree add -b <localBranch> --track -- <path> <remoteRef>

detached:
git worktree add --detach -- <path> <ref>
```

`trackRemoteBranch` defaults the local branch name by stripping the remote name from the selected remote-tracking ref, such as `origin/feature/a` to `feature/a`. The user can override that local branch name. If the default local branch already exists, the UI should submit `existingBranch` for that branch instead of failing the tracking mode.

`detached` should only use refs selected from known candidates. It should not expose a free-form arbitrary ref field in this change.

If a user edits the derived local branch name in `trackRemoteBranch` and the edited name already exists, the UI should block submission and ask them to use the existing-branch mode. Only the unedited default-name conflict auto-converts to `existingBranch`; this keeps intentional overrides explicit.

## Remote Branch Candidates

Add a small read-only API that lists remote-tracking refs for a repository. It should read local refs for local repositories and remote refs over SSH for remote repositories.

The dialog should load these candidates when opened, without fetching. A refresh button should run the existing fetch workflow, then reload candidates. This keeps dialog open cheap and avoids implicit network mutation, while still letting users choose up-to-date remote branches when needed.

Candidate values should use short names such as `origin/feature/a`. Internal validation may normalize to the accepted Git ref shape before executing.

## UI Design

Keep `CreateWorktreeDialog` as a single dialog. Replace the current fixed base/new-branch form with a compact mode selector:

- New branch: select a base ref and enter a new branch name.
- Existing branch: select a local branch.
- Track remote branch: select a remote branch, show the derived local branch name, and allow editing.
- Detached: select a known ref and show copy that it will not create or switch a branch.

The path field keeps the current behavior. If empty, the dialog shows an auto-derived path. Local repositories keep home-relative display and conversion. Remote repositories keep absolute path and `~/...` support plus existing remote path suggestions.

Submit should build a `CreateWorktreeInput` with exactly one mode. The UI should prevent invalid branch names, missing refs, missing paths, and known local branch conflicts before submit where possible.

## Detached Worktree Presentation

Detached worktrees should render in a separate "Detached worktrees" area below the branch list. A detached worktree is any non-primary, non-bare worktree from `worktreesByPath` whose `branch` is absent.

Each row should show:

- Worktree path.
- Dirty and locked state when available.
- A short detached marker plus the HEAD hash when available from the worktree read model.
- Minimal worktree actions: open terminal, open editor when available, and remove worktree through the safe removal path.

Detached worktrees should not update `selectedBranch`, trigger PR refresh, or expose checkout, pull, or push. This keeps branch workflows branch-owned and avoids pretending detached worktrees are branches.

The worktree read model should preserve detached HEAD information from `git worktree list --porcelain` instead of discarding it. `WorktreeInfo` and renderer `RepoWorktreeState` can add a small optional field, such as `head?: string`, for detached display without changing branch rows.

Terminal ownership should remain keyed by `repoRoot + worktreePath`. Detached terminal display should use a label such as `detached` or the basename of the path rather than writing a synthetic branch into `selectedBranch`. If current terminal types require `branch: string`, narrow that field into a display label or allow a nullable branch owner for detached worktrees.

Removal should extend the existing safe worktree removal checks to accept a worktree-only detached target. It should still block primary, bare, locked, missing, and dirty worktrees unless the existing confirmation and safety rules explicitly allow the operation. It must not attempt branch deletion for detached worktrees.

## Error Handling

Use structured failures where the app can detect invalid input before Git execution:

- `error.invalid-arguments` for malformed mode objects, empty paths, invalid branch names, invalid refs, or missing required fields.
- `error.branch-already-exists` when a requested new local branch conflicts and the UI did not intentionally convert to `existingBranch`.
- `error.remote-ref-missing` when a selected remote-tracking ref no longer exists.

Git and SSH command failures such as path already exists, parent directory missing, permission denied, or network failure should continue to surface through the existing `ExecResult.message` path. Failed creation must not invalidate repository read models.

## Testing

Add focused coverage at each boundary:

- Parser and system tests for listing remote-tracking refs.
- Local Git command tests for all four worktree modes.
- SSH command tests for all four worktree modes and shell quoting.
- Server module tests for mode validation, local and remote dispatch, success invalidation, and failure without invalidation.
- Route and web client tests proving the object-shaped input is passed intact.
- Store tests proving create-worktree actions still queue behind refresh operations and still report result events.
- Dialog tests for mode field visibility, default path derivation, remote branch loading, refresh behavior, derived local branch naming, conflict conversion to existing branch, and detached mode submit.
- Detached worktree UI tests proving detached rows render separately and do not affect `selectedBranch`.

## Verification

Implementation should pass:

```text
bun run typecheck
bun run test
bun run check:architecture
```

Manual verification should cover:

- Creating a worktree from a new branch.
- Creating a worktree from an existing local branch.
- Creating a worktree from `origin/foo` with the default derived local branch.
- Creating a worktree from `origin/foo` when `foo` already exists, confirming it uses the existing branch mode.
- Creating a detached worktree and confirming it appears in the detached worktrees area without becoming the selected branch.
- Repeating the supported modes on a saved remote SSH repository.
