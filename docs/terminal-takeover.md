# Terminal Takeover: Who Controls the Cursor

## Why this document exists

A long-running terminal session in Goblin can outlive any single
window. The user may be on a desktop Electron app, a laptop browser
tab, or a server browser tab — and they will move between them
while the same shell keeps running in the background. The product
has to decide, at every moment, **which window is allowed to type**.
The answer to that question is what this document is about.

This is a principles-level document. It does not describe fields,
methods, timers, or flags. It describes the _shape_ of the answer
and the _constraints_ the answer has to respect. Implementation
lives in `src/server/terminal/terminal-controller.ts` and the
generation-bearing attach/write/resize/takeover paths in `TerminalSession`.

## The product premise

Goblin is a single-user application. The user signs in once with
an access token and that token derives a stable user identity for
every server-side resource they touch — including terminal
sessions. There is no notion of two distinct humans sharing a
session.

The user expects to roam:

- Open a terminal on the desktop, type for an hour.
- Switch to a laptop, open the same terminal in the browser.
- Switch back to the desktop.

The shell must keep running, while control changes remain explicit and
server-authoritative.

## What "control" means

A terminal session in Goblin has at most one effective controller
attachment at a time — the online `clientId` whose keystrokes reach
the shell. If stored controller intent is absent or offline, the
effective controller is `null` and clients project the role as
`unowned`. All other windows are _viewers_: they see a readonly session
projection and can request takeover, but they do not consume the live
xterm output stream; their input is dropped at the boundary.

This isn't a security boundary; it's a coordination boundary. If
two windows typed at once, the user's mental model of the shell
would shatter: which cursor is the shell listening to? whose
keystrokes are echoed back? where does my Ctrl+C go?

So the design is: **at any instant, at most one attachment is the
effective controller.**

## The principle: explicit attachment control

Control belongs to one online attachment, not to a device class or a local
focus guess. Attach auto-claims only when no effective controller exists. An
unrelated active controller is preserved; a viewer cannot turn ordinary input
into an implicit control mutation.

## The takeover button

Goblin's 接管 / Take over action is the explicit handoff path. It sends the
view's fitted geometry and current server generation. The server validates
the authenticated page presence and generation, resizes the PTY, then
atomically admits that page as an attachment and commits controller intent.
It returns the authoritative controller frame. Hidden or viewer input is
discarded rather than queued behind that round trip.

## Controller intent and presence

The server stores controller intent as a `clientId`; broker presence determines
whether that intent currently projects to an effective controller:

- User closes the controller attachment/socket. Broker presence marks
  that `(userId, clientId)` offline, so the stored controller intent
  projects to no effective controller at once.
- User opens a new window elsewhere, attached to the same session.
- A new online attachment sees no effective controller and may claim during
  attach.

There is no sticky-user flag or controller grace timer. User identity scopes
session visibility; attachment identity owns control.

## Server output is shared; rendered output is not

Control applies to **writing**, not to the server's output stream. The
server owns PTY output history and the headless render snapshot, but the
live xterm output consumer is the current controller view. A viewer sees
session metadata and a takeover path; after takeover, the new controller
paints from a fresh server snapshot instead of trusting a viewer-owned
render buffer.

The asymmetry is intentional: the PTY still produces one server-owned
output stream, while each browser xterm is an ephemeral render target.
The model has to match that ownership split instead of treating a viewer
DOM buffer as protocol authority.

## Why a same-window reconnect is non-disruptive

When a window's network briefly drops and comes back to the same
attachment, the user perceives no interruption: broker presence marks
the attachment offline, its stored controller intent temporarily
projects to no effective controller, and the reattach re-claims through
the ordinary attach rule when no other online attachment has claimed control.
Because the reconnect and the reclaim normally happen back-to-back, the user
sees their next keystroke flow as expected.

This works because **page identity is held by the loaded renderer module, which
survives a socket-level reconnect within the same page**, and
**user identity is per-access-token, which is even more durable**.
The two-tier identity means the model can tell "same loaded page, brief
network issue" apart from "different page instance, deliberate switch".

## When the original controller is _not_ the next to arrive

The same-page reconnect is the friendly case. The less-friendly
case is a small but real race:

1. Window A is the effective controller.
2. A's network drops. Broker presence marks A offline, so A's
   stored controller intent no longer projects to an effective
   controller (no grace period).
3. Window B — a sibling tab, an Electron window on another
   machine, anything the user opened while A was away — attaches
   first. B auto-claims because no effective controller is present
   and the user has touched this session before.
4. A's network comes back. A reconnects, but the effective controller is B.
   A is now a viewer.

This is intentional. Attach never steals control from an online attachment,
and ordinary input never doubles as an implicit control mutation. A remains a
viewer until the user explicitly chooses Take over. Input produced while A is
a viewer is discarded at the local admission boundary; the server independently
rejects any stale or unauthorized write that reaches it.

In practice the window between A going offline and B's attach is often small,
but the behavior does not depend on timing. When B claims first, the UI must
project A as a viewer and offer the explicit takeover action.

## Why a crashed controller is non-disruptive

A controller's process can die (laptop sleep, OS kill, NIC
stuck) while the OS keeps the underlying TCP socket in
`ESTABLISHED` for minutes or hours. Without intervention the
server would still believe that `(userId, clientId)` is online,
the effective controller would stay pinned to the dead client,
and every sibling viewer would be stranded in viewer mode with
no path to auto-claim.

Each realtime socket owns its own heartbeat clock. The client emits a small
heartbeat while that socket is open; if its receipt time goes stale, the broker
closes that exact transport. A healthy replacement socket with the same
`clientId` cannot keep an obsolete socket alive. Client presence turns offline
only after its last socket is gone. Stored controller intent is not erased, but
it no longer projects to an effective controller, so the next attach can
auto-claim the session.

## Known behavior: self-reconnect mid-flight

A reconnecting controller can briefly project as `unowned`: the old
presence has gone offline, and the replacement attach has not yet
re-established an effective controller. The client treats that window
as a closed authority boundary rather than guessing. In the common case
it is too short to notice; if a keystroke lands exactly there, it may be
dropped and the next keystroke succeeds after the reattach completes.

This is an intentional consequence of having no controller grace timer.
The server never pretends an offline attachment can still write.

## Boundaries this model respects

- **One writer at a time.** The shell sees one input stream.
- **Server output has one shared history.** The active controller consumes live
  output. A viewer is hydrated from the server-owned render state when it takes
  control; no browser buffer becomes output authority.
- **User-scoped, never device-scoped.** Two devices of the same
  user are not "competing clients" — they are one user with two
  viewpoints.
- **Server-authoritative for who is currently writing.** The
  client's local cache is best-effort; the server is the source
  of truth. If the client is wrong about who controls, the server
  rejects the mutation; the client never auto-promotes a keystroke.
- **No "first to blink wins".** A new window opening cannot
  accidentally steal control from an already-active controller.
  The user has to click 接管 / Take over.

## What this is not

This is not a multi-user editing protocol. There is no CRDT, no
operational transform, no simultaneous-cursor reconciliation. Two
windows literally cannot both be writing. The model chooses
**which one** and the loser becomes a viewer.

This is also not an authentication boundary. Client-side controller/viewer
gating protects the local interaction model, while authenticated server-side
attachment, generation, and controller validation remains authoritative for
every PTY mutation.

The server validates takeover both before and after the native PTY resize. A
native resize that has already succeeded cannot be rolled back honestly. If the
requesting attachment goes offline while that call is in flight, the server
publishes the acknowledged size as the canonical physical geometry, rejects
the takeover, and leaves controller intent unchanged. This records one PTY fact;
it does not create a second geometry authority or a compensating resize.

## Rules of thumb

- Ordinary input is data, not a controller command. Never turn a keystroke into
  an implicit takeover or buffer it pending a control transition.
- If a design decision is "should a new window auto-claim", the
  answer is: only when there is no effective controller. If there is
  one, the new window is a viewer until the user explicitly takes over.
- If a design decision is "should the user see a 'takeover
  required' modal", prefer the existing viewer projection and takeover action
  over a second blocking interaction model.
- If a design decision is "does this distinguish between user
  devices", the answer is no. Two devices of the same user are
  one user.

## Related documents

- `terminal.md` — the terminal system overall.
- `terminal-target-model.md` — target attachment shape and roles.
- `terminal-session-lifecycle.md` — session birth, lifetime, close.
- `terminal-roadmap.md` — where this model sits in the refactor plan.
