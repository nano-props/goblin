# Terminal

Use this document for terminal product behavior, authority, lifecycle, control,
geometry, replay, and failure semantics.

## Goals

- Keep shell sessions alive independently of client views.
- Make control, viewing, takeover, reconnect, and recovery explicit.
- Keep PTY execution behind a stable server-owned business boundary.
- Treat client terminal presentation as a best-effort projection without
  creating a second session or render authority.

## Core model

- **Session**: a server-owned terminal business object with stable product
  identity, lifecycle, control state, canonical geometry, and render history.
- **PTY binding**: the operating-system process resource for one session
  generation. A session may exist while no PTY is bound.
- **Attachment**: the relationship between one authenticated client and a
  session.
- **Controller**: the online attachment with write and resize authority.
- **Viewer**: an attachment that can observe session metadata and request
  takeover but does not consume the live xterm output stream.
- **View**: one client-local xterm presentation for the selected session.

Multiple clients may attach to one session, but at most one attachment controls
input and geometry. “Mirroring” means shared session visibility and explicit
control transfer, not simultaneous live xterm rendering in every viewer.

## Authority boundaries

- The server owns session existence, lifecycle, attachment presence,
  controller intent, PTY binding, canonical geometry, output sequence, and the
  headless render state used for recovery.
- The selected controller view owns only mounted xterm rendering, fitted client
  geometry, local input capture, search, and presentation feedback.
- The PTY supervisor owns spawn, write, resize, kill, and native events. It does
  not own session policy, control, or client protocol.
- Shared protocol types describe the product model without exposing whether the
  PTY runs in-process or in a worker.
- Client caches and views never prove session liveness or authorize a server
  mutation.

## Identities

- `userId` scopes session visibility, lifecycle cleanup, and realtime fanout.
- `clientId` identifies one loaded client and is the controller identity.
- `terminalSessionId` is the stable product identity stored by runtime tabs.
- `terminalRuntimeSessionId` addresses one server runtime session. It does not
  prove that a PTY is currently bound or interactive.
- Runtime generation prevents commands and events from crossing PTY restart or
  replacement boundaries.
- Filesystem target keys group presentation and selection only; execution uses
  a validated server-owned target and runtime identity.

There is no separate attachment identifier. One client has at most one terminal
view for a session; cross-client control is modeled through client identity and
explicit roles.

## Session lifecycle

The server exposes explicit phases:

- `opening`: logical session exists and is preparing its first binding.
- `restarting`: a new PTY generation is being established.
- `open`: the session has an interactive live binding.
- `error`: the session remains addressable, but the latest lifecycle attempt
  failed.
- `closed`: authoritative membership has ended.

A runtime identity and phase are both required to decide whether an operation
is valid. A failed restart keeps the same business session addressable for an
explicit retry; it never presents a session without a PTY as healthy.

### Create and attach

1. Create validates the execution target and establishes or finds a logical
   session. It returns identity and lifecycle metadata only.
2. The client mounts and measures its selected xterm view.
3. Attach sends the fitted geometry and generation preconditions.
4. If no PTY history exists, attach starts the PTY at that geometry and returns
   a fresh stream frame.
5. If a PTY already exists, attach returns an atomic recovery snapshot and
   sequence boundary before later realtime output.

Create does not start a PTY with fallback geometry and does not return a render
snapshot. First output is not a prompt-ready, focus, or lifecycle signal.

### Restart

Restart creates a new generation from the mounted controller view's fitted
geometry. The successful response establishes the new binding before its
realtime output is delivered. An indeterminate restart is never replayed
automatically; authoritative hydration or explicit user retry establishes what
happened.

### Close and exit

- Closing is an explicit server-owned business operation. Destroying a local
  view never closes the shell.
- A requested close remains addressable until PTY termination is acknowledged.
  Concurrent close and cleanup paths join one idempotent retirement operation.
- The client does not optimistically hide a session before close succeeds. On
  ordinary failure, the session remains visible and retryable.
- Confirmed close and natural exit publish targeted retirement events so other
  clients can drop the exact session without inventing another close.
- Workspace-runtime invalidation may remove addressability before native
  cleanup completes because the entire lookup scope is already invalid. Cleanup
  capability does not become a second session authority.

### Detached clients

Temporary or indefinite loss of all views does not destroy a session. Presence
determines whether stored controller intent is effective; offline intent grants
no input authority. A session remains owned by its exact workspace runtime
until the user explicitly closes it or an authoritative workspace, worktree, or
runtime transition invalidates it. Native PTY retirement and tab projection
convergence remain post-commit effects of those explicit invalidations.
Server shutdown is the final resource boundary and retires every remaining PTY;
there is no elapsed-time expiry for detached sessions.

The server uses a global soft admission ceiling of 1,024 terminal resources,
including slots reserved by creations that have not committed yet and
invalidated PTYs whose native retirement has not completed. Reusing an existing
session does not consume another slot. The ceiling prevents unbounded
steady-state growth; it is not a hard native-resource quota, so a synchronous
resource-ownership handoff may transiently exceed it. At capacity, a new
creation fails explicitly; the user can close a terminal before trying again.
The server never expires or automatically evicts a session to make room.

An explicit close is accepted when the session owner publishes its serialized,
single-flight retirement before revoking PTY ownership. Once accepted, later
client membership loss does not cancel or replay that close; PTY termination,
authority removal, and pane projection finish under the admitted operation.

## Workspace-pane integration

- A terminal runtime tab is a projection of a live server session, not the
  owner of that session.
- Runtime open composes session creation or restore with canonical tab
  membership at one server application boundary.
- Runtime close composes session retirement with canonical tab removal.
- The client does not repair membership with a second tab write and does not
  infer a tab from local xterm state.
- Terminal session collections and workspace-pane tab collections keep
  independent revisions.
- The workspace dashboard derives one terminal list from the live session
  projection across workspace-root and Git-worktree targets. Selecting an item
  opens that existing session; recent-output and bell markers reuse the same
  session presentation state as branch navigation.
- Dashboard terminals follow workspace-root, repository branch/worktree, and
  canonical pane-tab order. Missing branch or tab projections retain stable
  session order and never hide an established live session.
- Closing a tab is sequential: plan the close-back destination, await server
  retirement, then apply canonical projection and navigation. Projection or
  navigation failure after server commit never reopens or compensates the
  session.
- Whole-worktree removal admits the physical target, quiesces provider
  resources, performs the Git removal, and finalizes projections in one
  server-owned workflow. External interference fails directly and returns
  recovery to the user.

Detailed tab-command ordering belongs to
`workspace-pane-command-invariants.md`.

## Control and takeover

Client roles are:

- `controller`: may write, resize, and report fitted geometry.
- `viewer`: may observe metadata and request takeover.
- `unowned`: no online attachment currently controls the session.

Attach may claim control only when no effective controller exists. Selection,
focus, ordinary input, reconnect, and device type do not implicitly steal
control. Takeover is an explicit server-authoritative handoff that validates
attachment presence, generation, and fitted geometry before committing the new
controller.

Viewer input and hidden-view input are discarded rather than queued. A viewer
that takes control paints from a fresh server-authored snapshot; viewer-local
buffers never become render authority. See `terminal-takeover.md` for detailed
control transitions.

## Input and resize results

Input and resize distinguish three outcomes:

- `accepted`: the current server binding accepted the operation.
- `rejected`: current authority or preconditions did not allow it.
- `indeterminate`: transport loss prevents the client from knowing whether the
  server accepted it.

Rejected work fails fast. Indeterminate work is not replayed automatically,
because replay can duplicate input or cross generations. The client surfaces
uncertainty when it affects user intent and returns retry or recovery to the
user.

## View lifecycle

- Only the selected session owns a mounted client xterm and DOM host.
- Deselecting disposes the xterm and addons without closing the session.
- Inactive sessions keep no parked xterm DOM, warm xterm instance, client
  render cache, or geometry simulation.
- Client xterm serialization is never a reattach or recovery authority.
  Server-authored render state is the only cross-view recovery source.
- Recreating a view may take time, but performance optimizations must not add a
  second hidden render authority.
- A session group with no terminal sessions presents an explicit create action;
  the user never has to infer an invisible click target.

## Geometry

Geometry is part of terminal correctness:

- Logical creation has no PTY geometry.
- The mounted controller xterm is the source of fitted client geometry.
- Attach, resize, restart, and takeover send that fitted geometry with runtime
  preconditions.
- The server applies the native PTY operation before committing canonical
  geometry and matching headless-render size.
- An unmeasurable host waits for measurement instead of using a fallback size.
- Inactive or viewer presentations never resize the PTY.

Correct initial geometry matters because shells lay out prompts against the
initial grid. Defensive redraws do not repair an incorrect authority flow.

## Replay and presentation

Recovery distinguishes fresh streaming from replay:

- `frame: 'stream'` is valid only for the attach or restart that starts a new
  generation with no missed history. It carries no render snapshot.
- `frame: 'snapshot'` contains an atomic server-authored screen and sequence
  checkpoint for a view that may have missed history.
- Output at or before the checkpoint belongs to the snapshot; later output is
  delivered in order after the response.
- A sequence checkpoint is a transport boundary, not a shell redraw
  transaction or prompt-ready signal.
- Snapshot replay occurs while the local presentation is hidden. Replay-created
  protocol replies are discarded and local user input remains disabled.
- Fresh output received before presentation is queued without parsing, then
  flushed after the fitted viewport is revealed.

Presentation becomes eligible for automatic focus only after the fitted view
has rendered its viewport and passed its final geometry check. A quiet process
does not block presentation waiting for output.

Presentation is best-effort, but not silent when it affects user intent. A
stable local recovery failure offers explicit retry. Cancellation, stale work,
viewer ownership, and superseding bindings clear the abandoned presentation
without mutating server session truth.

## Realtime and recovery

- Continuous terminal output, title, bell, identity, and lifecycle changes use
  realtime transport.
- Complete session and tab collections use independently revisioned snapshots.
- Transition responses are ordered before their buffered realtime effects so a
  client commits new binding metadata before consuming output.
- Reconnect restores client projection from server truth. It does not reuse
  client render buffers, replay indeterminate mutations, or treat transport
  reconnection as control authority.

## Failure semantics

Expected failures include spawn failure, restart failure, rejected input or
resize, lost attachment presence, presentation failure, PTY exit, and transport
uncertainty.

- Failure never leaves a pseudo-alive interactive session without a PTY.
- Recoverable server lifecycle failure remains addressable in an explicit error
  phase.
- Client presentation failure preserves committed server facts and does not
  trigger destructive rollback.
- External or indeterminate outcomes stop automation and return repair, retry,
  reopen, or rehydrate control to the user.
- Server shutdown ends runtime dispatch and transfers remaining native-process
  cleanup to the supervisor boundary.

## Design risks

- Geometry drifting between create, attach, restart, takeover, and resize.
- Client projections silently diverging from server truth.
- Replay or redraw being used to hide lifecycle defects.
- PTY implementation differences leaking into product behavior.
- View or tab lifetime accidentally becoming session authority.

## Rules of thumb

- Server session truth first; client presentation second.
- Session, tab, attachment, PTY, and view lifetimes remain distinct.
- One effective controller, explicit takeover, no input replay on uncertainty.
- Fresh generations stream; views that may have missed history recover from a
  server snapshot.
- Correct geometry before convenience fallbacks.
- Fast failure and explicit user recovery over compensation or hidden repair.
