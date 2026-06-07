# Android Termux Handoff And Runtime Design

## Summary

Goblin Android should add two Termux-oriented terminal paths alongside the existing Goblin-owned remote SSH terminal:

1. External Termux handoff.
2. A later embedded Termux-like local runtime technical validation.

The implementation order is external handoff first, embedded runtime second.

This design prioritizes functional reality over full release packaging work. License and source-distribution work does not block the first functional phases, but embedded runtime release builds must remain gated until compliance is explicitly handled.

## Goals

- Add an `External Termux` terminal mode in the repository Terminal tab.
- Generate a safe SSH command for the current host, port, user, and repository/worktree path.
- Prefer Termux direct command execution when the installed Termux app supports it.
- Fall back to copying the command and opening Termux when direct execution is unavailable.
- Add a later `Local runtime` mode that uses an APK-bundled Termux-like runtime.
- Make the local runtime default to SSH into the current repository/worktree, not an empty local shell.
- Reuse Goblin's existing host profile and SSH identity data for local-runtime SSH.
- Keep the existing Goblin `Remote SSH` terminal mode available.

## Non-Goals

- Do not make `External Termux` sessions part of Goblin's terminal session records.
- Do not require the external Termux app for Goblin's current `Remote SSH` terminal mode.
- Do not implement online `pkg` or `apt` package management in the first embedded-runtime phase.
- Do not promise release-ready embedded runtime packaging until license, source, attribution, and binary provenance work is complete.
- Do not replace the current SSHJ terminal immediately; its disconnect bug remains a separate fix.

## User Flow

The repository Terminal tab becomes the unified terminal entry point.

Terminal modes:

```text
Remote SSH | External Termux | Local runtime
```

Flow:

```text
Projects -> Repository -> Terminal tab
  -> Select workspace
  -> Select terminal mode
  -> Remote SSH: use current Goblin terminal
  -> External Termux: hand off current workspace to installed Termux
  -> Local runtime: use bundled runtime ssh into current workspace
```

All modes operate around the selected repository/worktree path so users do not need to learn separate terminal concepts.

## Phase 1: External Termux Handoff

`External Termux` is the first implementation phase because it gives users a practical escape hatch while keeping Goblin's architecture small.

The screen shows:

- Current target: `user@host:port`.
- Current path: selected repository/worktree path.
- Primary action: `Open in Termux`.
- Secondary action: `Copy command`.
- Status: `ready`, `command copied`, `opened in Termux`, `Termux not installed`, `Termux command API unavailable`, or `failed`.

The direct handoff path should:

1. Build a command for the current workspace.
2. Check whether Termux is installed.
3. Prefer the Termux command execution intent when available.
4. Fall back to copying the command and opening Termux when direct execution fails or is unavailable.
5. Leave Goblin terminal session records unchanged.

The command shape should be equivalent to:

```bash
ssh -p <port> <user>@<host> -t 'cd <remote-path> && exec "$SHELL" -l'
```

Every interpolated shell value must be shell-quoted.

External Termux authentication is not managed by Goblin in Phase 1. Goblin must not export private keys into the external Termux app. If the user's Termux environment does not already have SSH authentication configured, the external SSH command may prompt or fail in Termux. Any opt-in key export to external Termux is a separate future design because it transmits sensitive identity material to another app.

Termux `RUN_COMMAND` integration constraints:

- Goblin must request `com.termux.permission.RUN_COMMAND` before attempting direct execution.
- The user may need to grant that permission through Android app settings.
- Because Goblin targets Android 11 or newer, package visibility declarations are required for Termux detection and direct command execution.
- Implementation should verify the current Termux intent action, component, and extras against the official Termux `RUN_COMMAND` documentation before wiring production code.
- Phase 1 should avoid importing `termux-shared` unless a dependency and license review explicitly accepts it; hardcoded constants are acceptable only when covered by tests and documented against the verified Termux contract.

## Phase 2: Local Runtime Technical Validation

`Local runtime` is the second phase. It validates whether Goblin can bundle and run a Termux-like runtime from app-private storage.

Runtime scope:

- Bundle runtime assets in the APK.
- Start with one ABI, expected to be `arm64-v8a`.
- Initialize an app-private `$PREFIX`.
- Include a Termux-like environment with common tools such as `bash`, coreutils, `ssh`, and `git`.
- Do not support online package installation in this phase.
- Do not require an installed Termux app.

Default terminal behavior:

- Launch a local subprocess from the bundled runtime.
- Use bundled `ssh` to connect to the current Goblin host.
- `cd` to the selected repository/worktree path after connection.
- Render the terminal through the current Termux emulator/rendering layer already used by Goblin.

This mode creates a Goblin-owned terminal session because the subprocess is owned by Goblin.

## Component Boundaries

### `TermuxCommandBuilder`

Builds shell-safe commands for both external handoff and local runtime SSH entry.

Responsibilities:

- Format host, port, user, and remote path into a shell command.
- Shell-quote all dynamic values.
- Keep command generation independent from Android intents and UI.

### `ExternalTermuxLauncher`

Owns Android integration with the installed Termux app.

Responsibilities:

- Detect whether Termux is installed.
- Attempt direct command execution through the supported Termux command intent path.
- Fall back to clipboard and app-open behavior.
- Return structured results: `Launched`, `CopiedFallback`, `Unavailable`, or `Failed`.

Non-responsibilities:

- It does not create Goblin terminal session records.
- It does not own SSH identity material.
- It does not render terminal UI.

### `LocalRuntimeManager`

Owns the embedded runtime lifecycle.

Responsibilities:

- Detect whether the bundled runtime is initialized.
- Initialize app-private runtime directories.
- Verify runtime version and ABI.
- Export Goblin-managed SSH identity material into runtime-private `.ssh`.
- Write runtime ssh config and known host data.
- Reset or repair the runtime when requested.

### `LocalRuntimeTerminalService`

Owns local subprocess terminal sessions for the embedded runtime.

Responsibilities:

- Start the local runtime process.
- Default the process to SSH into the selected workspace.
- Stream raw bytes into the existing terminal emulator bridge.
- Accept raw terminal input bytes.
- Close the subprocess on session close.

This service is analogous to `SshTerminalService`, but the backend is a local subprocess rather than SSHJ.

### `TerminalSessionRecord`

Goblin-owned sessions need a backend kind once local runtime sessions exist.

Expected backend kinds:

```text
RemoteSsh
LocalRuntime
```

`ExternalTermux` is intentionally excluded because those sessions live in another app.

## SSH Identity Handling

The first local-runtime version reuses Goblin's existing SSH identity.

Behavior:

- Load the selected identity from `SecureIdentityStore`.
- Export it to a runtime-private `.ssh` file.
- Set restrictive file permissions.
- Generate runtime ssh config for the current host.
- Clean up managed keys when the host is deleted or runtime reset runs.

This is a pragmatic first version. A future version can replace exported keys with an in-process signing or agent-style bridge.

## Failure Handling

External Termux failures:

- Termux not installed: show unavailable state and keep `Copy command` available.
- Direct command API unavailable: copy command and open Termux.
- Direct command permission denied: copy command and tell the user to enable Termux command execution.
- SSH authentication missing in Termux: command still opens; Termux owns the prompt or failure output.
- Intent failure: copy command if possible; otherwise show failure.
- Clipboard failure: still open Termux if possible and show copy failure.
- Invalid host or path data: disable action and show the missing field.

Local runtime failures:

- Runtime missing: show initialization action.
- Runtime initialization failure: show retry and reset.
- Unsupported ABI: show unavailable state.
- SSH identity export failure: show identity-specific error and do not start subprocess.
- SSH command failure: keep the terminal open so the user can inspect output.
- Runtime reset: remove `$PREFIX`, managed `.ssh` material, and temporary files.

## Release Gate For Embedded Runtime

License handling is not a functional blocker for the technical validation phase.

Release builds that include embedded runtime assets must not ship until these items are completed:

- Runtime binary source and build provenance.
- Third-party license inventory.
- Required notices and attribution.
- Source availability obligations for bundled binaries.
- ABI-specific asset inventory.
- Policy for updates and security fixes.

Until this gate is complete, the embedded runtime should be treated as internal, debug, or technical-validation scope.

## Testing And Verification

Phase 1 tests:

- `TermuxCommandBuilder` quotes host, user, port, and path safely.
- Paths with spaces, single quotes, and empty values are handled.
- Generated commands include `ssh`, `-p`, `cd`, and an interactive shell handoff.
- Manifest/package-visibility tests or static checks cover Termux package visibility and run-command permission declarations.
- `ExternalTermuxLauncher` returns direct launch when Termux command execution is available.
- Launcher falls back to clipboard when direct execution is unavailable.
- Launcher returns unavailable when Termux is absent.
- Launcher does not export Goblin private keys to external Termux.
- Repository Terminal mode switching shows the correct panel.
- `External Termux` actions do not create Goblin terminal session records.

Phase 2 tests:

- Runtime initialization creates expected app-private directories.
- Runtime version and ABI detection work.
- Managed SSH key export writes restricted files.
- Runtime reset removes managed files.
- Local runtime terminal service starts the expected command.
- Local runtime terminal service streams raw input and output.
- Local runtime terminal sessions persist with backend kind `LocalRuntime`.

Verification command:

```bash
./gradlew :app:testDebugUnitTest :app:assembleDebug
```

## Implementation Order

1. Add mode state and UI for `External Termux` in the repository Terminal tab.
2. Add `TermuxCommandBuilder`.
3. Add `ExternalTermuxLauncher` and fallback handling.
4. Add unit tests and UI state tests for external handoff.
5. Add local runtime technical-validation planning.
6. Add `LocalRuntimeManager`.
7. Add `LocalRuntimeTerminalService`.
8. Add terminal backend kind for Goblin-owned sessions.
9. Add local runtime UI state and failure handling.
10. Keep release packaging gated until compliance work is handled.

## Reference Constraints

- Termux `RUN_COMMAND` support exists for third-party apps starting from Termux `0.95`.
- Direct command execution requires the `com.termux.permission.RUN_COMMAND` permission.
- Android target SDK 30 and newer require package visibility handling for Termux intents.
