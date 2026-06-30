# Terminal: session lifecycle correctness

> **Status**: design contract. The fixes described here are implemented.
> This document is the authoritative spec for terminal session lifecycle
> behavior; implementation details live in the source, not in these lines.

## Why this document exists

The terminal feature surfaced several bugs that looked unrelated but shared
one underlying weakness: the `create` path did not own the created session's
lifecycle end to end.

- The first frame depended on a race between `create`, realtime output,
  a follow-up snapshot, and session-list reconciliation. Result: blank
  panels, torn prompts, isolated `%` inverse-video glyphs, and
  "failed to create terminal" toasts on top of a successfully created
  terminal.
- `dispose()` closed the local view state but only fire-and-forget the
  server-side close. The PTY could stay alive. The next create in the
  same window then re-attached to the orphan PTY and the catalog
  happily returned `action: 'restored'` for it. Result: opening a new
  terminal could surface two identical `Restored session: …` lines from
  macOS zsh's session-restore mechanism, because two zsh processes were
  reading the same `~/.zsh_sessions/*.session` file at the same time.
- An empty terminal session rendered nothing — no CTA, no affordance. The
  `terminal.empty` i18n key was defined but never wired.

None of these are one-off workarounds. They are three faces of the
same gap:

> **`create` returns the handshake, but the client's view of the
> session's lifecycle — including close, broadcast, and rendering the
> empty session — was treated as a series of unrelated follow-ups.**

This document defines the contract that closes that gap.

## Scope

In scope:

- `create` first-frame protocol.
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

## Root causes, briefly

- **R0 — `create` had no atomic first-frame protocol.** The server
  knew the snapshot during `create`, but the public response did not
  treat it as the authoritative handshake. The client reconstructed
  the first frame from multiple asynchronous sources.
- **R1 — Close was fire-and-forget and silent on failure.**
  `TerminalSession.dispose()` called `terminalBridge.close(...)`
  with a swallowed rejection. A WebSocket mid-request teardown or a
  race with idle socket shutdown could drop the close before the
  server saw it. The PTY stayed alive.
- **R2 — The catalog reused orphan sessions by terminalSessionId.** The terminal
  catalog returned `action: 'restored'` for any existing session with
  a controller. Combined with `forceNew: false`, the new client
  attached to the orphan PTY. There was no explicit per-session close
  broadcast, so other windows could not drop their local copy
  promptly.
- **R3 — Empty-state session had no UI affordance.** `TerminalSessionView`
  rendered a bare host when `!hasSessions && sessionPhase === 'opening'`.
  The `terminal.empty` i18n key was defined but never rendered.

---

## R0: First-frame atomicity (`create`)

### Protocol changes

1. `create` returns the created session's first-frame hydration
   data directly. The success payload carries the same class of
   information the client already relied on for `attach` / `restart`:
   - `ptySessionId`
   - `processName`
   - `canonicalTitle`
   - `phase`
   - `message`
   - `snapshot`
   - `snapshotSeq`
   - `controller`
   - `canonicalCols`
   - `canonicalRows`

   This makes `create` self-sufficient for the first visible frame.

2. `create` participates in the realtime pause boundary. The
   server treats `create` like `attach` / `restart` for the purpose
   of buffering per-socket output while the snapshot-bearing
   response is being prepared. The snapshot-bearing response is
   the authoritative boundary; live output around it follows the
   same discipline as `attach` / `restart`.

3. The client hydrates directly from the `create` response. There
   is no follow-up snapshot fetch to paint the first frame.

### `create.sessions` is projection data, not the success oracle

- `create.ptySessionId` + `snapshot` + `snapshotSeq` are the
  **authoritative first-frame handshake**.
- `create.sessions` is **projection / directory data**.

`create.sessions` is useful for tab-strip updates, terminal count,
session metadata projection, and reducing an immediate list-sessions
round-trip. It is **not** a success criterion for first paint, and
treating it as one introduced the false-failure toast described
below.

### False failure after a successful create

After R0 landed, a client-side bug surfaced more clearly: the
terminal could appear successfully but the create promise rejected
with "failed to create terminal", triggering an empty-state CTA
toast.

The client was doing an overly strict validation step:

- required `ptySessionId`, `snapshot`, `snapshotSeq` from `create`, **and**
- required the returned `sessions` list to already include the
  created session.

That extra requirement was removed. The client now trusts the
authoritative `create` payload for first paint. `create.sessions`
remains useful for tab-strip and count updates, but a lagging list
no longer triggers the false-failure toast. If the server claims
`action: 'created'` yet the catalog `sessions[]` does not echo that
session, the create is rejected as a half-applied protocol mismatch
rather than silently fabricating a synthetic entry.

### Type-level atomicity

The shared protocol types require the first-frame fields at the type
level, so a forgotten field surfaces as a compile error rather than a
runtime crash.

1. A `TerminalFirstFrame` interface is the single source of truth for
   the first-frame handshake. It lifts every field that R0 made
   required (`ptySessionId`, `processName`, `canonicalTitle`, `phase`,
   `message`, `snapshot`, `snapshotSeq`, `controller`, `canonicalCols`,
   `canonicalRows`).
2. `TerminalAttachResult` no longer accepts optional `canonicalCols` /
   `canonicalRows` — both are required.
3. `TerminalCatalogMutationResult` intersects with `TerminalFirstFrame`
   instead of a partial attach result, so every `create` success carries
   the full first-frame payload at the type level. The client's runtime
   "missing ptySessionId" check stays as a belt-and-suspenders guard
   against `unknown`/JSON-blob shapes arriving from the bridge layer.

---

## R1: Durable close

### Why

`TerminalSession.dispose()` used to close server-side sessions
like this:

```ts
for (const ptySessionId of ptySessionIds) {
  void terminalBridge.close({ ptySessionId }).catch(() => {})
}
```

Two problems:

- `.catch(() => {})` swallows rejections. A WebSocket mid-request
  teardown or a race with idle socket shutdown can drop the close
  before the server sees it.
- The dispose path is not awaited. A subsequent create in the same
  worktree can race ahead, the catalog can still see the orphan PTY
  in its directory, and the catalog returns `action: 'restored'`
  for the same key.

### Design

Mirror the existing pending-create queue (enqueue / flush /
destroy) for closes.

**New projection state**:

```ts
private readonly pendingCloseByPtySessionId = new Map<
  string,
  {
    terminalWorktreeKey: string
    promise: Promise<void>
    resolve: () => void
    reject: (error: unknown) => void
  }
>()
```

**New projection methods**:

- **Enqueue durable close** — called from `TerminalSession` via
  an injected callback. Records a pending entry, kicks off
  `terminalBridge.close` in the background, resolves on server ack,
  rejects on socket error. The entry is removed from the map on
  either outcome. Concurrent calls for the same `ptySessionId` dedupe
  to the same promise.
- **Flush pending closes for the worktree** — awaited inside the
  create flush for the same worktree so a subsequent create cannot
  race with a lost close. Drains all entries whose worktree key
  matches before the create is issued.
  - If the close succeeds, the orphan is gone and the catalog will
    create fresh.
  - If the close fails (timeout / disconnect), log loudly and
    proceed. The user can `pruneTerminals` from the UI to clean up.
- `destroy()` — reject and clear the pending-close map, mirroring the
  pending-create rejection at `destroy()`.

**Caller change**:

- Replace the fire-and-forget loop with an injected durable-close
  callback wired to the projection queue.
- Provide both a synchronous `dispose()` (for backward-compatible
  callers) and an async `disposeAndWait()` (for callers that need a
  resource-release barrier).
- Local view teardown stays synchronous — the next create rebuilds
  from a fresh server-side session.

**Logging**:

- Replace `.catch(() => {})` with logging on both success and failure.
  This is intentionally noisy — the bug is silent today, and any
  future regression must be visible in logs.

### Why this is the root cause, not a patch

- No timeout / retry logic added.
- Each piece of state (pending close, flush, destroy) has a single
  keeper.
- The create path does not change; it only waits for the close path
  to settle before issuing. The catalog can still return `action:
'restored'` — that is correct behavior when an orphan exists; the
  bug is that the orphan exists when it should not.

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
| { type: 'session-closed'; ptySessionId: string; repoRoot: string }
```

### Server emit

After a user-initiated close succeeds:

```ts
broker.broadcastToUser(userId, {
  type: 'session-closed',
  ptySessionId,
  repoRoot,
})
```

The `repoRoot` is derived from the session's scope. The message is
sent only to sockets for the same `userId`; other users never see
the closed session id. Internal/non-user closes (PTY exit, shutdown)
do **not** emit `session-closed`; those paths rely on the broader
session-sync primitives.

### Client dispatcher

The terminal bridge exposes `onSessionClosed(cb)` and dispatches the
`session-closed` variant in the same switch that handles `output`,
`title`, `exit`, `identity`, `lifecycle`, and `sessions-changed`.

### Registry subscribes

The provider mirrors the `onExit` pattern. On `session-closed`:

```ts
terminalBridge.onSessionClosed((event) => {
  projection.handleSessionClosed(event.ptySessionId)
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
authoritative handshake for the new controller's view; the realtime
`identity` event keeps the same shape (and the same authority role)
for the _other_ control-change paths (controller crash, sibling
auto-claim after disconnect, fresh attach). The client no longer
waits for a follow-up `identity` event before painting the
post-takeover frame.

### The two-step handshake that was

Before this change, `terminal.takeover` returned only
`{ ok, ptySessionId, controller }`. The client treated the
realtime `identity` event as the authority and used the bridge
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

1. `TerminalTakeoverResult` carries the full first-frame payload on
   the success branch — `role`, `controllerStatus`, `canonicalCols`,
   `canonicalRows`, `phase`, alongside the existing `controller`. The
   shape mirrors `TerminalFirstFrame` minus the snapshot fields
   (`snapshot`, `snapshotSeq`) — takeover doesn't return a fresh
   snapshot because the new controller keeps whatever the viewer
   was already showing.
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
   the identity + lifecycle apply path in one shot. Takeover
   failures are logged instead of swallowed.
6. The bridge conversion and the runtime's identity handler are
   aligned to route role/status/geometry through the identity
   channel and phase/message through the lifecycle channel.

### What is _not_ changed

The realtime `identity` event keeps its authority role on the
non-takeover paths (controller crash, controller reconnect,
sibling auto-claim). For those, identity-event-as-authority
is the only choice — there is no response to be authoritative.
A subsequent realtime event for the _same_ ptySessionId after a
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

- No restructuring of who-emits-when for the realtime event.
- `TerminalFirstFrame` is unchanged — takeover borrows its shape
  but doesn't need to extend it.

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

- **R0**: provider tests supply the new first-frame hydration fields
  on both `created` and `reused` paths; projection tests cover the
  `create.ptySessionId` + `snapshot` + `snapshotSeq` rule.
- **R1**: projection durable-close tests cover awaiting an in-flight
  close before creating, failures not blocking the next create,
  deduplicating concurrent enqueues, destroying pending entries, and
  dropping the local session on `session-closed`.
- **R2**: runtime-action tests cover emitting both broadcasts on
  successful user close, non-user closes not leaking phantom events,
  and failed closes not synthesizing fake broadcasts.
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

1. **Do not use `create.sessions` as the success criterion for first
   paint.** `create.ptySessionId` + `snapshot` + `snapshotSeq` are the
   authoritative created-session handshake. `create.sessions` is
   projection data.
2. **Keep `create`, `attach`, and `restart` aligned in first-frame
   semantics.** All three produce a terminal frame the user can
   immediately see; they all owe the same atomic handshake.
3. **Close is durable.** `dispose()` must not be fire-and-forget on
   the server side. The projection owns pending close state.
4. **Close is a broadcast event.** When the server confirms a user
   close, other windows learn about it through `session-closed`, not
   through a full reconcile.
5. **A subsequent create in the same worktree must await in-flight
   closes in that worktree.** The catalog must never hand back an
   orphan as `action: 'restored'` when the local dispose is still
   pending.
6. **Empty-state UI is part of the contract.** A terminal session with
   zero sessions must show the affordance to open one.
7. **Treat React/provider lifetime concerns separately from terminal
   protocol correctness.** The first-frame fix and the singleton
   projection lifetime cleanup are related but separate.
8. **Takeover is authoritative in its response.** The takeover
   response carries the new controller's full identity/lifecycle
   frame; the client applies it synchronously. The realtime
   `identity` event remains authoritative only for the non-takeover
   control-change paths.

---

## Suggested follow-ups

1. **Done** — tighten the shared `TerminalCatalogMutationResult`
   type so the first-frame fields are required at the type level.
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
