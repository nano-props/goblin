# Terminal: session lifecycle correctness

> **Status**: design contract. The fixes described here are implemented.
> This document is the authoritative spec for terminal session lifecycle
> behavior; implementation details live in the source, not in these lines.

## Why this document exists

The terminal feature surfaced several bugs that looked unrelated but shared
one underlying weakness: terminal creation, runtime recovery, and local view
startup did not have distinct ownership boundaries.

- The first frame first depended on a race between `create`, realtime output,
  a follow-up snapshot, and session-list reconciliation. A later fix made the
  create snapshot atomic by sequence number, but still exposed transient shell
  redraw state as a visible frame. Result: blank panels, torn prompts, isolated
  `%` inverse-video glyphs, and false create failures.
- `dispose()` closed the local view state but only fire-and-forget the
  server-side close. The PTY could stay alive. The next create in the
  same window then re-attached to the orphan PTY and the session service
  happily returned `action: 'restored'` for it. Result: opening a new
  terminal could surface two identical `Restored session: …` lines from
  macOS zsh's session-restore mechanism, because two zsh processes were
  reading the same `~/.zsh_sessions/*.session` file at the same time.
- An empty terminal session rendered nothing — no CTA, no affordance. The
  `terminal.empty` i18n key was defined but never wired.

None of these are one-off workarounds. They are three faces of the
same gap:

> **Logical session creation, fresh PTY startup, recovery replay, close,
> broadcast, and empty-session rendering need explicit boundaries instead of
> being inferred from one snapshot-shaped create result.**

This document defines the contract that closes that gap.

## Scope

In scope:

- fresh-stream versus recovery-frame protocol.
- Workspace-pane terminal tab materialization from live sessions.
- Durable close on the client — every close must be tracked to server
  ack before a subsequent create in the same repo is allowed to race.
- `session-closed` per-session broadcast — multi-window consistency
  without a full repo list rescan.
- Empty-state CTA on the terminal session.
- Takeover atomicity: the takeover response is the authoritative
  handshake for the new controller's view.

Out of scope:

- Transport-level reconnect / backoff design. Tracked in `docs/terminal.md`
  and `docs/realtime.md`.
- Server-side PTY health probes (separate operational concern).

---

## User-visible symptoms

The combined symptom list across the root causes:

- **First terminal opened blank** (R0).
- **Torn / partially replayed first prompt**, including an isolated
  inverse-video `%` (R0).
- **Visible terminal but a `failed to create terminal` toast** on top
  (R0 — false failure).
- **Two identical `Restored session: …` lines** on opening a new
  terminal after closing one (R1 + R2 — orphan PTY reused).
- **Empty terminal session with no CTA** — the user has to guess how to
  open a new terminal (R3).
- **Multi-window drift**: terminal disappears from window A but window
  B keeps showing it until the next reconcile (R2 — missing broadcast).
- **Refresh loses terminal tab**: the PTY and terminal session are still
  live, but the workspace-pane tab strip has no terminal runtime tab entry to render.

## Root causes, briefly

- **R0 — fresh startup and recovery replay were conflated.** The first
  implementation reconstructed startup from several asynchronous sources. The
  atomic-snapshot fix removed that race, but still treated an output checkpoint
  as a visually committed frame. A shell can emit a prompt redraw across
  multiple PTY chunks, so a sequence-consistent snapshot may still be transient.
 - **R1 — Close authority was split across view disposal and Workspace commands.**
  Local xterm disposal could issue a direct server close independently of
  route/opener settlement and the server-owned retirement boundary.
- **R2 — The session service reused orphan sessions by terminalSessionId.** The terminal
  session service returned `action: 'restored'` for any existing session with
  a controller. Combined with `forceNew: false`, the new client
  attached to the orphan PTY. There was no explicit per-session close
  broadcast, so other windows could not drop their local copy
  promptly.
- **R3 — Empty-state session had no UI affordance.** `TerminalSessionView`
  rendered a bare host when `!hasSessions && sessionPhase === 'opening'`.
  The `terminal.empty` i18n key was defined but never rendered.
- **R4 — Workspace-pane tab projection could drift from live sessions.**
  Terminal sessions and workspace-pane tabs are separate server runtimes.
  After reload/restore, the session list could recover while the tab list
  lacked `{ type: 'terminal', runtimeSessionId: terminalSessionId }`, so the UI had no tab to
  render even though the PTY was alive.

---

## R0: Fresh startup versus recovery replay

### Authoritative boundary

The server remains authoritative for the session, PTY, controller, canonical
geometry, output sequence, and headless render state. The client owns only its
mounted xterm rendering and fitted view geometry. Keeping Server First does not
require making every view start Snapshot First.

The protocol now has three explicit outcomes:

1. `create` prepares or finds the logical session and returns runtime metadata
   (`terminalRuntimeSessionId`, generation, process/lifecycle/controller data,
   and canonical geometry). It does not start a newly created PTY and carries no
   `snapshot` fields.
2. `attach` returns `frame: 'stream'` only when that request starts a prepared
   PTY with no missed history. The client has already mounted and fitted its one
   xterm, so the PTY starts at that geometry and realtime output begins at
   sequence 1 without reset/replay.
3. `attach` returns `frame: 'snapshot'` for an existing PTY. Restart also always
   returns a snapshot frame. Those responses carry `snapshot`, `snapshotSeq`,
   and `outputEra`, and the client uses them as a recovery boundary.

`open` means the spawned PTY handle is bound to its data and exit listeners. It
does not mean that a first output chunk has arrived. Quiet processes that wait
for stdin are therefore writable immediately; output acceptance is tracked
separately by the server render sequence and snapshot checkpoint.

The server, not the client, chooses the attach frame from PTY state. A second
attach waiting on an in-flight fresh spawn is a recovery attach and receives a
snapshot after the spawn completes; it cannot share the first request's stream
claim because it may have missed earlier output.

Fresh binding activation also advances the authoritative sessions projection
and broadcasts `sessions-changed`. Other clients may still hold the prepared
generation 0 binding; generation 1 identity, lifecycle, and output events are
intentionally insufficient to activate them because they may have missed
history. They reconcile the complete projection and recover through a snapshot.
The invalidation applies equally when fresh spawn fails: generation 1 plus its
error lifecycle is still a new authoritative projection that generation 0
siblings cannot reconstruct from incremental events.

Snapshot presence is explicit in the client projection. `null` means recovery
did not supply a snapshot; an empty string is a supplied authoritative blank
screen and must reset any previous binding's xterm. String length is never used
to decide whether a recovery frame exists.


### Transport ordering

Attach pauses that socket's realtime fanout while the response is built. The
response is sent before buffered events are resumed:

- stream frame: drop nothing, so sequence 1 and every later event reach the
  mounted xterm after its binding metadata is committed;
- snapshot frame: drop buffered output represented by the snapshot checkpoint,
  then flush only later output.

Workspace runtime open still uses the same response-before-realtime ordering,
but it has no render checkpoint and therefore drops no output. Fresh sessions
cannot emit PTY output during create because their process does not exist yet.

### Why an atomic snapshot was insufficient

`snapshotSeq` proves which PTY chunks the server headless xterm has parsed. It
does not prove the shell has completed a prompt redraw. In the recorded failure,
zsh's inverse-video `PROMPT_EOL_MARK` was present in one serialized screen and
cleared by the next output chunk. Both states were sequence-consistent; only the
first was an undesirable visible startup frame. Fixed waits and prompt-specific
detection would create a second readiness protocol with no general terminal
meaning.

The current design follows the VS Code boundary instead: create and size xterm
before a fresh process, stream fresh data directly, and reserve serializer
replay for persistent/revived processes. Our server-side headless xterm remains
active from sequence 1 so later reconnect, switch, and recovery behavior stays
Server First.

### Type-level separation

The shared protocol prevents the paths from collapsing again:

1. `TerminalCreateResult` contains `TerminalRuntimeMetadata` but no render
   snapshot.
2. `TerminalAttachResult` is discriminated by `frame: 'stream' | 'snapshot'`;
   snapshot fields exist only on the snapshot branch.
3. `TerminalRestartResult` permits only `frame: 'snapshot'`.
4. Geometry and controller metadata remain required on every successful frame.

### `terminalRuntimeSessionId` is an addressable runtime id, not a live-handle proof

In the server-first model `terminalRuntimeSessionId` is the runtime session
lookup id used by attach, write, resize, restart, close, and realtime
messages. It must not be read as "there is definitely a live PTY handle
right now".

That distinction matters most on restart failure:

- the server keeps the terminal session addressable;
- the session moves to `phase: 'error'`;
- the `terminalRuntimeSessionId` remains the id to retry with;
- writes and resizes are still rejected because the server checks phase,
  controller authority, and PTY binding state before touching a PTY.

The durable identity for a terminal business session is still
`terminalSessionId`. A workspace-pane runtime tab stores that value in the
generic `runtimeSessionId` field.
The lower-level live resource is the supervisor PTY handle. Keeping these
three concepts separate prevents restart failures from accidentally
turning into session deletion.

## R4: Workspace-pane terminal tab materialization

`listWorkspaceTabs` is the canonical projection boundary between live terminal
sessions and the workspace-pane tab strip.

When the server lists workspace tabs it purely projects stored layout intent
against live terminal sessions for the same user and repo runtime:

- live sessions materialize missing terminal runtime tab entries
- stale terminal runtime tab entries are removed
- static tabs and existing order are preserved where possible
- the read performs no self-healing write, revision increment, or broadcast

Terminal sessions store their target `branch` at creation time. This is
intentional: branch is runtime metadata for the terminal business object, not
something the client should reconstruct from a repo snapshot during refresh.
The same invariant applies to local and remote terminals.

---

## R1: Server-owned composed close

### Why

Local view disposal is not a terminal business command. Letting it close the
server session split authority from Workspace navigation and made transport
failure indistinguishable from successful membership removal.

### Design

The public direct terminal-close socket action and client durable-close queue
are removed. User close goes through the composed Workspace runtime command,
which preserves `closeOperationByRuntimeBindingKey` until retirement and
close-back navigation settle. The manager kills and awaits the PTY first; a
failure preserves Directory membership and the visible tab. Successful
retirement removes Directory membership exactly once, and canonical tabs
converge by projection.

### Why this is the root cause, not a patch

- No client retry or fallback membership is added.
- View teardown owns only DOM/xterm resources.
- Server retirement single-flight owns PTY safety; Directory owns membership.

---

## R2: `session-closed` broadcast

### Why

The only way other windows learned a session was gone was the
`sessions-changed` broadcast. That is a full repo list rescan — too
heavy for "window A just closed a terminal, drop it from window B's
local view promptly".

A per-session broadcast is the targeted counterpart.

### Protocol change

Add to `TerminalRealtimeMessage`:

```ts
| {
    type: 'session-closed'
    terminalRuntimeSessionId: string
    terminalSessionId: string
    repoRoot: string
    worktreePath: string
  }
```

### Server emit

After a user-initiated close succeeds:

```ts
broker.broadcastToUser(userId, {
  type: 'session-closed',
  terminalRuntimeSessionId,
  terminalSessionId,
  repoRoot,
  worktreePath,
})
```

The `repoRoot`, `worktreePath`, and `terminalSessionId` are captured
before the close removes the session from the manager. The message is
sent only to sockets for the same `userId`; other users never see
the closed session id. Internal/non-user closes (PTY exit, shutdown)
do **not** emit `session-closed`; those paths rely on the broader
session-sync primitives.

### Client dispatcher

The terminal client exposes `onSessionClosed(cb)` and dispatches the
`session-closed` variant in the same switch that handles `output`,
`title`, `exit`, `identity`, `lifecycle`, and `sessions-changed`.

### Registry subscribes

The provider mirrors the `onExit` pattern. On `session-closed`:

```ts
terminalClient.onSessionClosed((event) => {
  projection.handleSessionClosed(event)
})
```

The projection drops the matching local session without issuing a
second server close (the originating window already disposed the
local entry, and the server has already killed the PTY).

This handles the case where window A's close drops the socket
mid-flight and window B's server-side close still emits the broadcast
— both windows end up consistent.

### Why both R1 and R2

R1 fixes the same-window case: a subsequent create in the same
window cannot race with a lost close. R2 fixes the cross-window
case: window B drops window A's session in ~100ms instead of
waiting for the next reconcile. Together they make session close
a coherent event across the system, not just a local view teardown.

---

## R3: Empty-state CTA

### Why

`TerminalSessionView` rendered a bare host when `!hasSessions &&
sessionPhase === 'opening'`. The user had to guess where to click. The
`terminal.empty` i18n key was defined but never rendered.

### Design

When `sessionPhase === 'opening' && !hasSessions`, render an overlay
with a "New terminal" button.

- Reuse the existing `terminal.new` and `terminal.empty` i18n keys.
- The button calls the session's create handler with the worktree's
  base (`repoRoot`, `branch`, `worktreePath`).
- Guard against double-click with a local `creating` state.
- On failure, toast via the existing terminal-create error path.

### Why this is part of the same fix family

The empty-state CTA is the visible counterpart to the protocol
fixes: even if the protocol is correct, a user who opens the session
and sees nothing will reach for whatever they can find, which is
exactly the path that produced the `bun dev` "blank terminal tab"
report.

---

## Takeover atomicity

### Status

Implemented. The `terminal.takeover` response is now the
authoritative handshake for the new controller role/lifecycle state; the realtime
`identity` event keeps the same shape (and the same authority role)
for the _other_ control-change paths (controller crash, sibling
auto-claim after disconnect, fresh attach). The client no longer
waits for a follow-up `identity` event before enabling the controller view;
xterm paint still comes from the normal server snapshot path.

### The two-step handshake that was

Before this change, `terminal.takeover` returned only
`{ ok, terminalRuntimeSessionId, controller }`. The client treated the
realtime `identity` event as the authority and used the client
response only to "trigger the server-side handoff".

The cost was a stale window between the response settling and the
`onIdentity` event arriving:

- Input gates returned `false` because the runtime still saw the old
  role, so keystrokes and resizes fired in that window were dropped.
- The takeover spinner cleared only after the realtime event arrived
  (~50–100ms after the response).

This violated the same "atomicity" R0 enforced for `create` /
`attach` / `restart`: the client had to wait for a separate
round-trip to know the new frame state, instead of trusting the
response.

### What changed

1. `TerminalTakeoverResult` carries an authoritative control-frame payload on
   the success branch — `role`, `controllerStatus`, `canonicalCols`,
   `canonicalRows`, `phase`, alongside the existing `controller`. The
   shape intentionally excludes the snapshot fields (`snapshot`,
   `snapshotSeq`, `outputEra`) — takeover changes control ownership, not
   render ownership. A viewer is a readonly metadata projection; after
   takeover, the controller paints xterm from the server snapshot path
   instead of trusting a viewer-owned render buffer.
2. `TerminalIdentityEvent` and the client-side
   `TerminalIdentityViewModel` keep the same role/geometry shape
   as the takeover response. Both surfaces carry the same fields,
   and the client can apply either without re-checking what fields
   it has.
3. The server-side takeover builder reads session geometry and phase
   synchronously after the identity effect runs and packs them into
   the response. The realtime `identity` payload carries the same
   role/status/canonical-size fields for the non-takeover paths.
4. Identity and lifecycle application are split: identity carries
   role/status/geometry; lifecycle carries phase/message. The two
   are disjoint, so a transitional phase update can never look like
   a role change at the apply boundary.
5. The client awaits the takeover response and applies it through
   `runtime.applyTakeover(result)`, which feeds the response into
   the identity + lifecycle apply path in one shot. The controller view
   then starts/reattaches through the normal server snapshot path when it
   needs to paint xterm. Takeover failures are logged instead of swallowed.
6. The client conversion and the runtime's identity handler are
   aligned to route role/status/geometry through the identity
   channel and phase/message through the lifecycle channel.

### What is _not_ changed

The realtime `identity` event keeps its authority role on the
non-takeover paths (controller crash, controller reconnect,
sibling auto-claim). For those, identity-event-as-authority
is the only choice — there is no response to be authoritative.
A subsequent realtime event for the _same_ terminalRuntimeSessionId after a
successful takeover is treated as a benign re-apply with
identical values (no-op).

The terminal session and workspace-toolbar UI are unchanged — they
read role / controller status from the runtime and simply see the
new values arrive one round-trip sooner.

### Multi-window safety

The authoritative takeover response and the realtime `identity`
event for the same session carry the same fields. If two windows
take over in parallel, the server resolves the conflict (one
window becomes controller, the other becomes viewer); both
windows get a consistent picture within one round-trip — the
takeover winner sees role flip from the response, the loser
sees role flip from the realtime event the server emits. Both
arrive at the same final state.

### Verification

- Add or update tests asserting that the takeover response carries
  role/status/geometry/phase and that the runtime applies them
  without waiting for a realtime event.
- Add or update tests asserting that the subsequent realtime
  `identity` event is idempotent.
- Add or update wire-format tests asserting that the realtime
  identity message carries role/status/geometry and that phase lives
  on the separate lifecycle channel.

### Out of scope

- Takeover remains a metadata/control handshake. If it causes a local view to
  be recreated, the ordinary attach path decides whether a snapshot is needed.

---

## Implementation history

All four roots landed historically. The code has since been
refactored into `src/web/components/terminal/` and
`src/server/terminal/`. The contract in this document is the
stable part; file paths and internal method names are subject to
further refactoring.

Had the fix set been split into separate commits, the notional
order would have been:

1. **R3: empty-state CTA** — client-only, lowest risk, visible UX win.
2. **R2: `session-closed` broadcast** — additive protocol change, no
   behavior regression.
3. **R1: durable close** — largest blast radius, requires injecting
   the durable-close queue into the session disposal path and sequencing
   close-before-create in the projection.

---

## Verification

### Per fix — existing coverage

- **R0**: manager tests prove create preparation does not spawn, the fitted
  attach starts one PTY and returns a stream frame, concurrent/later attaches
  receive snapshots, and headless recovery includes fresh output. Realtime
  tests prove the attach response precedes sequence 1 without dropping it.
  Client tests prove a stream frame performs no xterm reset or snapshot write.
- **R1**: projection durable-close tests cover awaiting an in-flight
  close before creating, in-flight close failures allowing the queued
  create to proceed afterward, deduplicating concurrent enqueues,
  destroying pending entries, and dropping the local session on
  `session-closed`.
- **R2**: runtime-action tests cover the targeted `session-closed`
  action broadcast on successful user close, non-user closes not
  leaking phantom events, and failed closes not synthesizing fake
  broadcasts. Runtime integration tests cover the broader
  `sessions-changed` / workspace invalidation paths for close-like
  lifecycle changes.
- **R3**: session tests cover rendering the CTA when the session has no
  sessions, click triggering create, and failure toasting.

### Manual smoke (still applicable as a regression check)

1. `bun dev`.
2. Click terminal tab → empty-state CTA appears (R3). Click CTA →
   fresh terminal opens with the prompt.
3. Type `echo foo && pwd` → both echo, prompt is single, no
   duplicate `Restored session` line.
4. Close the terminal → no `Restored session` line on next create
   (R1).
5. Open a new terminal → fresh prompt, no `Restored session` line
   (R1).
6. Multi-window: open two windows of the same repo. Close the
   terminal in window A. Window B drops the local session within
   ~100ms without needing a full reconcile (R2).

### Global

- `bun run test` — passing.
- `bun run typecheck` — clean.

---

## Rules to preserve going forward

These rules are derived from the symptom family and should outlive
any individual implementation:

1. **Create metadata is not a render frame.** It prepares or identifies the
   server session and commits workspace membership; it does not carry a
   snapshot or prove that a PTY has started.
2. **Stream only from complete history.** Only the attach request that starts a
   PTY before any output exists may receive `frame: 'stream'`. Any view that may
   have missed history receives `frame: 'snapshot'`.
3. **Close is durable.** `dispose()` must not be fire-and-forget on
   the server side. The projection owns pending close state.
4. **Close is a broadcast event.** When the server confirms a user
   close, other windows learn about it through `session-closed`, not
   through a full reconcile.
5. **A subsequent create in the same worktree must await in-flight
   closes in that worktree.** The session service must never hand back an
   orphan as `action: 'restored'` when the local dispose is still
   pending.
6. **Empty-state UI is part of the contract.** A terminal session with
   zero sessions must show the affordance to open one.
7. **Treat React/provider lifetime concerns separately from terminal
   protocol correctness.** The frame-protocol fix and the singleton
   projection lifetime cleanup are related but separate.
8. **Takeover is authoritative in its response.** The takeover
   response carries the new controller's full identity/lifecycle
   frame; the client applies it synchronously. The realtime
   `identity` event remains authoritative only for the non-takeover
   control-change paths.

---

## Suggested follow-ups

1. **Done** — split `TerminalCreateResult`, stream attach, snapshot attach, and
   snapshot-only restart at the type and validator boundaries.
2. **Done** — decide explicitly that same-session snapshot reapply is
   not a supported repair path. The long-term rule now lives in
   `docs/terminal.md`: replay side effects are local rendering
   artifacts and must not be forwarded as user stdin.
3. **Done** — move `TerminalSessionProjection` to a client-level singleton
   lifetime. The projection is now created on first access and lives
   for the client's entire lifetime; the provider is only a wiring
   adapter.
4. **Done** — collapse the takeover two-step handshake (response +
   realtime `identity` event) into a single authoritative handshake,
   keeping the realtime event as authority only on the non-takeover
   paths.
5. Add contract tests for the terminal invariants listed in
   `docs/terminal-roadmap.md` P2.

---

## Related documents

- `docs/terminal.md` — terminal system design
- `docs/terminal-roadmap.md` — refactor roadmap
- `docs/terminal-target-model.md` — terminal target lifecycle and
  control model
- `docs/realtime.md` — realtime channel discipline that R2's
  `session-closed` broadcast inherits from
