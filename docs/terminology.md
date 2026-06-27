# Terminology

Use this doc as the canonical naming reference for Goblin's architecture, subsystems, and implementation vocabulary.

> This is a prescriptive document: code should move toward the names listed here. When a name appears in the "Canonical" column, use it in new code and refactors. Names in the "Deprecated" column are being retired.

## Why this document exists

Goblin has grown enough subsystems that the same English words started meaning different things in different files:

- `slot` meant both a workspace-pane tab identity and a terminal session.
- `main` meant the Electron main process, the entry `main()` function, and the primary app window.
- `shell` meant BrowserWindow security policy, OS-level host actions, and the server-to-native settings projection.
- `Repository*` appeared in server modules while `Repo*` appeared everywhere else.
- `runtime`, `manager`, `registry`, `helpers`, and `service` became catch-all suffixes that hid real responsibilities.

This doc removes that ambiguity by giving each concept one canonical name and explaining why it was chosen.

## Naming principles

1. **Feature first, layer second.** A file name should start with the feature it belongs to, then the layer role if needed. Prefer `repo-source.ts` over `repo-service.ts`.
2. **No vague catch-all suffixes.** Avoid `manager`, `service`, `controller`, `registry`, `helpers`, `utils`, or `support` unless that term is the actual stable boundary of the file. If a file mixes unrelated concerns, split it.
3. **One word per concept.** Do not reuse a domain word for two different things. `slot` is reserved for workspace-pane tabs; terminal sessions are `session`.
4. **Client/server vocabulary must align.** If the client calls it `RepoSnapshot`, the server function that produces it is `getRepoSnapshot`, not `getRepositorySnapshot`.
5. **Reserve `runtime-` for runtime facades.** Per `docs/layering.md`, a runtime facade combines read + write for a feature. Do not slap `runtime` on every async scheduler.
6. **Brand consistently.** The local server that the Electron main process spawns is the `embedded server`, not the `local server`.
7. **State class names are explicit.** Local, runtime-coherent, and restorable state each have their own suffix conventions (see "State classes" below).

## Cross-cutting terms

| Concept                                    | Canonical name         | Notes                                                                                                                           |
| ------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Browser/Electron UI side                   | `client`               | The code lives in `src/web/`, but the architecture term is `client`.                                                            |
| Electron main process side                 | `native host`          | Replaces overloaded `main`. Directory stays `src/main/` for alias stability; use `native-host` in new type/function/file names. |
| The server spawned by the native host      | `embedded server`      | Unifies prior `embedded` / `local` mix. User-data filenames are not changed.                                                    |
| Server-side aggregate runtime object       | `runtime`              | Only for things like `createServerRuntime` that wire the whole server app.                                                      |
| Authoritative persistence/IO layer         | `source`               | Matches `docs/layering.md`. `repo-source.ts`, not `repo-backend.ts`.                                                            |
| Intent/action envelope from outside the UI | `client effect intent` | Already used in `docs/g-command.md` and `src/shared/client-effect-intents.ts`.                                                  |

## State classes

Goblin uses three state classes. Keep them visible in names.

| Class                | When to use                                                                              | Typical suffixes                                                              |
| -------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Local**            | Short-lived interaction state that never leaves the component or window.                 | plain React state, `*Query` for local filters, `pending`/`open` flags         |
| **Runtime-coherent** | State that should converge across windows during the current run; server owns the truth. | `Runtime*`, `*Projection`, `*Snapshot` when read-only                         |
| **Restorable**       | State that survives relaunch but does not need live sync.                                | `Restorable*`, `SessionState` (workspace session, not HTTP session), `*Cache` |

Rules:

- `SessionState` specifically means the persisted workspace session (open repos, active repo, pane layout). It does **not** mean an HTTP session or auth session.
- `Snapshot` means a read-model projection of server truth at a point in time. `RepoSnapshot`, `SettingsSnapshot`, and `I18nSnapshot` are all snapshots, but they are not interchangeable.

## Layer file naming

Inside a feature, use the layer role as the second half of the name.

| Layer                     | Typical files                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| Boundary                  | `src/server/routes/<feature>.ts`, `src/web/<feature>-client.ts`                                         |
| Read                      | `src/web/<feature>-queries.ts`, `src/web/<feature>-snapshot.ts`, `src/server/modules/<feature>-read.ts` |
| Write                     | `src/server/modules/<feature>-write-paths.ts`, `src/web/<feature>-write-paths.ts`                       |
| Source                    | `src/server/modules/<feature>-source.ts`                                                                |
| Runtime facade (optional) | `src/web/runtime-<feature>*.ts` only when read + write are both exposed                                 |

Do not create a runtime facade that only reads or only writes. Do not create a `service` or `controller` file that mixes layers.

## Subsystem glossaries

### Terminal

The terminal subsystem is server-backed and reconnectable. Its core entities are documented in `docs/terminal.md` and `docs/terminal-target-model.md`.

| Concept                                      | Canonical                     | Deprecated                 | Rationale                                                                                       |
| -------------------------------------------- | ----------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------- |
| Server-side long-lived shell business object | `TerminalSession`             | `TerminalSlot`             | `slot` is a workspace-pane concept. Docs call this a session.                                   |
| Server session manager                       | `TerminalSessionManager`      | `TerminalSlotManager`      | Same as above.                                                                                  |
| Session lifecycle phase                      | `TerminalSessionPhase`        | `TerminalSlotPhase`        | Same as above.                                                                                  |
| Per-user detached TTL timer                  | `TerminalDetachedUserTimer`   | `TerminalConnectionState`  | It schedules cleanup after the last socket disconnect; it does not track live connection state. |
| Per-worktree session display order           | `TerminalSessionOrderRuntime` | `TerminalViewOrderRuntime` | The server tracks session order for the tab strip, not "views".                                 |
| Client singleton projection/orchestrator     | `TerminalSessionProjection`   | `TerminalSlotRegistry`     | "Registry" was vague; "Slot" overloaded workspace-pane tabs.                                    |
| Client per-session wrapper                   | `TerminalSession`             | `ManagedTerminalSlot`      | Removes both the vague `Managed` prefix and the `Slot` overload.                                |
| Client per-session runtime                   | `TerminalSessionRuntime`      | `TerminalSlotRuntime`      | Same as above.                                                                                  |
| Client per-session state                     | `TerminalSessionState`        | `TerminalSlotState`        | Same as above.                                                                                  |
| Client per-session view                      | `TerminalSessionView`         | `TerminalSlotView`         | Same as above.                                                                                  |
| Workspace-pane tab slot key for terminals    | `TerminalWorkspaceSlotKey`    | `TerminalSlotKey`          | Keeps `slot` only where it really means a workspace-pane tab slot.                              |
| Session closed realtime event                | `session-closed`              | `slot-closed`              | The event means a terminal session closed.                                                      |
| Session id validation helper                 | `isValidTerminalSessionId`    | `isValidSlotId`            | Same as above.                                                                                  |

### Repo / workspace

| Concept                                 | Canonical                                                | Deprecated                                       | Rationale                                                                              |
| --------------------------------------- | -------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Server-side authoritative repo accessor | `RepoSource` / `repo-source.ts`                          | `RepoBackend` / `repo-backend.ts`                | Matches the documented `source` layer.                                                 |
| Server read: snapshot                   | `getRepoSnapshot`                                        | `getRepositorySnapshot`                          | Aligns client/server vocabulary.                                                       |
| Server read: status                     | `getRepoStatus`                                          | `getRepositoryStatus`                            | Aligns client/server vocabulary.                                                       |
| Server read: log                        | `getRepoLog`                                             | `getRepositoryLog`                               | Aligns client/server vocabulary.                                                       |
| Bulk composite read endpoint            | `RepoBulkReadResult` / `readRepoBulk`                    | `RepositoryComposite` / `getRepositoryComposite` | "Composite" is jargon; "bulk read" describes the operation.                            |
| Server write: create worktree           | `createRepoWorktree`                                     | `createRepositoryWorktree`                       | Aligns client/server vocabulary.                                                       |
| Server write: delete branch             | `deleteRepoBranch`                                       | `deleteRepositoryBranch`                         | Aligns client/server vocabulary.                                                       |
| Server write: pull branch               | `pullRepoBranch`                                         | `pullRepositoryBranch`                           | Aligns client/server vocabulary.                                                       |
| Client async task scheduler             | `RepoOperationScheduler` / `repo-operation-scheduler.ts` | `RepoRuntime` / `runtime.ts`                     | It schedules operations, not a generic runtime.                                        |
| Operation lane                          | `RepoOperationLane`                                      | `RepoTaskLane` / `RepoLane`                      | Consistent with `OperationScheduler`.                                                  |
| UI-facing data load state               | `RepoDataLoadState` / `repo-data-load-state.ts`          | `RepoResourcesState` / `resources.ts`            | "Resources" collided with operations; the file comment already called this load state. |
| Branch detail surface (right pane)      | `RepoWorkspace` / `repo-workspace/`                      | `branch-workspace/`                              | A workspace scoped to one repo/branch.                                                 |
| Branch detail tab model                 | `repo-workspace-tab-model.ts`                            | `workspace-pane-tab-model.ts`                    | Located inside `repo-workspace/`; no redundant prefix.                                 |
| Workspace pane tab type                 | `WorkspacePaneTabType`                                   | `WorkspacePaneView`                              | The UI renders tabs, not abstract views.                                               |
| Workspace pane static tab type          | `WorkspacePaneStaticTabType`                             | `WorkspacePaneStaticViewType`                    | Same as above.                                                                         |
| Workspace pane tab scope                | `WorkspacePaneTabScope`                                  | `WorkspacePaneViewScope`                         | Same as above.                                                                         |
| SSH remote connection lifecycle         | `RemoteRepoConnectionLifecycle`                          | `RemoteRepoLifecycle`                            | Distinguishes remote connection from repo open/close lifecycle.                        |
| Repo open/close/hydration lifecycle     | `RepoSession` / `repo-session.ts`                        | `lifecycle.ts`                                   | Distinguishes from remote connection lifecycle.                                        |

### Settings / server

| Concept                                    | Canonical                                                             | Deprecated                                               | Rationale                                                                              |
| ------------------------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| User-configurable preferences              | `UserSettings`                                                        | `SettingsPrefs`                                          | `Prefs` is abbreviated and the PATCH body used `settings` while the type said `prefs`. |
| PATCH body key for prefs                   | `prefs`                                                               | `settings`                                               | Aligns the request contract with the concept.                                          |
| Native shortcut registration runtime state | `NativeShortcutRegistrationState` / `native-shortcut-registration.ts` | `ServerSettingsState` / `settings-state.ts`              | It only tracks whether the global shortcut is registered with the OS.                  |
| Persisted workspace session data           | `WorkspaceSessionState`                                               | `SessionState`                                           | Avoids confusion with HTTP/auth session.                                               |
| Server command handler                     | `handleSetFetchInterval`                                              | `applyServerFetchIntervalWrite`                          | `handle` is clearer for a command handler; removes redundant `apply`/`Write`.          |
| Client settings actions                    | `settings-actions.ts` / `setFetchInterval`                            | `settings-write-paths.ts` / `setFetchIntervalPreference` | Simpler, consistent with action vocabulary.                                            |
| Runtime settings facade                    | `runtime-settings-*.ts`                                               | same                                                     | Keep the file prefix, but export hooks with consistent `use*Settings` naming.          |

### Native host (Electron main process)

Directory `src/main/` is kept for alias stability. New file/type/function names use `native-host`.

| Concept                                 | Canonical                                              | Deprecated                                             | Rationale                                                                              |
| --------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Primary BrowserWindow                   | `primaryWindow` / `activatePrimaryWindow`              | `mainWindow` / `activateMainWindow`                    | `main` is overloaded with the main process.                                            |
| Primary window surface constant         | `PRIMARY_WINDOW_SURFACE`                               | `MAIN_WINDOW_SURFACE`                                  | Same as above.                                                                         |
| Client surface registry                 | `client-surface-registry.ts` / `ClientSurfaceRegistry` | `window-registry.ts`                                   | Matches the existing `ClientSurface*` abstraction.                                     |
| BrowserWindow security / preload policy | `window-security.ts`                                   | `window-shell.ts`                                      | `shell` collided with OS shell and native-shell projection.                            |
| BrowserWindow web preferences factory   | `createBrowserWindowWebPreferences`                    | `createClientWindowWebPreferences`                     | `BrowserWindow` is the Electron type; `client` was ambiguous.                          |
| Browser entry URL factory               | `createBrowserEntryUrl`                                | `createClientEntryUrl`                                 | Same as above.                                                                         |
| Trusted BrowserWindow config            | `configureTrustedBrowserWindow`                        | `configureTrustedClientWindow`                         | Same as above.                                                                         |
| Title-bar / traffic-light chrome        | `title-bar-chrome.ts` / `TITLE_BAR_HEIGHT_PX`          | `window-chrome.ts` / `WINDOW_CHROME_HEIGHT_PX`         | `chrome` is easily confused with the browser; this is specifically title-bar geometry. |
| Embedded server lifecycle controller    | `embedded-server-lifecycle.ts`                         | `server-manager.ts`                                    | `manager` is vague; this spawns and kills the embedded server process.                 |
| Native host IPC router                  | `native-host-ipc-router.ts` / `NativeHostIpcHandlers`  | `ipc.ts` / `NativeIpcHandlers`                         | Clarifies which IPC and which host.                                                    |
| Native host IPC procedure schemas       | `NATIVE_HOST_IPC_PROCEDURE_SCHEMAS`                    | `NATIVE_IPC_PROCEDURE_SCHEMAS`                         | Same as above.                                                                         |
| OS shell action IPC handler             | `shell-ipc.ts` / `wireShellIpc`                        | `shell-bridge.ts` / `wireShellBridgeIpc`               | These are simple IPC handlers, not the cross-runtime bridge abstraction.               |
| Clipboard IPC handler                   | `clipboard-ipc.ts` / `wireClipboardIpc`                | `clipboard-bridge.ts` / `wireClipboardBridgeIpc`       | Same as above.                                                                         |
| Access token IPC handler                | `access-token-ipc.ts` / `wireAccessTokenIpc`           | `access-token-bridge.ts` / `wireAccessTokenBridgeIpc`  | Same as above.                                                                         |
| Server-to-native projection             | `native-host-projection.ts` / `NativeHostProjection`   | `native-shell-projection.ts` / `NativeShellProjection` | Removes `shell` overlap; the projection is from server to native host.                 |

## Anti-patterns

Avoid these naming patterns in new code and remove them when touching old code:

- `Repository*` in server modules when the rest of the codebase uses `Repo*`.
- `TerminalSlot*` for server-side terminal business objects.
- `Manager`, `Service`, `Controller`, `Registry`, `Helpers`, `Utils`, `Support` as file names unless the term is the real boundary.
- `mainWindow`, `mainProcess`, `main()` all in the same conversation without qualification.
- `shell` for anything other than an OS shell command or the product shell concept documented here.
- `runtime` for a file that is just a scheduler or queue.
- `SessionState` for an HTTP or auth session.

## Migration mapping (quick reference)

| Old                              | New                               |
| -------------------------------- | --------------------------------- |
| `TerminalSlot`                   | `TerminalSession`                 |
| `TerminalSlotManager`            | `TerminalSessionManager`          |
| `TerminalSlotRegistry`           | `TerminalSessionProjection`       |
| `ManagedTerminalSlot`            | `TerminalSession`                 |
| `TerminalConnectionState`        | `TerminalDetachedUserTimer`       |
| `TerminalViewOrderRuntime`       | `TerminalSessionOrderRuntime`     |
| `slot-closed`                    | `session-closed`                  |
| `RepoBackend`                    | `RepoSource`                      |
| `getRepositorySnapshot`          | `getRepoSnapshot`                 |
| `RepositoryComposite`            | `RepoBulkReadResult`              |
| `RepoRuntime`                    | `RepoOperationScheduler`          |
| `RepoTaskLane` / `RepoLane`      | `RepoOperationLane`               |
| `RepoResourcesState`             | `RepoDataLoadState`               |
| `branch-workspace/`              | `repo-workspace/`                 |
| `WorkspacePaneView`              | `WorkspacePaneTabType`            |
| `RemoteRepoLifecycle`            | `RemoteRepoConnectionLifecycle`   |
| `lifecycle.ts` (repo open/close) | `repo-session.ts`                 |
| `SettingsPrefs`                  | `UserSettings`                    |
| `{ settings: ... }` prefs patch  | `{ prefs: ... }`                  |
| `ServerSettingsState`            | `NativeShortcutRegistrationState` |
| `SessionState`                   | `WorkspaceSessionState`           |
| `mainWindow`                     | `primaryWindow`                   |
| `activateMainWindow`             | `activatePrimaryWindow`           |
| `window-registry.ts`             | `client-surface-registry.ts`      |
| `window-shell.ts`                | `window-security.ts`              |
| `window-chrome.ts`               | `title-bar-chrome.ts`             |
| `server-manager.ts`              | `embedded-server-lifecycle.ts`    |
| `ipc.ts` (main IPC router)       | `native-host-ipc-router.ts`       |
| `shell-bridge.ts`                | `shell-ipc.ts`                    |
| `clipboard-bridge.ts`            | `clipboard-ipc.ts`                |
| `access-token-bridge.ts`         | `access-token-ipc.ts`             |
| `native-shell-projection.ts`     | `native-host-projection.ts`       |

## See also

- `docs/arch.md` — app shell and process control
- `docs/layering.md` — feature and concern layering
- `docs/state-sync.md` — local, runtime-coherent, and restorable state
- `docs/client-model.md` — client/server model boundaries
- `docs/terminal.md` and `docs/terminal-target-model.md` — terminal concepts
- `docs/g-command.md` — `g` shell command two-plane model
