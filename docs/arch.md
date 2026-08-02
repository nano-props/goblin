# Architecture

Use this document for application-level process, authority, and command rules.
Feature-specific invariants belong to their feature specifications.

## Process model

- Keep one primary `BrowserWindow` by default. It is the native host's
  principal and activation target. Add another window only for a distinct
  product surface.
- Keep Electron-native host code focused on capabilities that require Electron.
  Application behavior belongs in the server or runtime-neutral shared layer.
- Use `native host` for the Electron process and `embedded server` for the
  server it starts.
- Let the native host project native state instead of maintaining parallel
  application authority.
- Keep application overlays behind one client-owned composition boundary.

## Authority and commands

- Prefer server-first runtime authority. Clients send intent plus explicit
  preconditions; the server accepts or rejects at the owning boundary.
- Model runtime lifecycle as server-owned transitions. Stable locators identify
  durable business objects; server-issued runtime identities address a specific
  live generation.
- Do not add client freshness heuristics when the server can validate the
  mutation directly. A defensive client guess is a second authority and a new
  failure mode.
- Keep accepted user commands sequential: resolve their business facts, perform
  the write, apply canonical projection results, and settle planned navigation.
  Effects and background observers do not repair command state afterward.
- Server push is the default convergence mechanism after committed writes.
  Mutation responses describe exact effects; complete read models converge
  through their independently revisioned query or invalidation boundaries.
- Client presentation is a best-effort projection. Presentation failure cannot
  roll back or reclassify an already committed server fact.
- Route menu and UI actions through client/server intent flows. Direct
  native-host actions are reserved for native-only work.
- The server owns settings and application data. Client settings actions keep
  query projections coherent; raw transport is not a component mutation API.

## Workspace-pane runtime tabs

Workspace-pane tabs are either static product surfaces or server-owned runtime
sessions. A runtime entry uses the generic shape:

```ts
{ type: 'terminal', runtimeSessionId: 'session-id' }
```

Every runtime provider uses `runtimeSessionId`; generic workspace-pane state
does not encode provider-specific session fields.

The ownership model is:

- Durable layout owns static tab membership and user order.
- The authoritative target source validates command-time workspace and worktree
  targets.
- Runtime providers own live session membership and lifecycle.
- The workspace-pane aggregate projects durable layout, valid targets, runtime
  placement, and provider snapshots into one canonical tab view.
- The client caches and renders that canonical view. It does not infer missing
  runtime membership or authorize server commands from repository snapshots.
- Generic tab chrome owns selection, reorder, close, and create affordances;
  provider registries own labels, attention, renderability, and provider
  actions.

Provider lifecycle and workspace-pane membership are composed at a server
application boundary:

- Opening a runtime creates or restores the provider resource and establishes
  canonical tab membership as one accepted operation.
- Closing a runtime joins provider retirement with canonical tab removal.
- Clients do not issue a provider mutation followed by a second tab mutation to
  repair membership.
- Provider collections and workspace-pane collections keep independent
  revisions; neither revision is a freshness proxy for the other.
- Whole-worktree removal owns target admission, provider quiescence, the Git
  commit, and final projection cleanup. It fails directly on external Git
  interference and does not add compensation or a second filesystem authority.

Runtime tab types are registered explicitly. Adding one extends the shared type
and protocol, provider lifecycle adapter, canonical projection, client
presentation, and action registry without changing generic tab chrome.

The stable runtime actions are `workspace-pane-runtime.open` and
`workspace-pane-runtime.close`. Tab list/update actions may change static
membership or order; runtime membership changes only through the composed
runtime lifecycle boundary.

Detailed workspace-pane command ordering and concurrency rules live in
`workspace-pane-command-invariants.md`. Terminal lifecycle and control rules
live in `terminal.md` and `terminal-takeover.md`.
