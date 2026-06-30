# Terminology Spec

Use this document as the naming spec for Goblin code and docs.

> This is a normative document. New code should follow these names. When old code is touched, move it toward this spec unless there is a stronger local constraint.

## Purpose

Goblin has several places where the same English word can plausibly mean different things. This spec prevents that drift by assigning one canonical name to each architectural concept and by defining how names should be chosen when new code is introduced.

The main collisions this spec resolves are:

- `slot` as both a workspace-pane UI identity and a terminal business object
- `main` as both Electron's main process and "the primary thing"
- `shell` as both an OS shell and a BrowserWindow / native-host concern
- `Repository*` vs `Repo*`
- vague suffixes like `manager`, `service`, `registry`, and `helpers`

## Core rules

1. One concept, one word.
   If two things are materially different in the product model, do not give them the same noun.
2. Prefer product meaning over implementation accidents.
   Name the business object, not the mechanism currently used to implement it.
3. Feature first, layer second.
   Start names with the feature, then the role: `repo-source.ts`, not `source-repo.ts`.
4. Client and server must share the same nouns.
   If the client says `RepoSnapshot`, the server should say `getRepoSnapshot`.
5. Use explicit layer words.
   Prefer `source`, `snapshot`, `projection`, `write-paths`, `queries`, `runtime` when they accurately describe the boundary.
6. Treat catch-all suffixes as suspicious.
   Avoid `manager`, `service`, `registry`, `helpers`, `utils`, and `support` unless that word is the real stable abstraction.
7. Keep state class visible when it matters.
   Distinguish local state, runtime-coherent state, and restorable state in names.

## Decision order

When naming a new type, file, or module, make the decision in this order:

1. What product concept is this?
2. Which layer owns it?
3. Is the state local, runtime-coherent, or restorable?
4. Is there already a canonical noun for this concept elsewhere in the codebase?
5. Is the proposed suffix a real boundary, or just a vague bucket?

If a name fails any step above, rename it before adding more code around it.

## Canonical cross-cutting terms

| Concept | Canonical | Rule |
| --- | --- | --- |
| Browser/Electron UI side | `client` | Use `client` as the architecture term even though code lives in `src/web/`. |
| Electron main-process side | `native host` | Use `native host` in names and docs; keep `src/main/` only for alias stability. |
| Server spawned by the native host | `embedded server` | Do not introduce `local server` as a competing term. |
| Aggregate runtime object | `runtime` | Reserve for a facade that wires a feature or app runtime together. |
| Authoritative persistence / IO layer | `source` | Prefer `repo-source.ts` over `repo-backend.ts`. |
| Outside-UI intent envelope | `client effect intent` | Use the existing term consistently. |

## State classes

Goblin uses three state classes:

| Class | Meaning | Typical names |
| --- | --- | --- |
| Local | State that never needs to converge across windows | React state, `*Query`, `open`, `pending` |
| Runtime-coherent | State that should converge during the current run and is server-owned | `*Projection`, `*Snapshot`, `Runtime*` |
| Restorable | State that survives relaunch without live sync | `*Cache`, `Restorable*`, `WorkspaceSessionState` |

Rules:

- `SessionState` refers to the persisted workspace session domain, not HTTP or auth session state.
- `Snapshot` means a read-model projection of server truth at a point in time.

## Layer naming

Within a feature, use these layer names when they fit:

| Layer | Typical forms |
| --- | --- |
| Boundary | `src/server/routes/<feature>.ts`, `src/web/<feature>-client.ts` |
| Read | `src/web/<feature>-queries.ts`, `src/web/<feature>-snapshot.ts`, `src/server/modules/<feature>-read.ts` |
| Write | `src/server/modules/<feature>-write-paths.ts`, `src/web/<feature>-write-paths.ts` |
| Source | `src/server/modules/<feature>-source.ts` |
| Runtime | `runtime-<feature>*` only when the file truly exposes a read+write facade |

Do not use `runtime` for a queue or scheduler that is not actually a runtime facade.

## Canonical subsystem rules

### Terminal

Terminal terminology has hard boundaries:

- `session` is the terminal business object.
- `terminalSessionId` is the persistent identity for a terminal session and for its terminal workspace-pane tab entry.
- `terminalWorktreeKey` is only the repo/worktree grouping key.
- `tabId` is for fixed static workspace-pane tabs.
- control ownership is described as `controller`, `viewer`, `unowned`, or `controller role`.

Canonical terminal terms:

| Concept | Canonical | Deprecated |
| --- | --- | --- |
| Server-side business object | `TerminalSession` | `TerminalSlot` |
| Server state owner | `TerminalSessionManager` | `TerminalSlotManager` |
| Client singleton projection | `TerminalSessionProjection` | `TerminalSlotRegistry` |
| Per-session client view | `TerminalSessionView` | `TerminalSlotView` |
| Per-session client state | `TerminalSessionState` | `TerminalSlotState` |
| Per-session client runtime | `TerminalSessionRuntime` | `TerminalSlotRuntime` |
| Per-worktree mixed tab runtime | `TerminalWorkspaceTabsRuntime` | terminal-only worktree list runtimes |
| Terminal session identity | `terminalSessionId` | old composite terminal identity names |
| Terminal worktree grouping | `terminalWorktreeKey` / `TerminalWorktreeKey` | old workspace-pane identity names |
| Session lifecycle event | `session-closed` | `slot-closed` |
| Session id validator | `isValidTerminalSessionId` | `isValidSlotId` |

Naming consequences:

- Do not use `slot` for a terminal business object.
- Do not use `session` to mean controller ownership.
- If you mean a static Workspace Pane tab, use `tabId`.
- If you mean a terminal Workspace Pane tab, use `terminalSessionId`.
- If you mean the repo/worktree grouping bucket for terminal tabs, use `terminalWorktreeKey`.

### Repo / workspace

Repo naming rules:

- Use `Repo*`, not `Repository*`, unless required by an external API.
- Use `WorkspacePaneTab*`, not `WorkspacePaneView*`, for tab concepts.
- Use `RepoSession` only for repo open/close/hydration lifecycle, not for terminal sessions or auth sessions.

Canonical examples:

| Concept | Canonical | Deprecated |
| --- | --- | --- |
| Authoritative repo accessor | `RepoSource` / `repo-source.ts` | `RepoBackend` / `repo-backend.ts` |
| Snapshot read | `getRepoSnapshot` | `getRepositorySnapshot` |
| Status read | `getRepoStatus` | `getRepositoryStatus` |
| Log read | `getRepoLog` | `getRepositoryLog` |
| Bulk read | `RepoBulkReadResult` / `readRepoBulk` | `RepositoryComposite` / `getRepositoryComposite` |
| Operation scheduler | `RepoOperationScheduler` | `RepoRuntime` |
| Operation lane | `RepoOperationLane` | `RepoTaskLane`, `RepoLane` |
| Data load state | `RepoDataLoadState` | `RepoResourcesState` |
| Right-pane surface | `RepoWorkspace` | `branch-workspace/` |
| Workspace-pane tab type | `WorkspacePaneTabType` | `WorkspacePaneView` |

### Settings / server

Canonical rules:

- Use `UserSettings` for user-configurable preferences.
- Use `WorkspaceSessionState` for persisted workspace session data.
- Use `handle*` for command handlers when the module is handling a command, not just mutating state.

Selected mappings:

| Concept | Canonical | Deprecated |
| --- | --- | --- |
| User-configurable preferences | `UserSettings` | `SettingsPrefs` |
| Prefs PATCH body key | `prefs` | `settings` |
| Persisted workspace session | `WorkspaceSessionState` | `SessionState` |
| Native shortcut registration state | `NativeShortcutRegistrationState` | `ServerSettingsState` |

### Native host

Canonical rules:

- Use `native host` for the Electron main-process side.
- Use `primaryWindow`, not `mainWindow`, for the principal BrowserWindow.
- Use `*-ipc` for plain IPC handlers.
- Use `embedded server` for the server process the native host spawns.

Selected mappings:

| Concept | Canonical | Deprecated |
| --- | --- | --- |
| Primary window | `primaryWindow` / `activatePrimaryWindow` | `mainWindow` / `activateMainWindow` |
| Client surface registry | `client-surface-registry.ts` | `window-registry.ts` |
| Window security policy | `window-security.ts` | `window-shell.ts` |
| Embedded server lifecycle | `embedded-server-lifecycle.ts` | `server-manager.ts` |
| Native host IPC router | `native-host-ipc-router.ts` | `ipc.ts` |
| Clipboard IPC handler | `clipboard-ipc.ts` | `clipboard-bridge.ts` |
| Access-token IPC handler | `access-token-ipc.ts` | `access-token-bridge.ts` |
| Server-to-native projection | `native-host-projection.ts` | `native-shell-projection.ts` |

## Review checklist

Reject or rename changes that:

- introduce a second noun for an existing product concept
- use `slot` for a terminal business object
- use `session` for controller ownership
- add `Repository*` names to internal repo code
- introduce `main*` names that really mean `native host` or `primaryWindow`
- use `runtime`, `manager`, `service`, or `registry` as a vague bucket instead of a real boundary
- use `SessionState` for anything other than persisted workspace session state

## See also

- `docs/arch.md`
- `docs/layering.md`
- `docs/state-sync.md`
- `docs/client-model.md`
- `docs/terminal.md`
- `docs/terminal-target-model.md`
