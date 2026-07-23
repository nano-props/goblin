# Terminal Ephemeral Xterm Spec

Use this spec for the server-first terminal architecture where inactive
terminal tabs do not keep live xterm DOM.

## Goal

Make terminal rendering a projection of server-owned session state.

- Server owns session lifecycle, PTY state, controller state, canonical
  geometry, and render snapshots.
- Client projection owns selected session, bell/activity metadata, and
  attach/replay orchestration.
- Client view owns only the currently selected xterm instance.
- Inactive terminals own no xterm DOM, no xterm instance, and no client
  render authority.

Switch latency and blank frames are acceptable in the first implementation.
Architecture simplicity is the priority; performance optimizations must remain
additive and must not reintroduce hidden xterm authority.

## Model

### Session

A server-owned terminal business object. A session may outlive every client
view. Destroying a local xterm never closes the session.

### Attachment

A server-owned relationship between a client and a session. Attachment state is
not the same thing as DOM presence.

### Controller

The server-derived effective write/resize authority. Selection does not imply
control, and losing a selected view does not release control.

### View

A client-local xterm instance for the selected terminal only. The view owns
local rendering and fitted geometry while mounted. It is disposable.

## Invariants

- Session lifecycle is independent from view lifecycle.
- Selection is independent from controller authority.
- Destroying a view does not close the PTY.
- Inactive sessions do not resize the PTY.
- Server render snapshots are the only cross-view render source of truth.
- A fresh view that starts its PTY from sequence 1 consumes the live server
  output stream directly and does not need a cross-view snapshot.
- Client xterm serialization is not used as a reattach authority.
- Only the selected live xterm can produce fitted client geometry.
- Only the effective controller can update canonical PTY geometry.
- Replay side effects must never be forwarded to PTY stdin.

## Select Flow

1. User selects a terminal session.
2. Client creates a fresh terminal host and xterm view.
3. Client keeps the presentation hidden until its mounted host is measurable.
4. Client fits the live xterm and sends attach/restart with its `cols`/`rows`.
5. Server validates attachment and control rules.
6. Server returns exactly one frame protocol:
   - Existing PTY: `frame: 'snapshot'`, role, lifecycle state, canonical
     geometry, `snapshot`, and `snapshotSeq`; the client resets
     xterm and replays it.
   - Newly prepared session: the server starts the PTY at the fitted size and
     returns `frame: 'stream'`; the client keeps the same empty xterm and does
     not reset or replay it.
7. Realtime output writes to that selected controller xterm while also updating
   the server headless render state for future recovery.

The user may see a blank terminal until snapshot replay completes.

## Deselect Flow

1. Client stops routing input/output to the current xterm.
2. Client drops selection-local transient view state such as selection,
   search state, and scroll position.
3. Client disposes xterm and addons.
4. Client removes xterm DOM.
5. Server session, PTY, controller intent, and render snapshot state remain
   alive.

The client does not serialize the xterm on deselect.

## Explicit Non-Goals

The first implementation should not include:

- parked xterm DOM
- warm hidden xterm caches
- grace windows
- inactive xterm output replay
- client-side render cache as an authority
- inactive geometry simulation
- preview screenshots
- dual old/new rendering paths

Any future performance work must preserve the same authority model.

## Acceptance

- Tab switching recreates the selected xterm from a server snapshot.
- A newly created terminal uses that one mounted xterm from output sequence 1;
  it is never replaced by a second client xterm or seeded from a startup snapshot.
- Output produced while inactive appears after reselect through server replay.
- Controller/viewer/unowned semantics do not change when views are destroyed.
- Resize authority still comes only from the selected live controller view.
- Close, restart, takeover, and reconnect remain server-authoritative.
- A slow or blank select transition is acceptable for this phase.
