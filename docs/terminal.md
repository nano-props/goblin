# Terminal

Use this doc for the terminal system design.

## Goal

- Provide a server-backed terminal model that works the same way across web and Electron clients.
- Keep terminal sessions long-lived and reconnectable instead of tying them to one visible view.
- Separate business lifecycle from PTY execution details.
- Make terminal control, mirroring, and takeover explicit parts of the model.
- Preserve fast interactive behavior while keeping the server as the runtime-coherent source of truth for sessions.

## Core model

The terminal feature is built around four different concepts:

- **Session**: the long-lived server business object for a terminal and
  its lifecycle. It may temporarily have no live PTY handle, for example
  while opening, restarting, or after a restart failure.
- **Attachment**: one client attachment to a session.
- **Controller**: the attachment that currently has write and resize authority.
- **View**: one local xterm instance that renders a session in a particular UI surface.

These concepts should not be collapsed into each other.

A session may outlive any one view.
A client may reconnect through a new attachment.
Multiple attachments may observe the same session.
Only one attachment may control the session at a time.

## Design principles

### Server-first runtime

- The server owns runtime-coherent terminal truth.
- Clients are projections of server state plus local interaction state.
- Terminal behavior should be described in client and attachment terms, not in window terms.

### Authority boundaries

The terminal has two different authority domains that should stay separate:

- **Session authority** lives on the server. The server owns session lifecycle, controller/viewer state, PTY binding, canonical geometry, and the headless xterm render state used for snapshots.
- **View authority** lives in the currently mounted client xterm. The live xterm instance owns local rendering behavior and is the only component that should report the active controller view's fitted `cols`/`rows`.

Create may send a lightweight startup geometry hint before a real view exists. After a view is mounted, the client sends live xterm geometry to the server through attach, resize, restart, and takeover operations. The server validates controller authority, updates the PTY and headless render state, then broadcasts the resulting canonical geometry. This keeps the server model authoritative without asking the server, a temporary xterm, or an ad hoc DOM probe to predict client rendering details.

### Stable business boundary over PTY boundary

- PTY execution is an implementation detail behind a supervisor interface.
- Session lifecycle, control, replay, and session service rules live above the PTY layer.
- Switching between in-process PTY execution and worker-backed PTY execution must not change the terminal product model.

### Reconnect over recreation

- The default user expectation is that a terminal survives temporary UI loss, navigation, and reconnect.
- New terminal creation should be explicit.
- Existing sessions should be restored or reattached whenever possible.

### Explicit control

- Mirroring is a first-class mode, not an accidental side effect.
- Input and resize authority belong to the current controller only.
- Takeover is an explicit handoff flow, not implicit behavior triggered by random input.

### Attributed input

- PTY writes must carry client-side provenance before they cross the terminal client.
- User intent, terminal-emulator replies, and replay side effects are different classes of input.
- Replay side effects are local rendering artifacts and must never be forwarded as user stdin.

### Geometry is part of correctness

- Terminal size is not a cosmetic concern.
- Session creation, attach, resize, replay, and takeover all depend on coherent geometry.
- Startup geometry should be a best-effort hint until a live xterm view exists.
- Once a controller view is mounted, PTY geometry should closely follow that view's fitted xterm geometry.

## Layering

The terminal feature spans `shared`, `server`, and `web`, but it still behaves as one feature slice.

### Shared layer

- Defines protocol types, message shapes, identities, and grouping rules.
- Gives both server and client a common language for session, control, and realtime events.

### Server runtime

- Owns business state for sessions, control, session service behavior, connection tracking, and realtime dispatch.
- Exposes the terminal host boundary used by routes and realtime transport.
- Treats PTY execution as a dependency, not as the place where product behavior lives.
- Keeps `TerminalSessionService` as the public facade. Focused server modules own create orchestration, session ensure, prune, and workspace-tab projection details.

### PTY supervisor layer

- Owns spawn, write, resize, kill, and PTY event forwarding.
- Hides whether PTYs run in-process or in a worker.
- Does not own session service, control, or client-facing policy.

### Client projection

- Maintains the client-local projection of live sessions, selection, bells, and attach/replay orchestration state.
- Coordinates create, attach, detach, select, restart, takeover, and local session lifecycle.
- Treats the terminal client as the transport to server truth, not as the source of truth itself.
- Owns input provenance before writes are sent to the server.

### Client view layer

- Owns xterm instances, DOM attachment, local search UI, and rendering lifecycle.
- Should stay focused on view concerns such as layout, input capture, and rendering behavior.
- Should not become the home of session policy or control rules.

## Session lifecycle

At a high level, the lifecycle is:

1. A client requests create or restore for a worktree terminal.
2. The server session service validates the request and delegates create orchestration.
3. The create path resolves whether the request means create, reuse, or restore.
4. The session manager ensures a session exists and that a PTY is running for it.
5. The client attaches a local view to the session.
6. Realtime output, title, exit, and identity events keep clients up to date.
7. Detach removes a local view without necessarily killing the session.
8. Close or TTL cleanup ends the session and frees PTY resources.

The important design rule is that **session lifecycle is independent from view lifecycle**.

Destroying a local view should not imply closing the shell.
Closing a session should be an explicit business action or the result of server-side cleanup policy.

### Workspace Pane tab lifecycle

The Workspace Pane tab is a UI lifecycle boundary above both the local xterm view and the server session.

It is useful to keep three lifetimes separate:

- **Session lifetime**: server-owned terminal business state and PTY resources.
- **View lifetime**: client-local xterm and DOM resources for rendering a session.
- **Tab lifetime**: user-visible workspace surface that decides which feature resources must be released before the tab is considered closed.

A Workspace Pane tab is not the authoritative owner of a terminal session. The
tab is a client projection of server-owned runtime membership. The terminal
manager owns the session and `WorkspacePaneRuntimeApplication` owns the composed
close command that joins resource cleanup with canonical tab projection. The
client projection only applies the returned snapshot and local presentation.

Closing a terminal tab is a sequential operation. The command may compute the
close-back tab before it starts the close, but `TerminalSessionProjection` must
keep the terminal session visible until the server/runtime close succeeds. Do
not optimistically hide the session from the tab strip, clear selected terminal
state, or expose a compensating `closingSessionIds` state for normal tab close.
Those patterns make the UI render a state that is neither the old tab nor the
planned close-back tab, and then force route reconciliation or render logic to
repair it. On failure, the session should still be present because the close did
not complete. On success, the close path removes the session and commits the
planned close-back navigation.

This distinction matters for destructive worktree operations. The client sends
one repository-removal intent; it does not close tabs first. The server
application layer admits removal for the user/repo-runtime/worktree before the
command waits in the repository write queue. Later runtime opens and canonical
tab writes for that target are rejected. After repository validation succeeds,
but before the Git worktree remove begins, the application closes authoritative
provider resources, removes every canonical tab target for the worktree, and
advances the server revision. Validation failures leave runtime resources
untouched. The admission is released when the repository command settles, so
recreating the same path later does not inherit a client or server tombstone.

The repo route only delegates the composed command to the application layer;
RepoSource and Git code remain unaware of terminal or Workspace Pane types.
Their required pre-remove lifecycle boundary guarantees that no repository
worktree deletion can bypass application cleanup.

An ordinary runtime-close response pairs the remaining server sessions with the
canonical tabs snapshot from the same application command. Worktree removal
performs the corresponding whole-worktree cleanup internally before Git removal;
there is no client-callable bulk-close command. The client projects returned
sessions only if the snapshot revision is accepted. It never enumerates local
sessions to infer what the server closed, and a stale close response cannot
overwrite a newer cross-window open projection.
Realtime/reconnect recovery uses the same rule: the server retries its read
until the session recovery and canonical tabs snapshot share a stable revision,
and the client rejects both together when that revision is older than its
current projection.

### Terminal create and Workspace Pane navigation

Terminal creation has three architecture layers:

- `TerminalSessionService` and its focused domain collaborators own terminal
  create/reuse/restore, PTY/session lifecycle, and terminal first-frame data.
- `WorkspacePaneRuntimeApplication` owns composed open/close/worktree-close/removal
  commands and their shared server worktree queue: invoke the provider,
  commit canonical runtime membership, publish invalidation, and return the
  provider result plus a revisioned full-scope snapshot.
- `TerminalSessionProjection` and Workspace Pane commands own client admission,
  pending/single-flight intent, startup command resolution, durable provider
  cleanup, opener attribution, revision-gated local projection, cancellation,
  and exact route commit for the created `terminalSessionId`.

While `TerminalSessionProjection` reports `createPending` for a
`terminalWorktreeKey`, ordinary user-driven workspace-pane navigation for that
repo/branch/worktree should fast-fail at the operation entry point:
tab switching, terminal selection, tab closing, shortcuts, history restore,
notification jumps, and static-tab opens should not enqueue competing
navigation. A command-owned route commit is different: it is the committed
result of the command that already created or joined the terminal session, so it
must not be rejected just because another terminal create is pending.

Workspace-pane terminal create commands enter the terminal projection first so
terminal lifecycle can see duplicate or distinct requests immediately and keep
`createPending` projection-owned. The projection sends the accepted request to
`workspace-pane-runtime.open`; the server application operation creates or
restores the terminal and then commits tab membership through the generic
workspace-pane coordinator. The response contains the terminal first frame,
session projection, and `WorkspacePaneTabsSnapshot { revision, entries }`.

The admission-leading client command writes those returned tabs into the local
query projection, records opener facts, and commits the exact terminal route.
It does not send a second `workspace-pane-tabs.update`. Duplicate admission
observers must not repeat local tab/route commit.

This is an ordered application operation, not a distributed transaction that
can safely roll back through the client. The create result must preserve
both the client admission role (`leader` or `observer`) and the server resource
disposition (`created`, `reused`, or `restored`); admission leadership is not
resource ownership. Once the server has accepted create, a later tab/cache or
route failure must not close the session. The workspace-pane server projection
materializes every live runtime session, so tab convergence and navigation are
recoverable projection work, while closing a reused/restored session would be a
destructive cross-client side effect. Duplicate observers must not repeat the
tab/route commit.

A canonical workspace-pane tab response may arrive after this client has moved
to a replacement `repoRuntimeId`. Skipping that stale local cache write does not
turn the already-successful server mutation into a failure. Likewise,
command-owned navigation must await the router and confirm that the requested
route became current; navigation rejection or supersession is reported without
rolling back committed server resources.

Keep these client outcomes separate: `runtimeProjectionApplied` reports local
terminal-session hydration, snapshot application reports whether the revision
entered this client's canonical cache, and navigation commit reports the exact
route result. None of these client projection outcomes decides whether the
server command succeeded or owns rollback of the server resource.

The pending bit is projection state from the terminal lifecycle queue. Do not
add client-only focus tokens, request generations, or "is the user still on
the initiating tab" guards to decide whether a completed create may navigate.
Those checks create a second authority for user intent and make late async
completion order part of the product model.

The clean flow is:

1. The user invokes create through a command/open-tab entry point.
2. The terminal projection admits the create request and publishes
   `createPending` before async startup command resolution begins.
3. The server application command invokes terminal creation, commits the
   corresponding runtime tab in server order, and returns the server-allocated
   `terminalSessionId` plus a revisioned full-scope snapshot.
4. The owning workspace-pane command applies that snapshot through the single
   revision acceptance boundary, verifies the captured `repoRuntimeId`,
   records opener facts, and navigates directly to the canonical terminal
   route for that returned session.

If a create flow needs async preparation before the PTY can be launched, such
as resolving a file viewer command for "open file in terminal", that preparation
must be part of the projection-owned create request. Use a create option that is
resolved inside the terminal create queue after `createPending` is visible; do
not `await` the preparation in a component and only then call create.
Terminal create options describe the session being launched; they must not
carry workspace-pane scheduling callbacks.

Route reconciliation remains a boundary concern: stale or unrenderable explicit
pane URLs should fast-fail to the bare branch route. Do not replace
`/terminal/{missingSessionId}` or `/tab/{unrenderableTab}` with a different live
tab just because one exists. The resulting workspace history entry should record
the empty pane (`workspacePaneTab: null`) rather than inventing a tab hit.
The tab model must apply the same rule before reconciliation effects run:
generic preferred-tab fallback is only for persisted preferences, never for an
explicit URL route.

Keep URL parsing routes and command commit targets distinct. A parsed route may
represent URL-only states such as `invalid-static`; a command-owned commit may
only target a valid workspace-pane route (`static`, `terminal`) or the empty
route (`null`). Command commit APIs must require the commit boundary and must
not silently fall back to ordinary blockable show/select navigation.

URL-backed terminal routes are requested selection, not projection state. A
route such as `/terminal/{sessionId}` may ask the tab model to render that
materialized session, but it must not be injected into the runtime projection's
`selectedSessionId`. The shared selection-sync path is responsible for writing
the resolved active session back to the projection owner.

The bare branch URL is the canonical empty workspace-pane route. Explicit pane
tabs use explicit URLs such as `/tab/status` or `/terminal/{sessionId}`. Do not
canonicalize a bare branch URL to `/tab/status`: that erases the user's empty
pane state and reintroduces hidden preferred-tab fallback as a second route
authority.

## Identity model

The terminal system relies on these identity/grouping scopes:

- **userId**: the server-side terminal user derived from the authenticated access token. Session visibility, lifecycle cleanup, and realtime fanout are partitioned by this id.
- **clientId**: the logical client for one browser tab or Electron client. It validates and routes requests and is also the code-level controller identity (`TerminalController.clientId`).
- **terminalSessionId**: the server-allocated persistent identity for one terminal business session. Terminal workspace-pane runtime tabs store this value as their generic `runtimeSessionId`.
- **terminalWorktreeKey**: the repo/worktree grouping key produced by `formatTerminalWorktreeKey(repoRoot, worktreePath)`. It is used for per-worktree selection, tab-strip grouping, bell/activity summaries, and materialization callbacks. It is not a terminal identity.
- **terminalRuntimeSessionId**: the server-owned runtime lookup id used by attach,
  write, resize, restart, close, and realtime messages. It is not a
  guarantee that a live OS PTY handle exists at that instant; `phase`
  and server PTY binding state determine whether the session is
  interactive. A restart failure keeps the same `terminalRuntimeSessionId`
  addressable in `phase: 'error'` so the session can be retried without
  changing `terminalSessionId`.
- **terminal attachment**: the conceptual relationship between a `clientId` and a terminal session. There is intentionally no separate `attachmentId` field, and none is planned. One client should have at most one Terminal View for a given `terminalSessionId`; cross-client viewing/control is modeled with `clientId`, controller/viewer state, and explicit takeover.

This means terminal identity is not encoded from repo/worktree strings. Repo and worktree location travel as explicit fields on session summaries and as `terminalWorktreeKey` only where a grouped lookup is needed.

This identity model is the basis for reconnect, mirror mode, controller handoff, and multi-window coherence.

Keep the naming boundary explicit:

- `terminalSessionId` is the durable terminal product/session identity.
  Workspace-pane runtime tabs carry it as `runtimeSessionId`.
- `terminalRuntimeSessionId` is the server runtime lookup identity for terminal
  operations and events.
- A PTY handle is the lower-level supervisor resource. It may be absent
  while the runtime session still exists, notably during `opening`,
  `restarting`, or `error`.

Do not infer liveness from `terminalRuntimeSessionId` alone. Use the session phase and
server authority checks (`hasPty`, controller role, and operation-specific
guards) to decide whether writes/resizes are allowed.

## Control and takeover

Control is a business concept, not just a transport detail.

### Roles

- **controller**: may write input and resize the PTY
- **viewer**: may observe session metadata and request takeover, but does not
  control the session or consume the live xterm output stream
- **unowned**: no controller is currently active

### Rules

- Only the controller may drive PTY writes and PTY resize.
- Attach may result in controller, viewer, or unowned state.
- Broker presence is the source of attachment online/offline state. An
  offline controller intent projects to no effective controller, while
  `userSticky` lets the user's next attachment auto-claim.
- Takeover should be explicit and confirmed by server-owned control state. See `terminal-takeover.md` for the model.

### Why this matters

Without explicit control:

- multiple views can fight over PTY size
- input authority becomes ambiguous
- reconnect and mirror behavior become unpredictable

With explicit control:

- the server can arbitrate one source of input and resize truth
- mirror mode becomes safe and understandable
- takeover has a clear mental model

## Geometry and layout model

Geometry should be treated as part of terminal correctness.

### Principles

- Session creation may use a lightweight host-box estimate as a startup hint.
- The live controller xterm is the source for fitted view geometry.
- The server remains the source of truth for canonical PTY geometry after it accepts a controller resize.
- Geometry should flow through create, attach, resize, restart, and takeover consistently.

### Implications

- Creating a PTY with a fallback size and fixing it later is still not equivalent to starting close to the visible host size.
- Startup estimates must stay lightweight and must not duplicate xterm internals.
- Narrow layouts are especially sensitive because shell prompt rendering reacts immediately to initial columns.
- Extra defensive redraws are not a substitute for correct geometry flow.

### Unmeasurable hosts at attach time

When a terminal is first opened into a host whose box is not yet measurable (e.g. a split pane that is still animating to its final width), the orchestrator must wait for the host to become measurable rather than fall back to a historical default. Spawning a PTY at a wildly wrong column count and resizing later is still observable because the shell may lay out its prompt against the initial `$COLUMNS` before the resize settles.

Before the xterm view exists, geometry is only a startup hint derived from the host box or cached canonical state. After the view opens, `FitAddon.fit()` on the real xterm instance is the authoritative client-side measurement; controller attach/resize/restart/takeover sends those fitted dimensions to the server, and the accepted server value becomes canonical session geometry.

### Narrow-host multi-line prompt wrap

Multi-line shell prompts (e.g. `PS1="👾:%~\\n$ "`) clip the path line at the top of the viewport after a narrow-host resize. Root cause is upstream — see [issue #56](https://github.com/nano-props/goblin/issues/56) for full reproduction and the OSC 133 path forward.

## Replay and hydration

The system supports replay and snapshot hydration so users can reattach to running terminals without losing visual context.

### Purpose

- restore visible content after reconnect
- minimize blank time during attach using server-authored first-frame hydration
- preserve continuity across client lifecycle changes

### Rules

- Replay is a rendering concern built on top of server-owned session state.
- Hydration should help the user see the latest known state quickly, but authoritative session state still comes from the server.
- Replay should not redefine control or session identity.
- Replay must run inside an explicit local boundary so any terminal-emulator replies it causes can be identified as replay side effects.
- Same-session active-view replay is not a generic repair mechanism; re-enable it only when the attribution boundary can prove replay side effects cannot reach PTY stdin.

### Input attribution during replay

Server snapshots are serialized from the server-side headless xterm screen. Hydrating a client still means writing terminal-control sequences into local xterm, and those sequences can legitimately cause the emulator to emit protocol replies such as device, cursor-position, focus, mouse, or color reports. During live operation those replies are part of the terminal protocol and may need to reach the PTY. During local snapshot hydration they are client-created side effects of redrawing a server-authored screen, not user input.

The client input pipeline therefore uses an internal envelope:

- **user intent**: keyboard input, text paste, file paste/drop resolution, mobile toolbar helpers, and explicit UI command writes
- **terminal-emulator input**: data emitted by xterm as terminal protocol traffic

Replay boundaries suppress terminal-emulator input while replay is in progress, but still allow attributed user intent. This keeps replay a rendering operation instead of a hidden stdin writer.

### First-frame mutation contract

`create`, `attach`, and `restart` all produce a terminal frame the user may immediately see.
They should therefore share the same high-level rule:

- the mutation response itself should carry the authoritative first-frame hydration payload
- the client should hydrate from that response instead of reconstructing first paint from a race between live output, list updates, and later snapshot fetches
- projection data returned alongside the mutation should not be used as the success criterion for first paint

For `create` specifically:

- `terminalRuntimeSessionId` plus `snapshot` / `snapshotSeq` / `outputEra`
  are the authoritative created-session handshake
- any returned `sessions` list is useful for tab-strip and projection updates, but is not the created session's primary truth source

This keeps `create`, `attach`, and `restart` aligned and prevents prompt tearing and false create failures caused by projection lag. A selected view may still be blank while the fresh xterm is created and the server-authored snapshot is replayed.

## Realtime model

The terminal feature uses realtime transport for continuous, UX-critical flows.

### Streaming flows

- terminal output
- terminal bells
- title updates
- exit notifications
- control changes

### Non-streaming flows

- session service reads
- first-frame mutation responses that carry snapshots
- explicit mutations such as create, attach, restart, resize, takeover, close, and reorder

### Design rule

Use realtime streaming where the user experience requires continuity.
Use targeted request/response flows for mutations; when a snapshot-carrying
mutation opens or replaces a visible frame, its response carries the
server-authored snapshot. Control-only mutations such as takeover apply
role/lifecycle state first, then paint xterm through the server snapshot path.

## State model

The terminal feature uses all three app state classes:

### Local state

- transient search UI
- DOM attachment state
- focus state
- local rendering details

### Runtime-coherent state

- session existence
- session control
- canonical terminal title
- session ordering
- canonical geometry
- streamed output and exit state

### Restorable state

- preferred selected terminal per worktree

Terminal selection is intentionally a client preference, not runtime-coherent
terminal truth. The server owns which sessions exist and who controls them;
each client may remember which terminal it prefers to show for a worktree.

The server should own runtime-coherent terminal truth.
The client may cache and project it, but should not invent parallel business truth.

## Failure model

The terminal system should optimize for continuity, but it still needs clear failure boundaries.

### Expected failures

- PTY spawn failure
- attachment presence going offline
- client teardown while a session remains alive
- resize or write rejection due to lost control
- session exit during reconnect or replay

### Design expectations

- Failed create or restart must not leave zombie sessions presented as healthy terminals.
- Offline presence should not destroy the session itself: a 24h detached
  TTL keeps the session service alive so a later attach from the same user can
  re-enter via auto-claim. The broker may close stale realtime sockets
  when presence times out, but offline controller intent still projects
  to no effective controller so siblings can claim without waiting.
- View destruction should clean up local resources without corrupting session state.
- Server shutdown should end the runtime cleanly and stop further dispatch.

## What the current design gets right

- The PTY worker direction is the right architectural boundary.
- The server-first model is appropriate for terminal state.
- Control is modeled explicitly instead of being hidden in UI heuristics.
- Client code already separates TerminalSessionProjection concerns from xterm view concerns.
- The design supports mirroring, reconnect, and takeover without requiring Electron-specific assumptions.

## Main risks to watch

- Letting geometry drift between create, attach, and resize phases.
- Exposing sessions to the UI before their lifecycle is truly ready.
- Allowing client-local state to silently diverge from server truth.
- Treating replay or redraw as a fix for lifecycle or geometry bugs.
- Allowing PTY implementation differences to leak into product behavior.

## Rules of thumb

- Keep the server as the source of terminal business truth.
- Keep PTY execution behind the supervisor boundary.
- Keep client TerminalSessionProjection code as projection and orchestration, not as an alternative authority.
- Keep xterm view code focused on rendering and local interaction.
- Treat geometry as a correctness path, not as optional polish.
- Prefer explicit control transitions over implicit heuristics.
- Prefer reconnect and restore over destructive recreation.
