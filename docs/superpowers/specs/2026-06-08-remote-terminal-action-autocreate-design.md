# Remote External Terminal Action Design

## Goal

Remote repository branch actions should open the selected remote worktree in the user's configured local terminal application. The terminal action means: start a local terminal window, SSH to the configured remote host, change into the branch worktree path, and start the remote login shell.

This replaces the earlier "remote terminal action autocreate" direction and supersedes the remote Terminal behavior described in the remote worktree terminal/editor design. Remote branch Terminal actions should not open Goblin's in-app Terminal detail tab and should not create Goblin-managed terminal sessions.

## Scope

In scope:

- Remote branch `Terminal` calls a remote external terminal opener.
- Local branch `Terminal` keeps the existing local external terminal behavior.
- The remote opener uses the repository's SSH config alias as the source of truth.
- The server re-resolves SSH config before opening the terminal.
- Apple Terminal and Ghostty support remote command launch through the existing terminal preference resolver.
- Clear structured errors are returned for invalid input, changed SSH config, missing terminal apps, unsupported terminal backends, and terminal launch failures.

Out of scope:

- Goblin in-app terminal session creation for remote branch actions.
- Automatic navigation to the Terminal detail tab for remote branch actions.
- SSH config editing or host setup.
- Installing terminal applications.
- Supporting arbitrary SSH destinations that are not defined by the saved remote repository id.
- Remote command execution beyond opening an interactive shell in the selected worktree.

## Architecture

Keep the server-first boundary used by existing remote repository actions.

The frontend should route remote branch `Terminal` through a new app-data client function:

```ts
openRemoteRepositoryTerminal(repo.id, worktreePath)
```

That client posts to a new server route:

```text
POST /api/remote/open-terminal
```

The server should add `openServerRemoteTerminal({ repoId, worktreePath })` beside `openServerRemoteEditor()`. It validates the remote repo locator, parses the SSH config alias from `repoId`, re-resolves the current SSH config, reads the terminal preference, and calls a terminal-system helper.

The terminal registry in `src/system/terminals.ts` should keep local and remote responsibilities separate:

```ts
interface TerminalBackend {
  isInstalled: () => boolean
  open: (path: string) => Promise<ExecResult>
  openRemote?: (alias: string, remotePath: string) => Promise<ExecResult>
}
```

Local path validation stays in local terminal backends. Remote alias/path validation and SSH command construction stay in a remote-specific helper. Remote paths must not be treated as local filesystem paths.

## Data Flow

1. User chooses `Terminal` on a remote branch with `branch.worktree.path`.
2. `useBranchActions.openTerminal()` detects `repo.remote.target`.
3. The hook calls `openRemoteRepositoryTerminal(repo.id, branch.worktree.path)`.
4. The web client posts `{ repoId, worktreePath }` to `/api/remote/open-terminal`.
5. The server validates `repoId` and `worktreePath`.
6. The server parses the SSH config alias from `repoId` and re-resolves it through current SSH config.
7. The server calls `openRemoteInPreferredTerminal(alias, worktreePath, terminalPref)`.
8. The selected terminal backend opens a local terminal window running SSH into the remote worktree.

Local branch terminal actions continue to call:

```ts
openRepositoryTerminal(worktreePath)
```

## Remote Terminal Semantics

The local terminal should run an SSH command equivalent to:

```bash
ssh -tt -- <alias> 'cd <remote-worktree-path> && exec "${SHELL:-/bin/sh}" -l'
```

Implementation details should avoid interpolating unchecked user input into shell text:

- `alias` must be a safe SSH config alias.
- `remotePath` must be an absolute remote path and must not contain control characters.
- The remote `cd` script must shell-quote the worktree path.
- Terminal backends should receive a prepared command/arguments shape rather than rebuilding validation inconsistently.

The command should allocate a TTY and leave the user in an interactive remote login shell. If `cd` fails, the SSH command should fail in the terminal window; Goblin does not mutate repository state.

## Terminal Backends

Apple Terminal should support remote launch by opening Terminal.app with a command that runs the prepared SSH invocation. The implementation may use AppleScript or another existing macOS-safe mechanism, but user-controlled values must be passed as arguments where possible.

Ghostty should support remote launch by opening a new window with the prepared command. If Ghostty is already running, use the same care as the existing local opener to avoid launching duplicate app instances unnecessarily. Cold start may use Ghostty command arguments when available.

If a future terminal backend can open directories but cannot run a remote command, it should omit `openRemote` and let the registry return `error.remote-terminal-not-supported`.

## UI Behavior

Remote Terminal success is silent, matching existing branch action behavior for terminal/editor commands.

Remote Terminal failure uses the existing branch action result/toast path.

The action should not:

- Select the clicked branch solely for terminal navigation.
- Switch to the Terminal detail tab.
- Expand the detail pane.
- Create, select, or reuse a Goblin terminal session.

## Error Handling

Return structured `ExecResult` failures:

- `error.invalid-arguments` when `repoId` is not a remote repo id or `worktreePath` is not a valid absolute remote path.
- `error.ssh-config-changed` when the saved remote repo id no longer resolves through SSH config.
- `error.terminal-not-installed` when the selected terminal is unavailable or `auto` finds no usable backend.
- `error.remote-terminal-not-supported` when the selected backend has no remote command opener.
- A short terminal launch error message when the terminal app exists but launch fails.

No error path should mutate repository state.

## Testing

Focused tests should cover:

- `openRemoteInPreferredTerminal()` selects an explicitly configured terminal backend.
- `openRemoteInPreferredTerminal()` follows auto priority.
- `openRemoteInPreferredTerminal()` returns `error.terminal-not-installed` when no backend is available.
- `openRemoteInPreferredTerminal()` returns `error.remote-terminal-not-supported` for an installed backend without `openRemote`.
- Apple Terminal and Ghostty remote opener tests verify SSH command construction without running real SSH.
- `openServerRemoteTerminal()` covers success, invalid repo id, invalid remote path, and SSH config changed.
- `/api/remote/open-terminal` forwards request body fields to the server module.
- `openRemoteRepositoryTerminal()` posts to `/api/remote/open-terminal`.
- `useBranchActions.openTerminal()` calls the remote terminal client for remote repos and does not call navigation or Goblin terminal session APIs.
- Local `useBranchActions.openTerminal()` still calls `openRepositoryTerminal(worktreePath)`.

## Verification

Run:

```bash
bun run test src/system/terminals.test.ts src/server/modules/remote.test.ts src/server/routes/remote.test.ts src/web/app-data-client.test.ts src/web/hooks/useBranchActions.test.tsx
bun run typecheck
bun run check:architecture
```

Manual verification:

1. Open a saved remote repository.
2. Choose a branch that has a remote worktree path.
3. Select `Terminal`.
4. Confirm the configured local terminal app opens.
5. Confirm the terminal SSHes through the saved SSH config alias and starts in the selected remote worktree.
6. Confirm Goblin does not switch to the in-app Terminal detail tab or create an in-app terminal session.
