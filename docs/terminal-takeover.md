# Terminal Takeover: Who Controls the Cursor

## Why this document exists

A long-running terminal session in Goblin can outlive any single
window. The user may be on a desktop Electron app, a laptop browser
tab, or a server browser tab — and they will move between them
while the same shell keeps running in the background. The product
has to decide, at every moment, **which window is allowed to type**.
The answer to that question is what this document is about.

This is a principles-level document. It does not describe fields,
methods, timers, or flags. It describes the *shape* of the answer
and the *constraints* the answer has to respect. Implementation
lives in `src/server/terminal/terminal-controller.ts`,
`src/web/components/terminal/authority-gate.ts`, and the
`ManagedTerminalSlot` glue.

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

A terminal session in Goblin has one writer at a time. Exactly one
window is *the controller* — the one whose keystrokes reach the
shell. All other windows are *viewers*: they see the same screen,
they read the same output, but their input is dropped at the
boundary.

This isn't a security boundary; it's a coordination boundary. If
two windows typed at once, the user's mental model of the shell
would shatter: which cursor is the shell listening to? whose
keystrokes are echoed back? where does my Ctrl+C go?

So the design is: **at any instant, exactly one window is the
controller.**

## The principle: intent-recent, user-scoped

Control is bound to the **user's most recent write intent**, not
to any specific window. From the user's point of view, the
following all mean the same thing:

- I just typed.
- I just opened this terminal on another device.
- I just clicked 接管 because the cursor was stuck elsewhere.

Each of those is a clear signal that the user wants *this window*
to be the one in control. The system must honor that signal
without requiring the user to first close the previous window.

Crucially, the system has no business distinguishing "another
device of mine" from "another tab of mine" from "another Electron
window of mine". They're all the same user. The boundary that
matters is *write intent just happened*, not *what kind of
attachment produced that intent*.

## The button, demoted

Goblin's UI exposes a 接管 / Take over button. Its role is a
**shortcut** — a low-frequency path for the rare moment when the
user can see the terminal but cannot, for whatever reason, issue
a normal keystroke (e.g. a frozen tab they want to revive without
reloading).

The main path is:

1. User opens a terminal in a fresh window.
2. Window attaches; the server recognizes that this user has
   touched the session before and grants control.
3. Window is now the controller.
4. User types. Keystrokes flow through the local gate.
5. If the window is a *viewer* (some sibling window is currently
   the controller), the gate promotes it before the keystroke
   reaches the server. The user sees no interruption — they
   typed, the keystroke arrived.

The button is no longer load-bearing. It exists for accessibility
and for the rare "I want control without typing" case.

## The control flag, lifted to the user

The server remembers, for the lifetime of a session, that **this
user has touched this session**. That single bit of sticky
memory is what makes the roam scenarios work:

- User closes the controller window. The controller slot is
  cleared at once.
- User opens a new window elsewhere, attached to the same session.
- The server sees: "user has been here before, no live
  controller, new attachment wants in" → grants control.

This is why "I closed Electron, then opened a new Electron window,
and the previous terminal state was still mine" works. The user
sticky bit carries the claim across window lifetimes. The window
identity is ephemeral; the user identity is durable.

## Output fans out; only input is exclusive

Control applies to **writing**, not reading. Every open window —
controller and viewers alike — sees the same PTY output.
Switching devices never costs the user the screen they were
looking at.

The asymmetry is intentional: reading from a shell is a passive
broadcast, but writing is a single-stream commitment the shell
itself makes (every keystroke is appended to one input pipe). The
model has to match what the underlying PTY actually does, not
impose a richer contract than the OS provides.

## Why a same-window reconnect is non-disruptive

When a window's network briefly drops and comes back to the same
attachment, the user perceives no interruption: the new attach is
recognized as a continuation of the same window, the slot is
cleared on disconnect, and the reattach re-claims through the
user-sticky path. Because the reconnect and the reclaim happen
back-to-back, the user sees their next keystroke flow as expected.

This works because **window identity is per-sessionStorage, which
survives a socket-level reconnect within the same window**, and
**user identity is per-access-token, which is even more durable**.
The two-tier identity means the model can tell "same window, brief
network issue" apart from "different window, deliberate switch".

## When the original controller is *not* the next to arrive

The same-window reconnect is the friendly case. The less-friendly
case is a small but real race:

1. Window A is the controller.
2. A's network drops. The server clears the controller slot on
   the same event (no grace period).
3. Window B — a sibling tab, an Electron window on another
   machine, anything the user opened while A was away — attaches
   first. B auto-claims because the slot is empty and the user
   has touched this session before.
4. A's network comes back. A reconnects, but the slot is held by
   B. A is now a viewer.

This is intentional. The "most recent write intent wins" rule
is the only rule the system can apply without keeping a grace
timer (which would reintroduce the 30-second ambiguity this
model exists to remove). The user's recovery path is the
AuthorityGate: the next keystroke A types fires a takeover
round-trip, A becomes the controller, and the keystroke flows.
The user perceives the same "I typed and it worked" experience
they get in the friendly case — the only difference is one
extra round-trip on the first keystroke after A returns.

In practice the window between A's disconnect and B's attach is
much smaller than the time it takes a human to switch windows
and reattach, so this case is rare. When it does bite, the
recovery path is the same as the friendly case: type, get
control.

## Why a crashed controller is non-disruptive

A controller's process can die (laptop sleep, OS kill, NIC
stuck) while the OS keeps the underlying TCP socket in
`ESTABLISHED` for minutes or hours. Without intervention the
server would still believe that `(userId, clientId)` is
connected, the slot's controller would stay pinned to the
dead client, and every sibling viewer would be stranded in
viewer mode with no path to auto-claim.

A per-`clientId` heartbeat closes this gap:

- The renderer emits `{ type: 'heartbeat', at: <ms> }` on the
  realtime socket every `HEARTBEAT_INTERVAL_MS` (30 s) while
  the socket is `OPEN`. The envelope is small (a few bytes),
  has no request id, and does not generate a response.
- The server's `TerminalRealtimeBroker` records
  `lastHeartbeatAtByClientKey` on every receipt and scans it
  every `HEARTBEAT_INTERVAL_MS`. A `(userId, clientId)` whose
  last beat is older than `HEARTBEAT_DEADLINE_MS` (90 s, i.e.
  3 missed beats) gets a synthetic `onClientDisconnected`,
  which clears the slot's controller slot and emits
  `controller: null` to every sibling.
- The next `attach` from any sibling (or from a freshly
  reconnected A) takes the auto-claim path — same as the
  friendly-reconnect case above — and the user perceives
  no difference from a clean disconnect.

The `HEARTBEAT_INTERVAL_MS` / `HEARTBEAT_DEADLINE_MS` constants
are exported from
`src/server/terminal/terminal-realtime-broker.ts` so the
renderer (in `src/web/renderer-terminal-bridge.ts`) and the
broker cannot drift out of sync.

## Known behavior: self-reconnect mid-flight

The friendly reconnect case has one observable wrinkle. When A's
socket drops, the server clears the slot and emits a
`controller: null` event. When A's socket comes back, the
server re-emits `controller: A` after the auto-claim. Between
those two events — typically a few milliseconds — A's renderer
sees its cached role transition from `controller` to `unowned`
(per the realtime `identity` event carrying `controller: null`)
and back to `controller`.

A's `ManagedTerminalSlot` reacts to the `unowned` event in
`handleIdentity` by calling `start()` immediately if the view
is connected, so the next identity event (carrying `controller:
A`) lands while the auto-attach round-trip is already in
flight. The `unowned` window in the runtime / gate is therefore
very short — a few hundred microseconds at most, bounded by
the microtask queue rather than the round-trip.

If the user types **during** the `unowned` window, the gate's
`authorize('write')` returns `{ kind: 'denied', reason:
'slot-closed' }` — the gate deliberately distinguishes `unowned`
from `viewer` so it does not auto-promote a write against a slot
the server has just cleared. The keystroke is dropped at the
gate. (Pre-PR, the gate collapsed `unowned` to `viewer` and
auto-promoted, which caused the spurious takeover round-trip
this PR's identity/lifecycle split fixes.) Once the second
identity event lands and the role flips back to `controller`,
the next keystroke goes through without any extra round-trip.

This is not a bug; it is the cost of a model that has no grace
timer. A renderer-side coalescing window (e.g. "wait 100ms
after a self-reconnect before firing takeover on write") would
hide the dropped keystroke but would re-introduce a small grace
period on the client, which is exactly what the server-side
no-grace design exists to avoid. The right answer is to accept
the rare dropped keystroke (it is recoverable — the next
keystroke always works) and document the behavior so it
doesn't surprise future contributors.

## Boundaries this model respects

- **One writer at a time.** The shell sees one input stream.
- **Output fans out to everyone.** No window loses its view of the
  shell.
- **User-scoped, never device-scoped.** Two devices of the same
  user are not "competing clients" — they are one user with two
  viewpoints.
- **Server-authoritative for who is currently writing.** The
  renderer's local cache is best-effort; the server is the source
  of truth. If the renderer is wrong about who controls, the next
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
with access to the renderer could bypass the gate. The gate
protects the user's mental model, not their secrets.

## Rules of thumb

- If a design decision is "should this user action require manual
  takeover", the answer is almost always no. The user typed;
  honor it.
- If a design decision is "should a new window auto-claim", the
  answer is: only when there is no live controller. If there is
  one, the new window is a viewer until the user types (or until
  they take over via the button).
- If a design decision is "should the user see a 'takeover
  required' modal", the answer is: only when the takeover button
  is the *only* way to make progress. In normal use it is not.
- If a design decision is "does this distinguish between user
  devices", the answer is no. Two devices of the same user are
  one user.

## Related documents

- `terminal.md` — the terminal system overall.
- `terminal-target-model.md` — target attachment shape and roles.
- `terminal-slot-lifecycle.md` — session birth, lifetime, close.
- `terminal-roadmap.md` — where this model sits in the refactor plan.
