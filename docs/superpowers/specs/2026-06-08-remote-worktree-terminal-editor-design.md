# Remote Worktree Terminal And Editor Design

## Goal

Remote repositories should support the same branch worktree actions users expect from local repositories: open a worktree terminal and open the worktree in the configured editor. Terminal opens inside Goblin's existing SSH-backed Terminal detail tab. Editor opens the selected remote worktree in the user's configured VS Code-family editor through Remote SSH semantics.

## Scope

In scope:

- Show Terminal and Edit actions for remote branches that have a worktree path.
- Open remote terminals through the existing Goblin Terminal detail tab and server terminal catalog.
- Add a remote editor opener for VS Code-family editors using the configured SSH alias and remote worktree path.
- Preserve all existing local repository terminal and editor behavior.
- Re-resolve SSH config before remote editor execution.
- Surface clear errors for unsupported editors, missing CLIs, invalid remote paths, and changed SSH config.

Out of scope:

- Built-in remote file editing.
- Opening remote terminals in external macOS terminal applications.
- Installing or configuring Remote SSH extensions.
- Accepting arbitrary host, user, or port input outside the existing SSH config alias model.
- A broad local/remote opener refactor.

## Architecture

Keep the current server-first architecture.

Remote terminal support already exists in `src/server/terminal/terminal-catalog.ts`. When `repoRoot` is an `ssh-config://...` id, the catalog resolves the SSH config target and builds an SSH terminal invocation that changes into the selected `worktreePath` before starting the remote login shell. The feature should reuse this path and only enable the UI action that is currently disabled for remote worktrees.

Remote editor support should be added as a small server-side opener. Local editor behavior remains owned by the existing `openRepositoryEditor(path)` path. Remote editor behavior should have a separate function that accepts a remote repo locator plus a worktree path, resolves the SSH config alias, reads the configured editor preference, and dispatches to a VS Code-family remote opener.

The editor backend should stay close to the existing `src/system/open-app.ts` abstraction. It may add a remote-specific helper beside the local directory opener, but it should not make local path validation accept remote paths. This keeps local filesystem safety and remote URI construction separate.

## Data Flow

Remote terminal:

1. The user selects Terminal on a remote branch with `branch.worktree.path`.
2. `useBranchActions.openTerminal()` detects `repo.remote.target`.
3. The action switches the current repository detail pane to `terminal`.
4. `TerminalSlot` and the terminal session registry use the remote `repo.id` as `repoRoot` and the selected worktree path as `worktreePath`.
5. The server terminal catalog identifies the remote repo id, resolves SSH config, and creates or restores the remote SSH terminal session.

Remote editor:

1. The user selects Edit on a remote branch with `branch.worktree.path`.
2. The frontend calls a remote editor endpoint with the remote repo id and worktree path.
3. The server validates the repo locator and remote absolute path.
4. The server re-resolves the SSH config alias from the repo id.
5. The configured editor backend opens the remote SSH workspace.
6. The frontend handles the result through the existing branch action result and toast path.

## Editor Semantics

VS Code should use the official CLI remote form:

```text
code --remote ssh-remote+<alias> <remotePath>
```

Cursor and Windsurf should share the same remote opener shape only when their bundled CLIs accept equivalent Remote SSH arguments. If a selected editor CLI is unavailable or rejects the remote arguments, Goblin returns a clear failure instead of silently opening a local path or falling back to a different editor.

The remote opener does not persist editor session state. It also does not install extensions, modify SSH config, or expand host/user/port fields into a direct SSH destination. The SSH config alias remains the source of truth.

## Capability Rules

Remote worktree action visibility should follow these rules:

- Terminal is visible for any branch with a worktree path, local or remote.
- Remote Terminal does not depend on local terminal app availability because it opens inside Goblin.
- Editor is visible for any branch with a worktree path when the configured editor is available.
- Remote Editor reports unsupported remote behavior at execution time if the selected editor cannot open Remote SSH workspaces.
- Branches without worktree paths continue to hide Terminal and Edit.

## Error Handling

Remote terminal uses the existing terminal failure model. SSH config changes should surface as `error.ssh-config-changed`. If the remote worktree cannot be entered, the SSH shell invocation fails or exits and the terminal UI displays the existing failed or exited state.

Remote editor should return structured `ExecResult` failures:

- `error.invalid-arguments` for invalid repo ids or invalid worktree paths.
- `error.ssh-config-changed` when the saved remote repo id no longer resolves through SSH config.
- `error.editor-not-installed` when the selected editor CLI cannot be found.
- `error.remote-editor-not-supported` when the selected editor has no supported Remote SSH open path.
- CLI stderr or short error output when the editor CLI exists but fails.

No error path should mutate repository state.

## Testing

Use focused TDD coverage:

- `getBranchActionCapabilities` allows Terminal and Editor for remote branches with worktrees and still disables both when no worktree path exists.
- `useBranchActionItems` shows remote Terminal without depending on local terminal availability.
- `useBranchActions.openTerminal()` switches remote repositories to the Terminal detail tab and does not call the local `/api/repo/open-terminal` route.
- Remote editor client and route tests cover success, invalid repo id, invalid worktree path, and SSH config changed.
- System editor tests cover remote VS Code CLI arguments, missing CLI, unsupported editor behavior, and CLI failure output.
- Existing local terminal and editor tests remain unchanged and green.

## Verification

Implementation should pass:

- `bun run typecheck`
- `bun run test`
- `bun run check:architecture`

Manual verification should open a saved remote repository, select a branch with a linked worktree, open Terminal, confirm the shell starts inside that remote worktree, then open Edit and confirm the configured editor opens the same remote worktree through Remote SSH.
