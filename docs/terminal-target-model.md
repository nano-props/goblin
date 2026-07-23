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
- atomic `TerminalSessionBase`: a runtime-bound filesystem execution target plus its presentation
- the current canonical Git head label when the target is a Git worktree
- prepared/bound PTY state; canonical geometry exists only while bound
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

The server-owned session is also authoritative for the terminal's Workspace
target projection. Git worktree identity does not include `branch`: a branch can be
renamed while the physical worktree and terminal session remain the same. A
new or reused admission therefore resolves the current canonical branch at the
Workspace target-capture boundary and stores that label on the session. Tab
recovery uses the stored canonical label and does not depend on a client-side
repo snapshot or an ad hoc local `git worktree` lookup.

`TerminalExecutionTarget` is the runtime-scoped execution authority. It carries
`workspaceId`, `workspaceRuntimeId`, and either the Workspace root or a canonical
Git worktree root. `TerminalFilesystemTargetKey` is the separate runtime-neutral
UI/persistence grouping key (`workspaceId` + `executionRootId`). Native paths are
decoded only at the execution boundary and are never terminal identity.

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

`TerminalDirectory` is the sole live membership authority. It owns runtime and
durable identity indexes, stable target identity facts, physical-worktree capability,
scope membership, and a membership-only catalog clock. Pending creation is not
Directory state. Runtime objects continue to own mutable controller, lifecycle,
title, process, geometry, generation, and render state.

The Directory may reserve runtime and durable identities for one in-flight
admission. A reservation participates only in uniqueness checks: catalog reads,
runtime lookup, attach, and the membership clock cannot observe it. The
operation-owned capability commits the reservation exactly once after Workspace
placement validation, or aborts it without a membership transition. Commit is
the sole new-session membership linearization point.

Workspace runtime tabs are a pure projection of static layout, ordered epoch
overlay hints, and Directory membership. Closing durably retires the PTY before
removing Directory membership; the hidden placement hint is reclaimed later
with its Workspace target or epoch.

At a high level, the server-side session model should evolve toward:

- session identity and scope
- atomic `TerminalSessionBase` (`TerminalExecutionTarget` + matching `TerminalPresentation`)
- runtime-neutral `TerminalFilesystemTargetKey` for UI/persistence grouping
- mutable canonical Git head presentation for Git worktree targets
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

The server stores attachment membership as a set of `clientId` values.

Attachment membership records only which page has joined the session. It does
not copy geometry or online/offline state. Broker presence is the single source
of truth for liveness, and effective control is the projection of stored
controller intent through that presence.

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
- a subsequent online attachment auto-claims only when no effective controller
  is present
- releasing effective control should not require the client to guess what happened

### Takeover behavior

- takeover is an explicit control transition
- takeover should update canonical geometry coherently with the new controller
- client optimism should stay minimal; the takeover response is authoritative
  for that transition, and server identity events remain authoritative for
  non-takeover controller changes

## Geometry in the target model

Geometry has exactly two authorities with different scopes:

- **mounted xterm + `FitAddon`** owns the local view measurement;
- **bound server PTY state** owns canonical process geometry after a mutation is accepted.

A prepared session has `generation: 0` and `canonicalSize: null`. Creation does
not estimate, cache, or default a business geometry. The selected view mounts a
hidden xterm, performs a real fit against its DOM host, and sends those fitted
dimensions in attach. Only the atomic PTY bind turns that measurement into
canonical geometry.

xterm may internally construct its invisible buffer at 80×24. That implementation
value never crosses the attach boundary: it is not sent to the server, does not
create or resize a PTY, and never becomes a visible frame. Temporary xterms,
host-box estimates, cached startup geometry, and hand-rolled font probes would
all create a third authority and are outside the model.

Later controller resize, restart, and takeover requests also carry a measurement
from that same mounted xterm. The server validates generation and controller
authority before mutating the bound PTY and publishing a new canonical size.
If presence changes while an acknowledged native resize is in flight, canonical
geometry records the physical PTY result while the now-stale control transition
fails. The server must not hide that physical fact or issue a compensating
resize in an attempt to manufacture transactionality across a native side effect.

## Restart semantics in the target model

Restart should be modeled as a lifecycle transition, not as an attach-shaped side effect.

### Desired properties

- the session identity may remain stable for product continuity
- the PTY binding may change
- the phase makes restart visible and explainable
- failure can be expressed as `error` rather than as a half-alive session

A restart candidate is a fresh PTY generation. It is spawned with the mounted,
fitted xterm geometry, but its handle, generation, render state, and geometry
are not published until controller admission is revalidated at the bind
linearization point. Early output/exit remains owned by the candidate's event
lease during that interval. Success returns `frame: 'stream'`; failure retires
the candidate and leaves the prior generation/render/geometry as the retained
addressable state for retry. Restart does not manufacture a recovery snapshot
for a process whose complete output begins at sequence 1.

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
- either a fresh-stream attach handshake or a replay snapshot with its
  generation / `snapshotSeq` boundary
- lifecycle phase

The client should not have to infer hidden lifecycle meaning from missing PTY state.

A prepared session with no PTY is an explicit lifecycle state, not a second
client authority. The mounted xterm supplies fitted startup geometry; the server
then starts the PTY and streams sequence 1 into that same xterm. An attachment
that missed any history receives a server-headless snapshot instead. The server
decides between those frame protocols from PTY ownership/history, so the client
never guesses whether recovery is required.

The headless render chain is the atomic read boundary for recovery: serialized
screen bytes and their applied sequence checkpoint are captured together. A
headless write or resize fault makes recovery unavailable for that generation;
it never authorizes a guessed snapshot or a second raw-output history cache.
The PTY stream and lifecycle remain authoritative, and an explicit restart is
the clean boundary for establishing a new recoverable generation.

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
- reads do not write, advance the layout revision, or broadcast; provider
  lifecycle events and explicit layout commands publish their own changes

The server-side ownership is:

- `src/server/workspace-pane/workspace-pane-runtime-tabs-projection.ts` owns
  the pure prune/materialize/dedupe rules for runtime sessions
- `src/server/workspace-pane/workspace-pane-tabs-coordinator.ts` owns
  queueing, live-session lookup, layout-intent writes, and physical admission
- `src/server/terminal/terminal-session-service.ts` remains the public facade that validates requests and delegates to the coordinator

This keeps the client from inventing fallback rendering rules such as "show a
terminal tab if a live terminal view exists but the tab list forgot it". The UI
renders the canonical workspace-pane tab projection, and the server is
responsible for keeping that projection coherent with terminal runtime state.

## Migration direction

The target lifecycle is now implemented across the manager, PTY binding, client
runtime, and presentation/navigation boundaries. There is no generic client
authority coordinator: server generation/controller checks own mutations,
while the client owns only local pending/presented admission and the focus
handoff for the current presentation generation. See `terminal-takeover.md` for
the control model.

## Success criteria

The target model is successful when:

- restart failure has an explicit and testable meaning
- reconnect behavior is attachment-aware
- mirror and takeover semantics remain clear
- canonical geometry is owned and updated consistently
- client logic becomes simpler because server lifecycle is clearer
