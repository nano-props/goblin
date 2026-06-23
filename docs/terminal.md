# Terminal

Use this doc for the terminal system design.

## Goal

- Provide a server-backed terminal model that works the same way across web and Electron renderers.
- Keep terminal sessions long-lived and reconnectable instead of tying them to one visible view.
- Separate business lifecycle from PTY execution details.
- Make terminal ownership, mirroring, and takeover explicit parts of the model.
- Preserve fast interactive behavior while keeping the server as the runtime-coherent source of truth.

## Core model

The terminal feature is built around four different concepts:

- **Session**: the long-lived shell process and its server-owned lifecycle.
- **Attachment**: one renderer attachment to a session.
- **Controller**: the attachment that currently has write and resize authority.
- **View**: one local xterm instance that renders a session in a particular UI surface.

These concepts should not be collapsed into each other.

A session may outlive any one view.
A renderer may reconnect through a new attachment.
Multiple attachments may observe the same session.
Only one attachment may control the session at a time.

## Design principles

### Server-first runtime

- The server owns runtime-coherent terminal truth.
- Renderers are projections of server state plus local interaction state.
- Terminal behavior should be described in client and attachment terms, not in window terms.

### Stable business boundary over PTY boundary

- PTY execution is an implementation detail behind a supervisor interface.
- Session lifecycle, ownership, replay, and catalog rules live above the PTY layer.
- Switching between in-process PTY execution and worker-backed PTY execution must not change the terminal product model.

### Reconnect over recreation

- The default user expectation is that a terminal survives temporary UI loss, navigation, and reconnect.
- New terminal creation should be explicit.
- Existing sessions should be restored or reattached whenever possible.

### Explicit ownership

- Mirroring is a first-class mode, not an accidental side effect.
- Input and resize authority belong to the current controller only.
- Takeover is an explicit handoff flow, not implicit behavior triggered by random input.

### Attributed input

- PTY writes must carry renderer-side provenance before they cross the terminal bridge.
- User intent, terminal-emulator replies, and replay side effects are different classes of input.
- Replay side effects are local rendering artifacts and must never be forwarded as user stdin.

### Geometry is part of correctness

- Terminal size is not a cosmetic concern.
- Session creation, attach, resize, replay, and takeover all depend on coherent geometry.
- The system should prefer real measured geometry at creation time and keep PTY geometry close to the active view geometry.

## Layering

The terminal feature spans `shared`, `server`, and `web`, but it still behaves as one feature slice.

### Shared layer

- Defines protocol types, message shapes, identities, and session key rules.
- Gives both server and renderer a common language for session, ownership, and realtime events.

### Server runtime

- Owns business state for sessions, ownership, catalog behavior, connection tracking, and realtime dispatch.
- Exposes the terminal host boundary used by routes and realtime transport.
- Treats PTY execution as a dependency, not as the place where product behavior lives.

### PTY supervisor layer

- Owns spawn, write, resize, kill, and PTY event forwarding.
- Hides whether PTYs run in-process or in a worker.
- Does not own catalog, ownership, or renderer-facing policy.

### Renderer projection

- Maintains the renderer-local projection of live sessions, selection, bells, and local reattach state.
- Coordinates create, attach, detach, select, restart, takeover, and local session lifecycle.
- Treats the bridge as the transport to server truth, not as the source of truth itself.
- Owns input provenance before writes are sent to the server.

### Renderer view layer

- Owns xterm instances, DOM attachment, local search UI, and rendering lifecycle.
- Should stay focused on view concerns such as layout, input capture, and rendering behavior.
- Should not become the home of session policy or ownership rules.

## Session lifecycle

At a high level, the lifecycle is:

1. A renderer requests create or restore for a worktree terminal.
2. The server catalog resolves whether that request means create, reuse, or restore.
3. The session manager ensures a session exists and that a PTY is running for it.
4. The renderer attaches a local view to the session.
5. Realtime output, title, exit, and ownership events keep renderers up to date.
6. Detach removes a local view without necessarily killing the session.
7. Close or TTL cleanup ends the session and frees PTY resources.

The important design rule is that **session lifecycle is independent from view lifecycle**.

Destroying a local view should not imply closing the shell.
Closing a session should be an explicit business action or the result of server-side cleanup policy.

## Identity model

The terminal system relies on four identity scopes:

- **userId**: the server-side terminal owner derived from the authenticated access token. Session visibility, lifecycle cleanup, and realtime fanout are partitioned by this id.
- **clientId**: the logical renderer client for one browser tab or Electron renderer. It validates and routes requests, but it does not own terminal sessions.
- **clientId**: one terminal view/socket attachment under an owner.
- **ptySessionId**: the server-owned identifier for one live terminal session.

In addition, terminal keys encode repo and worktree scope so the system can reason about:

- which worktree a session belongs to
- which tab strip it should appear in
- whether a request is a restore of an existing terminal identity or a request for a new one

This identity model is the basis for reconnect, mirror mode, controller handoff, and multi-window coherence.

## Ownership and takeover

Ownership is a business concept, not just a transport detail.

### Roles

- **controller**: may write input and resize the PTY
- **viewer**: may observe output but not control the session
- **unowned**: no controller is currently active

### Rules

- Only the controller may drive PTY writes and PTY resize.
- Attach may result in controller, viewer, or unowned state.
- On disconnect, the controller slot clears immediately; the per-session `ownerSticky` flag stays set so a subsequent attach from any of the owner's attachments auto-claims when no controller is present.
- Takeover should be explicit and confirmed by server-owned ownership state. See `terminal-takeover.md` for the model.

### Why this matters

Without explicit ownership:

- multiple views can fight over PTY size
- input authority becomes ambiguous
- reconnect and mirror behavior become unpredictable

With explicit ownership:

- the server can arbitrate one source of input and resize truth
- mirror mode becomes safe and understandable
- takeover has a clear mental model

## Geometry and layout model

Geometry should be treated as part of terminal correctness.

### Principles

- Session creation should use measured host geometry whenever available.
- The renderer and server should use a coherent geometry model, not unrelated guesses.
- PTY resize should closely follow the active controller view geometry.
- Geometry should flow through create, attach, resize, restart, and takeover consistently.

### Implications

- Creating a PTY with a fallback size and fixing it later is not equivalent to creating it with the right size.
- Narrow layouts are especially sensitive because shell prompt rendering reacts immediately to initial columns.
- Extra defensive redraws are not a substitute for correct geometry flow.

### Unmeasurable hosts at attach time

When a terminal is first opened into a host whose box is not yet measurable (e.g. a split pane that is still animating to its final width), the orchestrator must wait for the host to become measurable rather than fall back to a historical default. Spawning a PTY at the wrong column count and resizing later is **not** equivalent to spawning it at the correct width — the shell may lay out its prompt against the wrong `$COLUMNS` before the resize settles.

The acquisition of geometry belongs to the orchestrator, not the view: the view accepts the measured geometry as a parameter, never reaches into layout, and never soft-fails to a default. A stuck host surfaces as a fatal attach failure the user can retry by re-selecting the terminal.

### Narrow-host multi-line prompt wrap

Multi-line shell prompts (e.g. `PS1="👾:%~\\n$ "`) clip the path line at the top of the viewport after a narrow-host resize. Root cause is upstream — see [issue #56](https://github.com/nano-props/goblin/issues/56) for full reproduction and the OSC 133 path forward.

## Replay and hydration

The system supports replay and snapshot hydration so users can reattach to running terminals without losing visual context.

### Purpose

- restore visible content after reconnect
- avoid blank terminals during attach
- preserve continuity across renderer lifecycle changes

### Rules

- Replay is a rendering concern built on top of server-owned session state.
- Hydration should help the user see the latest known state quickly, but authoritative session state still comes from the server.
- Replay should not redefine ownership or session identity.
- Replay must run inside an explicit local boundary so any terminal-emulator replies it causes can be identified as replay side effects.
- Same-session active-view replay is not a generic repair mechanism; re-enable it only when the attribution boundary can prove replay side effects cannot reach PTY stdin.

### Input attribution during replay

Server snapshots are serialized from the server-side headless xterm screen. Hydrating a renderer still means writing terminal-control sequences into local xterm, and those sequences can legitimately cause the emulator to emit protocol replies such as device, cursor-position, focus, mouse, or color reports. During live operation those replies are part of the terminal protocol and may need to reach the PTY. During local snapshot hydration they are renderer-created side effects of redrawing a server-authored screen, not user input.

The renderer input pipeline therefore uses an internal envelope:

- **user intent**: keyboard input, text paste, file paste/drop resolution, mobile toolbar helpers, and explicit UI command writes
- **terminal-emulator input**: data emitted by xterm as terminal protocol traffic

Replay boundaries suppress terminal-emulator input while replay is in progress, but still allow attributed user intent. This keeps replay a rendering operation instead of a hidden stdin writer.

### First-frame mutation contract

`create`, `attach`, and `restart` all produce a terminal frame the user may immediately see.
They should therefore share the same high-level rule:

- the mutation response itself should carry the authoritative first-frame hydration payload
- the renderer should hydrate from that response instead of reconstructing first paint from a race between live output, list updates, and later snapshot fetches
- projection data returned alongside the mutation should not be used as the success criterion for first paint

For `create` specifically:

- `ptySessionId` plus `snapshot` / `snapshotSeq` are the authoritative created-session handshake
- any returned `sessions` list is useful for tab-strip and projection updates, but is not the created session's primary truth source

This keeps `create`, `attach`, and `restart` aligned and prevents blank first paint, prompt tearing, and false create failures caused by projection lag.

## Realtime model

The terminal feature uses realtime transport for continuous, UX-critical flows.

### Streaming flows

- terminal output
- title updates
- exit notifications
- ownership changes

### Non-streaming flows

- catalog reads
- snapshots
- explicit mutations such as create, attach, restart, resize, takeover, close, and reorder

### Design rule

Use realtime streaming where the user experience requires continuity.
Use targeted request/response flows for mutations and snapshots.

## State model

The terminal feature uses all three app state classes:

### Local state

- transient search UI
- DOM attachment state
- focus state
- local rendering details

### Runtime-coherent state

- session existence
- session ownership
- canonical terminal title
- session ordering
- canonical geometry
- streamed output and exit state

### Restorable state

- preferred selected terminal per worktree
- renderer-side reattach hints that improve continuity across UI movement

The server should own runtime-coherent terminal truth.
The renderer may cache and project it, but should not invent parallel business truth.

## Failure model

The terminal system should optimize for continuity, but it still needs clear failure boundaries.

### Expected failures

- PTY spawn failure
- attachment disconnect
- renderer teardown while a session remains alive
- resize or write rejection due to lost ownership
- session exit during reconnect or replay

### Design expectations

- Failed create or restart must not leave zombie sessions presented as healthy terminals.
- Disconnect should not destroy the session itself: a 24h detached TTL keeps the catalog alive so a later attach from the same owner can re-enter via auto-claim. The controller slot, however, clears on disconnect so siblings can claim it without waiting.
- View destruction should clean up local resources without corrupting session state.
- Server shutdown should end the runtime cleanly and stop further dispatch.

## What the current design gets right

- The PTY worker direction is the right architectural boundary.
- The server-first model is appropriate for terminal state.
- Ownership is modeled explicitly instead of being hidden in UI heuristics.
- Renderer code already separates registry/projection concerns from xterm view concerns.
- The design supports mirroring, reconnect, and takeover without requiring Electron-specific assumptions.

## Main risks to watch

- Letting geometry drift between create, attach, and resize phases.
- Exposing sessions to the UI before their lifecycle is truly ready.
- Allowing renderer-local state to silently diverge from server truth.
- Treating replay or redraw as a fix for lifecycle or geometry bugs.
- Allowing PTY implementation differences to leak into product behavior.

## Rules of thumb

- Keep the server as the owner of terminal business truth.
- Keep PTY execution behind the supervisor boundary.
- Keep renderer registry code as projection and orchestration, not as an alternative authority.
- Keep xterm view code focused on rendering and local interaction.
- Treat geometry as a correctness path, not as optional polish.
- Prefer explicit ownership transitions over implicit heuristics.
- Prefer reconnect and restore over destructive recreation.
