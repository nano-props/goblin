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

- **Session**: the long-lived shell process and its server-owned lifecycle.
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

- PTY writes must carry client-side provenance before they cross the terminal bridge.
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

### PTY supervisor layer

- Owns spawn, write, resize, kill, and PTY event forwarding.
- Hides whether PTYs run in-process or in a worker.
- Does not own session service, control, or client-facing policy.

### Client projection

- Maintains the client-local projection of live sessions, selection, bells, and attach/replay orchestration state.
- Coordinates create, attach, detach, select, restart, takeover, and local session lifecycle.
- Treats the bridge as the transport to server truth, not as the source of truth itself.
- Owns input provenance before writes are sent to the server.

### Client view layer

- Owns xterm instances, DOM attachment, local search UI, and rendering lifecycle.
- Should stay focused on view concerns such as layout, input capture, and rendering behavior.
- Should not become the home of session policy or control rules.

## Session lifecycle

At a high level, the lifecycle is:

1. A client requests create or restore for a worktree terminal.
2. The server session service resolves whether that request means create, reuse, or restore.
3. The session manager ensures a session exists and that a PTY is running for it.
4. The client attaches a local view to the session.
5. Realtime output, title, exit, and identity events keep clients up to date.
6. Detach removes a local view without necessarily killing the session.
7. Close or TTL cleanup ends the session and frees PTY resources.

The important design rule is that **session lifecycle is independent from view lifecycle**.

Destroying a local view should not imply closing the shell.
Closing a session should be an explicit business action or the result of server-side cleanup policy.

### Workspace Pane tab lifecycle

The Workspace Pane tab is a UI lifecycle boundary above both the local xterm view and the server session.

It is useful to keep three lifetimes separate:

- **Session lifetime**: server-owned terminal business state and PTY resources.
- **View lifetime**: client-local xterm and DOM resources for rendering a session.
- **Tab lifetime**: user-visible workspace surface that decides which feature resources must be released before the tab is considered closed.

A Workspace Pane tab is not the authoritative owner of a terminal session. The tab is a workspace-pane tab entry in the UI; the terminal server (TerminalSessionManager) and client projection (TerminalSessionProjection) own terminal resource cleanup for the session rendered by that tab. The tab close path is the orchestration boundary that waits for those owners to finish.

This distinction matters for destructive worktree operations. Before a worktree directory is removed, the client should close every worktree-scoped Workspace Pane tab for that worktree and await each tab's close contract. For terminal tabs, that close contract delegates to the client projection's worktree release barrier: cancel pending creates that have not reached the server, wait for in-flight creates that cannot be cancelled, close materialized sessions, and wait for pending durable closes to settle. For future worktree-scoped tabs, such as a file tree or another long-lived tool surface, the same tab close contract should release that tab's resources before the worktree mutation starts.

Repo routes and server-side repo write paths should not know about Workspace Pane tabs or terminal UI resources. They remain responsible for repository mutation. UI resource release belongs to the Workspace Pane tab lifecycle on the client.

## Identity model

The terminal system relies on five identity/grouping scopes:

- **userId**: the server-side terminal user derived from the authenticated access token. Session visibility, lifecycle cleanup, and realtime fanout are partitioned by this id.
- **clientId**: the logical client for one browser tab or Electron client. It validates and routes requests and is also the code-level controller identity (`TerminalController.clientId`).
- **terminalSessionId**: the server-allocated persistent identity for one terminal business session. Terminal workspace-pane tabs use this value directly as their durable terminal tab identity.
- **terminalWorktreeKey**: the repo/worktree grouping key produced by `formatTerminalWorktreeKey(repoRoot, worktreePath)`. It is used for per-worktree selection, tab-strip grouping, bell/activity summaries, and materialization callbacks. It is not a terminal identity.
- **ptySessionId**: the server-owned runtime identifier for the current live PTY associated with a terminal session. Restart/reconnect can change PTY runtime state without changing `terminalSessionId`.
- **terminal attachment**: the conceptual relationship between a `clientId` and a terminal session. There is intentionally no separate `attachmentId` field, and none is planned. One client should have at most one Terminal View for a given `terminalSessionId`; cross-client viewing/control is modeled with `clientId`, controller/viewer state, and explicit takeover.

This means terminal identity is not encoded from repo/worktree strings. Repo and worktree location travel as explicit fields on session summaries and as `terminalWorktreeKey` only where a grouped lookup is needed.

This identity model is the basis for reconnect, mirror mode, controller handoff, and multi-window coherence.

## Control and takeover

Control is a business concept, not just a transport detail.

### Roles

- **controller**: may write input and resize the PTY
- **viewer**: may observe output but not control the session
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

- `ptySessionId` plus `snapshot` / `snapshotSeq` are the authoritative created-session handshake
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
Use targeted request/response flows for mutations; when a mutation opens or replaces a visible frame, its response carries the server-authored snapshot.

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
