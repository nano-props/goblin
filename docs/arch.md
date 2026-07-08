# Architecture

Use this doc for app shell and process control rules.

- Keep one primary `BrowserWindow` by default. Add extra windows only when the product really needs a separate surface.
- Put app logic in `src/server/` or `src/shared/`.
- Keep `src/main/` focused on Electron-native host work; the architecture term is `native host`.
- Keep overlays centralized in `src/web/hooks/useAppOverlays.ts`.
- Route menu and UI actions through client/server intent flows when possible.
- Use direct native-host actions only for native-only work.
- Let the server own settings and app data.
- Prefer server-first runtime authority. The client should send intent plus explicit preconditions, and the server should accept or reject with fast-fail semantics.
- Keep user commands sequential. Resolve route/state supplements at the action boundary, perform the accepted write, then navigate to the precomputed result. Do not use effects, background observers, or client-only tokens to repair command state after the fact.
- Model runtime lifecycle as server-owned state transitions, not client-synchronized snapshots. For repo runtimes this means the server mints the live `repoRuntimeId` on open and invalidates it on close/reopen.
- Do not treat a stable locator such as `repoRoot` as a full runtime identity when reopen/recreate can mint a new live runtime.
- Do not add client-side freshness heuristics when the server can reject stale work directly. Push runtime validity checks into shared protocol contracts first, and let stale mutations fail instead of trying to "heal" them in the client.
- When a server-owned runtime id already identifies the write target precisely enough, use that id directly and let the server decide. Do not add a second client-side freshness dependency "just in case" if it can only make a valid server action fail locally.
- Server push should be the default way client projections converge after a successful write. Avoid immediate client-issued read-backs on the same path unless the server contract truly cannot return or broadcast the authoritative post-write state.
- Centralize web-side settings writes in `src/web/settings-actions.ts`; `src/web/settings-client.ts` is the HTTP/native transport boundary. Components should not call raw settings write functions directly.
- Keep query key/cache helpers separate from React hooks: use `settings-query-cache.ts` for cache keys and cache updates, and `settings-queries.ts` for React Query hooks.
- Let the native host project native state instead of owning parallel state.
- Use `embedded server` for the server spawned by the native host.

## Workspace Pane Runtime Tabs

Workspace Pane tabs have two classes:

- static tabs, identified by a fixed `tabId`
- runtime tabs, identified by `{ type, runtimeSessionId }`

Runtime tabs are server-owned session tabs. Multiple runtime tabs for the same
type may be open, closed, and restored from a
server projection, and may surface pending/realtime/lifecycle state through
its provider. The tab strip must treat these as generic runtime items, not as
terminal-specific tabs.

The canonical wire/storage shape for runtime tab entries is:

```ts
{ type: 'terminal', runtimeSessionId: 'session-id' }
```

Use `runtimeSessionId` for every runtime tab type, including `terminal`.
Do not accept or emit terminal-specific workspace tab entries such as
`{ type: 'terminal', terminalSessionId }`.

The ownership split is:

- `src/shared/workspace-pane.ts` owns tab entry types, identity helpers, and
  the static/runtime tab type split.
- `src/shared/workspace-pane-tabs.ts` and
  `src/shared/workspace-pane-tabs-validators.ts` own the workspace tab socket
  action/event names and their validation.
- `src/server/workspace-pane/*` owns server-side tab runtime state,
  canonicalization, read/write actions, realtime invalidation, and
  runtime-session materialization/pruning.
- `src/web/workspace-pane/*` owns client query/cache projection and mutation
  orchestration for server-owned tab state.
- `src/web/workspace-pane/tab-providers.ts` owns per-tab-type
  labels, icons, pending state, attention state, renderability, and close
  behavior.
- `WorkspacePaneTabStrip` owns generic tab chrome only: selection,
  re-selection, close, reorder, and create affordances.

Terminal is currently one runtime tab provider, not the runtime tab
architecture itself. Future session tabs such as chat should add a runtime
type, provider, projection, panel, create action, and close/action adapters
without changing the generic tab strip contract.

Runtime tab types are intentionally registered statically. Adding a new
server-owned session tab type should update the explicit extension points
instead of adding fallback logic in `WorkspacePaneTabStrip` or local client
mirrors:

- `src/shared/workspace-pane.ts`: add the runtime type and its tab scope.
- `src/server/workspace-pane/*`: keep using the generic coordinator and
  projection helpers; the new feature contributes a
  `WorkspacePaneRuntimeTabsProvider`.
- `src/server/<feature>/*`: own the feature lifecycle and expose live runtime
  sessions to the workspace-pane provider.
- `src/web/workspace-pane/workspace-pane-runtime-tab-*.ts*`: add provider
  projection, target key, create, command, close, and panel entries for the
  new type.
- `src/web/workspace-pane/tab-providers.ts`: add labels, icons,
  pending/attention state, close policy, and renderability for the new type.

Compatibility note: old workspace tab protocol names
(`list-workspace-tabs`, `replace-tabs`, `update-tabs`,
`workspace-tabs-changed`) and old terminal-specific tab entries are not part
of the current contract. The canonical socket actions/events are
`workspace-pane-tabs.list`, `workspace-pane-tabs.replace`,
`workspace-pane-tabs.update`, and `workspace-pane-tabs.changed`.
