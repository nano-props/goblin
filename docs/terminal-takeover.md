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
lives in `src/server/terminal/terminal-controller.ts`,
`src/web/components/terminal/authority-gate.ts`, and the
`TerminalSession` glue.

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

The shell must keep running. The user expects their **most recent
intent to win**, without ceremony.

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

## The principle: intent-recent, user-scoped

Control is bound to the **user's most recent write intent**, not
to any specific window. From the user's point of view, the
following all mean the same thing:

- I just typed.
- I just opened this terminal on another device.
- I just clicked 接管 because the cursor was stuck elsewhere.

Each of those is a clear signal that the user wants _this window_
to be the one in control. The system must honor that signal
without requiring the user to first close the previous window.

Crucially, the system has no business distinguishing "another
device of mine" from "another tab of mine" from "another Electron
window of mine". They're all the same user. The boundary that
matters is _write intent just happened_, not _what kind of
attachment produced that intent_.

## The button, demoted

Goblin's UI exposes a 接管 / Take over button. Its role is a
**shortcut** — a low-frequency path for the rare moment when the
user can see the terminal but cannot, for whatever reason, issue
a normal keystroke (e.g. a frozen tab they want to revive without
reloading).

The main path is simple: a window attaches, the server projects the
current effective controller, and the next write intent either flows
through or promotes that attachment first. The user sees the same rule
everywhere: type where you are, and that window becomes the writer when
it is safe to do so.

The button is no longer load-bearing. It exists for accessibility
and for the rare "I want control without typing" case.

## The control flag, lifted to the user

The server remembers, for the lifetime of a session, that **this
user has touched this session**. That single bit of sticky
memory is what makes the roam scenarios work:

- User closes the controller attachment/socket. Broker presence marks
  that `(userId, clientId)` offline, so the stored controller intent
  projects to no effective controller at once.
- User opens a new window elsewhere, attached to the same session.
- The server sees: "user has been here before, no effective
  controller, new attachment wants in" → grants control.

This is why "I closed Electron, then opened a new Electron window,
and the previous terminal state was still mine" works. The user
sticky bit carries the claim across window lifetimes. The window
identity is ephemeral; the user identity is durable.

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
the user-sticky path. Because the reconnect and the reclaim happen
back-to-back, the user sees their next keystroke flow as expected.

This works because **window identity is per-sessionStorage, which
survives a socket-level reconnect within the same window**, and
**user identity is per-access-token, which is even more durable**.
The two-tier identity means the model can tell "same window, brief
network issue" apart from "different window, deliberate switch".

## When the original controller is _not_ the next to arrive

The same-window reconnect is the friendly case. The less-friendly
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

This is intentional. The "most recent write intent wins" rule
is the only rule the system can apply without keeping a grace
timer (which would reintroduce the 30-second ambiguity this
model exists to remove). The user's recovery path is the
AuthorityGate: the next keystroke A types fires a takeover
round-trip, A becomes the controller, and the keystroke flows.
The user perceives the same "I typed and it worked" experience
they get in the friendly case — the only difference is one
extra round-trip on the first keystroke after A returns.

In practice the window between A going offline and B's attach is
much smaller than the time it takes a human to switch windows
and reattach, so this case is rare. When it does bite, the
recovery path is the same as the friendly case: type, get
control.

## Why a crashed controller is non-disruptive

A controller's process can die (laptop sleep, OS kill, NIC
stuck) while the OS keeps the underlying TCP socket in
`ESTABLISHED` for minutes or hours. Without intervention the
server would still believe that `(userId, clientId)` is online,
the effective controller would stay pinned to the dead client,
and every sibling viewer would be stranded in viewer mode with
no path to auto-claim.

A per-`clientId` heartbeat closes this gap. The client emits a small
heartbeat while its realtime socket is open; the broker treats the
server receipt time as the presence clock. If that clock goes stale,
the broker closes the stale sockets and marks the attachment offline.
Stored controller intent is not erased, but it no longer projects to an
effective controller, so the next attach can auto-claim the session.

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
- **Output fans out to everyone.** No window loses its view of the
  shell.
- **User-scoped, never device-scoped.** Two devices of the same
  user are not "competing clients" — they are one user with two
  viewpoints.
- **Server-authoritative for who is currently writing.** The
  client's local cache is best-effort; the server is the source
  of truth. If the client is wrong about who controls, the next
  keystroke will be auto-promoted or dropped, never silently sent
  to the wrong place.
- **No "first to blink wins".** A new window opening cannot
  accidentally steal control from an already-active controller.
  The user has to either type into the new window (which fires
  the auto-promote) or click 接管.

## What this is not

This is not a multi-user editing protocol. There is no CRDT, no
operational transform, no simultaneous-cursor reconciliation. Two
windows literally cannot both be writing. The model chooses
**which one** and the loser becomes a viewer.

This is also not a security boundary. A malicious local script
with access to the client could bypass the gate. The gate
protects the user's mental model, not their secrets.

## Rules of thumb

- If a design decision is "should this user action require manual
  takeover", the answer is almost always no. The user typed;
  honor it.
- If a design decision is "should a new window auto-claim", the
  answer is: only when there is no effective controller. If there is
  one, the new window is a viewer until the user types (or until
  they take over via the button).
- If a design decision is "should the user see a 'takeover
  required' modal", the answer is: only when the takeover button
  is the _only_ way to make progress. In normal use it is not.
- If a design decision is "does this distinguish between user
  devices", the answer is no. Two devices of the same user are
  one user.

## Related documents

- `terminal.md` — the terminal system overall.
- `terminal-target-model.md` — target attachment shape and roles.
- `terminal-session-lifecycle.md` — session birth, lifetime, close.
- `terminal-roadmap.md` — where this model sits in the refactor plan.
