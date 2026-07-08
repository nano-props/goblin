# Terminal Target Model

Use this doc for the target terminal session and control model.

## Goal

- Make terminal lifecycle explicit.
- Make attachment control explicit.
- Keep the server as the source of truth for terminal business state.
- Keep client behavior as a projection of that model.
- Keep local xterm rendering authority separate from server session authority.

## Why this model is needed

The current terminal design already uses the right concepts:

- session
- attachment
- controller
- view

But the target model should make those concepts more explicit in server-owned state so reconnect, takeover, restart, and failure behavior are easier to reason about.

## Core entities

### Session

A session is the long-lived terminal business object.

It owns:

- session identity
- target metadata (`repoRoot`, `repoRuntimeId`, `branch`, `worktreePath`)
- worktree identity
- canonical geometry
- PTY lifecycle association
- attachment set
- controller state
- render snapshot state
- lifecycle phase

A session is not the same thing as a client view.

The server-owned session is authoritative for lifecycle, controller state,
canonical PTY geometry, and the headless render state used to produce replay
snapshots. It should not try to predict browser font metrics or local xterm
layout details before a real view exists.

The server-owned session is also authoritative for the terminal's workspace
target metadata. `branch` is stored on the session at creation time for both
local and remote sessions; workspace-pane tab recovery must not depend on a
client-side repo snapshot or a local `git worktree` lookup to rediscover it.

Server-owned runtime ids should also drive terminal writes. If a mutation
targets a live session by `terminalRuntimeSessionId`, close/restart/takeover should be
decided by the server from that runtime object. The client may still send
additional explicit preconditions when they are semantically required, but it
should not invent extra freshness gates that can reject a valid server-owned
session locally.

### Attachment

An attachment represents one client attachment to a session.

It owns:

- attachment identity (`clientId` in the current wire model)
- last reported geometry
- recency information needed for reconnect and control policy

Online/offline presence remains broker-owned and is queried via `isClientOnline`.

An attachment is not the same thing as the controller.

### Controller

The effective controller is the online attachment that currently owns
write and resize authority. It is derived from stored controller intent
plus broker-owned presence. If the intended controller is offline, there
is no effective controller; the model carries no grace sub-state.

### View

A view is client-local xterm state.

Views should never be treated as authoritative session or control state. A live
controller view is, however, authoritative for its own fitted xterm geometry and
local rendering behavior. The client reports that geometry to the server; the
server accepts it only through the normal controller authority path and then
publishes the resulting canonical geometry.

## Target server session shape

At a high level, the server-side session model should evolve toward:

- session identity and scope
- target metadata: `repoRoot`, `repoRuntimeId`, `branch`, `worktreePath`
- lifecycle phase
- canonical geometry
- PTY binding information
- attachment map
- controller `clientId`
- render state for replay and snapshots

The important change is that the server should hold **multiple attachments per session**, not only the latest attachment state.

## Session phases

The target model should treat session lifecycle as an explicit phase machine.

## Suggested phases

- **starting**: session exists and is trying to become interactive
- **open**: PTY is live and the session is interactive
- **restarting**: session is intentionally transitioning to a replacement PTY
- **error**: session still exists as a business object, but the current PTY lifecycle attempt failed
- **closed**: terminal has been fully removed from active state

The exact names can vary, but the system should distinguish:

- active success
- transient startup
- transient restart
- recoverable failure
- terminal removal

## Why phases matter

Without explicit phases, behavior gets inferred indirectly from:

- whether a session is still in a map
- whether a PTY handle exists
- whether the client last saw an open state

That leads to ambiguity during restart failure, reconnect races, and delayed cleanup.

## Target attachment model

The server stores attachments as a map keyed by `clientId`.

Each attachment tracks stable metadata such as recent geometry and
control eligibility. It does not copy online/offline state. Broker
presence is the single source of truth, and effective control is the
projection of stored controller intent through that presence.

This lets the server reason about reconnects, takeovers, viewers, and
offline transitions without a per-attachment grace timer.

## Control roles as client projection

The client should still consume a simple control projection:

- controller
- viewer
- unowned

But those roles should be **derived views** of the richer session + attachment model, not the full server state itself.

That keeps the UI simple while keeping the business model accurate.

## Control rules

### Control authority

- only the controller may write input
- only the controller may resize the PTY
- controller changes must be server-authoritative

### Attach behavior

- attach may preserve existing control
- attach may restore control for a reconnecting controller
- attach may create a viewer
- attach should not silently override an unrelated active controller

### Presence-offline behavior

- offline presence should make stored controller intent project to no
  effective controller immediately, not preserve effective control
- a subsequent attach from the same user (any attachment) auto-claims when
  no effective controller is present, because `userSticky` is sticky per
  session
- releasing effective control should not require the client to guess what happened

### Takeover behavior

- takeover is an explicit control transition
- takeover should update canonical geometry coherently with the new controller
- client optimism should stay minimal; the takeover response is authoritative
  for that transition, and server identity events remain authoritative for
  non-takeover controller changes

## Geometry in the target model

Geometry should be represented at two levels:

- **canonical session geometry**: the server-owned PTY size
- **attachment geometry**: the last known geometry of each attachment

This allows the system to reason about:

- which attachment currently defines PTY size
- whether a control transition requires a resize
- whether reconnecting control should restore the attachment's geometry

Geometry acquisition has two phases:

- Before a view exists, the client may use a lightweight host-box estimate or cached canonical geometry as a startup hint.
- After the view exists, the live xterm instance is the only source for fitted client geometry.

Temporary xterm instances and hand-rolled font probes should not be part of the model. They create a third authority that can drift from both the server headless state and the mounted client xterm. The server should stay authoritative for canonical geometry and snapshots; the mounted xterm should stay authoritative for local rendering and fitted view dimensions.

## Restart semantics in the target model

Restart should be modeled as a lifecycle transition, not as an attach-shaped side effect.

### Desired properties

- the session identity may remain stable for product continuity
- the PTY binding may change
- the phase makes restart visible and explainable
- failure can be expressed as `error` rather than as a half-alive session

## Reconnect semantics in the target model

Reconnect should be attachment-aware.

That means the model should be able to answer:

- is this attachment the previous controller reconnecting?
- is this a different attachment attaching as a viewer?
- should control be restored, preserved, or released?

## Client implications

The client does not need the full server model.
It mainly needs:

- session summary
- current control projection for this attachment
- canonical geometry
- replay snapshot and its `outputEra` / `snapshotSeq` boundary
- lifecycle phase

The client should not have to infer hidden lifecycle meaning from missing PTY state.

## Workspace-pane runtime tab projection

Workspace-pane runtime tabs are a server-side projection of live runtime
sessions. Terminal is one runtime provider. The public canonical boundary is
the workspace pane tabs API (`workspace-pane-tabs.list` over the socket and
`listWorkspaceTabs` in the host interface), but the projection implementation
is split out of the terminal session service:

- every live terminal session must materialize a matching
  `{ type: 'terminal', runtimeSessionId: terminalSessionId }` tab entry
- stale terminal tab entries must be pruned when no matching live session exists
- existing static tabs and user-managed ordering are preserved where possible
- the server broadcasts `workspace-pane-tabs.changed` when read-side
  canonicalization changes the projection

The server-side ownership is:

- `src/server/workspace-pane/workspace-pane-runtime-tabs-projection.ts` owns
  the pure prune/materialize/dedupe rules for runtime sessions
- `src/server/workspace-pane/workspace-pane-tabs-coordinator.ts` owns
  queueing, live-session lookup, runtime writes, and read-side canonicalization
- `src/server/terminal/terminal-session-service.ts` remains the public facade that validates requests and delegates to the coordinator

This keeps the client from inventing fallback rendering rules such as "show a
terminal tab if a live terminal view exists but the tab list forgot it". The UI
renders the canonical workspace-pane tab projection, and the server is
responsible for keeping that projection coherent with terminal runtime state.

## Migration direction

All five steps are landed as of this revision. The client-side
projection (steps 3 + 5) is centralized in
`src/web/components/terminal/authority-gate.ts`; see
`terminal-takeover.md` for the resulting control model.

## Success criteria

The target model is successful when:

- restart failure has an explicit and testable meaning
- reconnect behavior is attachment-aware
- mirror and takeover semantics remain clear
- canonical geometry is owned and updated consistently
- client logic becomes simpler because server lifecycle is clearer
