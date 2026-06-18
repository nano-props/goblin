# Terminal: session lifecycle correctness

> **Status**: combined bug-fix and design note.
> All four roots described here are implemented on `main` as of
> `694c68c`. The type-level atomicity follow-up #1 (§Type-level
> atomicity) and the takeover atomicity follow-up #5 (§Takeover
> atomicity) landed on top. The document is retained as the
> authoritative contract and as a record of why the implementation
> is shaped the way it is.
>
> - R0 first-frame atomicity — `d020cd5`, type-level tightening
>   in §Type-level atomicity.
> - R1 durable close, R2 `session-closed` broadcast, R3 empty-state
>   CTA — landed together in `fa67adb` (the "wip: snapshot
>   uncommitted tree" baseline; the commit name is from the
>   code-review prep step, the code itself is the stable fix set
>   this document describes).
>
> Replaces the narrower `terminal-first-frame-fix.md` note, which only
> described the first-frame atomicity slice of this same symptom family.

## Why this document exists

The terminal feature has surfaced several bugs that look unrelated but
share one underlying weakness: the `create` path does not own the
created session's lifecycle end to end.

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
- An empty terminal slot rendered nothing — no CTA, no affordance. The
  `terminal.empty` i18n key was defined but never wired.

None of these are one-off workarounds. They are three faces of the
same gap:

> **`create` returns the handshake, but the renderer's view of the
> session's lifecycle — including close, broadcast, and rendering the
> empty slot — was treated as a series of unrelated follow-ups.**

This document defines the contract that closes that gap.

## Scope

In scope:

- `create` first-frame protocol (already implemented, summarized below
  for completeness and to anchor the design rules).
- Durable close on the client — every close must be tracked to server
  ack before a subsequent create in the same repo is allowed to race.
- `session-closed` per-session broadcast — multi-window consistency
  without a full repo list rescan.
- Empty-state CTA on the terminal slot.

Out of scope:

- Moving `TerminalSessionRegistry` to a renderer-level singleton
  lifetime. Tracked as `terminal-roadmap.md` P1.7.
- Transport-level reconnect / backoff design. Tracked as `terminal.md`
  / `realtime.md`.
- Server-side PTY health probes (separate operational concern).

---

## User-visible symptoms

The combined symptom list across the three root causes:

- **First terminal opened blank** (R0).
- **Torn / partially replayed first prompt**, including an isolated
  inverse-video `%` (R0).
- **Visible terminal but a `failed to create terminal` toast** on top
  (R0 — false failure).
- **Two identical `Restored session: …` lines** on opening a new
  terminal after closing one (R1 + R2 — orphan PTY reused).
- **Empty terminal slot with no CTA** — the user has to guess how to
  open a new terminal (R3).
- **Multi-window drift**: terminal disappears from window A but window
  B keeps showing it until the next reconcile (R2 — missing broadcast).

## Root causes, briefly

- **R0 — `create` had no atomic first-frame protocol.** The server
  knew the snapshot during `create`, but the public response did not
  treat it as the authoritative handshake. The renderer reconstructed
  the first frame from multiple asynchronous sources.
- **R1 — Close is fire-and-forget and silent on failure.**
  `ManagedTerminalSession.dispose()` calls
  `void terminalBridge.close(...).catch(() => {})`. A WebSocket
  mid-request teardown or a race with `closeSocketIfIdle` can drop
  the close before the server sees it. The PTY stays alive.
- **R2 — The catalog reuses orphan sessions by key.**
  `terminal-catalog.ts` returns `action: 'restored'` for any existing
  session with a controller. Combined with `forceNew: false` in
  `ensureSession`, the new client attaches to the orphan PTY. There
  is no explicit per-session close broadcast, so other windows
  cannot drop their local copy promptly.
- **R3 — Empty-state slot had no UI affordance.** `TerminalSlot.tsx`
  renders a bare `<div>` host when `!hasSessions && slotMode === 'opening'`.
  The `terminal.empty` i18n key was defined but never rendered.

---

## R0: First-frame atomicity (`create`)

### Status

Implemented in commit `d020cd5`. This section preserves the design
rules so they can be cited from the protocol contract; the bug analysis
is intentionally retained in summary form.

### Protocol changes

1. `create` now returns the created session's first-frame hydration
   data directly. The success payload carries the same class of
   information the renderer already relied on for `attach` /
   `restart`:
   - `sessionId`
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

2. `create` now participates in the realtime pause boundary. The
   server treats `create` like `attach` / `restart` for the purpose
   of buffering per-socket output while the snapshot-bearing
   response is being prepared. The snapshot-bearing response is
   the authoritative boundary; live output around it follows the
   same discipline as `attach` / `restart`.

3. The renderer hydrates directly from the `create` response. There
   is no follow-up snapshot fetch to paint the first frame.

### `create.sessions` is projection data, not the success oracle

- `create.sessionId` + `snapshot` + `snapshotSeq` are the
  **authoritative first-frame handshake**.
- `create.sessions` is **projection / directory data**.

`create.sessions` is useful for tab-strip updates, terminal count,
session metadata projection, and reducing an immediate list-sessions
round-trip. It is **not** a success criterion for first paint, and
treating it as one introduced the false-failure toast described
below.

### False failure after a successful create

After R0 landed, a renderer-side bug surfaced more clearly: the
terminal could appear successfully but the create promise rejected
with "failed to create terminal", triggering an empty-state CTA
toast.

The renderer was doing an overly strict validation step:

- required `sessionId`, `snapshot`, `snapshotSeq` from `create`, **and**
- required the returned `sessions` list to already include the
  created session.

That extra requirement was removed. When the returned session list
lags the created session, the renderer now:

1. trusts the authoritative `create` payload for first paint,
2. synthesizes temporary projection data if needed,
3. lets later session-sync / reconciliation catch up normally.

### Type-level atomicity (follow-up #1)

Follow-up #1 from §Suggested follow-ups landed: the shared protocol
types now require the first-frame fields at the type level, so a
forgotten field surfaces as a compile error rather than a runtime
crash. Two changes:

1. A new `TerminalFirstFrame` interface
   (`src/shared/terminal-types.ts`) is the single source of truth for
   the first-frame handshake. It lifts every field that R0 made
   required (`sessionId`, `processName`, `canonicalTitle`, `phase`,
   `message`, `snapshot`, `snapshotSeq`, `controller`, `canonicalCols`,
   `canonicalRows`).
2. `TerminalAttachResult` no longer accepts `canonicalCols?` /
   `canonicalRows?` — both are required. The internal server-side
   `EnsureTerminalCatalogResult` shape was tightened to match.
3. `TerminalCatalogMutationResult` intersects with `TerminalFirstFrame`
   instead of `Partial<Extract<TerminalAttachResult, { ok: true }>>`,
   so every `create` success carries the full first-frame payload at
   the type level. The renderer's runtime "missing sessionId" check
   is now redundant for the type-checked paths (and stays as a
   belt-and-suspenders guard against `unknown`/JSON-blob shapes
   arriving from the bridge layer).

The renderer-side fabrication path in `performCreateTerminal` is
removed: if the server claims `action: 'created'` but the catalog
`sessions[]` does not echo that session, the create is rejected with
`error.terminal-create-failed` instead of silently inventing a
synthetic session entry. The first-frame payload is now the source
of truth — fabrication was hiding real protocol mismatches
(half-applied creates that committed the session row but skipped the
catalog append).

---

## R1: Durable close

### Status

Implemented on `main` (landed via `fa67adb`). Registry state
`pendingCloseBySessionId` (`TerminalSessionRegistry.ts:88`),
`enqueueDurableClose` (488), `flushPendingClosesForRepo` (517),
`destroy` rejection (149–160), and the `ManagedTerminalSession.dispose`
rewire (851). Coverage in
`TerminalSessionRegistry.create.test.ts` (durable close describe
block, lines 215 onward).

### Why

`ManagedTerminalSession.dispose()` today:

```ts
for (const sessionId of sessionIds) {
  void terminalBridge.close({ sessionId }).catch(() => {})
}
```

Two problems:

- `.catch(() => {})` swallows rejections. A WebSocket mid-request
  teardown (`renderer-terminal-bridge.ts:104
rejectPendingSocketRequests`, called from `handleSocketDisconnection`)
  or a race with `closeSocketIfIdle` can drop the close before the
  server sees it.
- The dispose path is not awaited. A subsequent create in the same
  worktree can race ahead, the catalog can still see the orphan PTY
  in its directory, and the catalog returns `action: 'restored'`
  for the same key.

The fix is not "retry with timeout" or "fire-and-forget with
backoff". It is to make close a tracked operation with the same
shape as the existing `pendingCreateByWorktree` registry pattern.

### Design

Mirror the existing `pendingCreateByWorktree` triple
(`enqueuePendingCreate` / `flushPendingCreate` / `destroy`) for closes.

**New registry state** (`TerminalSessionRegistry.ts`):

```ts
private readonly pendingCloseBySessionId = new Map<
  string,
  { promise: Promise<void>; resolve: () => void; reject: (err: unknown) => void }
>()
```

**New registry methods**:

- `enqueueDurableClose({ sessionId, worktreeTerminalKey })` —
  called from `ManagedTerminalSession.dispose()`. Records a pending
  entry, kicks off `terminalBridge.close` in the background, resolves
  on server ack, rejects on socket error. The entry is removed from
  the map on either outcome.
- `flushPendingClosesForRepo(repoRoot)` — awaited at the top of
  `performCreateTerminal` so a subsequent create in the same window
  cannot race with a lost close. Drains all entries whose
  `worktreeTerminalKey` belongs to the same repo before the create
  is issued.
  - If the close succeeds, the orphan is gone and the catalog will
    create fresh.
  - If the close fails (timeout / disconnect), log via
    `terminalLog.warn` and proceed. The user can `pruneTerminals`
    from the UI to clean up.
- `destroy()` — reject and clear the new map, mirroring the
  `pendingCreateByWorktree` rejection at `destroy()`.

**Caller change** (`ManagedTerminalSession.ts`):

- Replace the fire-and-forget loop with
  `registry.enqueueDurableClose({ sessionId, worktreeTerminalKey: this.descriptor.worktreeTerminalKey })`.
- Local view teardown stays synchronous — the next create rebuilds
  from a fresh server-side session.
- Registry is injected via the constructor alongside `notify` and
  `onBell`. No back-reference from the class to the registry; the
  registry installs a callback on the descriptor's `notify` flow.

**Logging**:

- Replace `.catch(() => {})` with logging on both success and failure.
  This is intentionally noisy — the bug is silent today, and any
  future regression must be visible in logs.

```ts
registry.enqueueDurableClose({ sessionId, worktreeTerminalKey }).catch((err) => {
  terminalLog.warn('durable close failed', { sessionId, err })
})
```

### Why this is the root cause, not a patch

- No timeout / retry logic added.
- Each piece of state (pending close, flush, destroy) has a single
  owner.
- The create path does not change; it only waits for the close path
  to settle before issuing. The catalog can still return `action:
'restored'` — that is correct behavior when an orphan exists; the
  bug is that the orphan exists when it should not.

---

## R2: `session-closed` broadcast

### Status

Implemented on `main` (landed via `fa67adb`). Protocol variant in
`src/shared/terminal-socket.ts:30-37`. Server emit in
`terminal-runtime-actions.ts:144-156`. Renderer dispatcher branch
in `renderer-terminal-bridge.ts:186`. Registry handler
`handleSessionClosed` in
`TerminalSessionRegistry.ts:210`. Coverage in
`terminal-runtime-actions.test.ts` (emits both broadcasts on
successful close; non-owner close does not leak a phantom
event) and `TerminalSessionRegistry.create.test.ts`
(handleSessionClosed drops the matching local session).

### Why

Today, the only way other windows learn a session is gone is the
`sessions-changed` broadcast. That is a full repo list rescan — too
heavy for "window A just closed a terminal, drop it from window B's
local view promptly".

A per-session broadcast is the targeted counterpart.

### Protocol change

Add to `TerminalRealtimeMessage` in `src/shared/terminal-socket.ts`:

```ts
| { type: 'session-closed'; sessionId: string; repoRoot: string }
```

### Server emit

In `terminal-runtime-actions.ts`, after `manager.closeSessionForOwner(...)`
returns `true`:

```ts
broker.broadcastToOwner(ownerId, {
  type: 'session-closed',
  sessionId: input.sessionId,
  repoRoot,
})
```

The `repoRoot` is derived from the session's scope. The message is
sent only to sockets for the same `ownerId`; other owners never see
the closed session id. The manager
returns it on the close result, or we look it up via
`manager.findSessionById(sessionId)` before closing.

### Renderer dispatcher

`src/web/renderer-terminal-bridge.ts`:

- Add `sessionClosedSubscribers: Set<(event) => void>` and include
  it in `hasRealtimeSubscribers()`.
- Add a dispatcher branch for `message.type === 'session-closed'`
  in the same switch that handles `output` / `title` / `exit` /
  `ownership` / `sessions-changed`.
- Expose `onSessionClosed(cb)` on the returned bridge and add a
  matching method to `RendererTerminalBridge` in
  `src/web/renderer-bridge-types.ts`.

### Registry subscribes

`TerminalSessionProvider.tsx`: mirror the `onExit` pattern. On
`session-closed`:

```ts
const key = sessionKeyBySessionId.get(event.sessionId)
if (key) registry.discardLocalSessionAndDismissDetailIfLast(key, descriptor)
```

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

### Status

Implemented on `main` (landed via `fa67adb`). `EmptyTerminalCta`
component (`TerminalSlot.tsx:471-509`) renders the overlay with
`terminal.empty` title and `terminal.new` button when
`slotMode === 'opening' && !hasSessions`. The button's
`creating` local state guards against double-click; on failure the
slot toasts `error.terminal-create-failed`. i18n keys present in
all four locales (`en` 331, `zh` 311, `ja` 326, `ko` 319 for
`terminal.new`; `en` 335, `zh` 315, `ja` 330, `ko` 323 for
`terminal.empty`). Coverage in `TerminalSlot.test.tsx` (success
path renders the CTA + click triggers createTerminal; failure
path toasts).

### Why

`TerminalSlot.tsx` renders a bare `<div>` host when `!hasSessions &&
slotMode === 'opening'`. The user has to guess where to click. The
`terminal.empty` i18n key is defined but never wired. The dead
branch at `TerminalSlot.tsx:419` shows the gate was planned but
never built.

### Design

When `!hasSessions && slotMode === 'opening'`, render an overlay
with a "New terminal" button.

- Reuse `terminal.new` (defined in `en.ts:331`, wired up in
  `BranchDetailToolbar.tsx`).
- Reuse `terminal.empty` if already defined; add to locales that
  lack it.
- Compute `terminalBase` from the slot's `repoRoot` / `branch` /
  `worktreePath` props (already on `TerminalSlotProps`).
- The button calls `createTerminal(base)` from the slot's
  `useTerminalSessionContext`.
- On failure, toast via the existing `sonner` import in
  `TerminalSlot.tsx`.

Gate the existing dead branch at `TerminalSlot.tsx:419` on the new
condition.

### Why this is part of the same fix family

The empty-state CTA is the visible counterpart to the protocol
fixes: even if the protocol is correct, a user who opens the slot
and sees nothing will reach for whatever they can find, which is
exactly the path that produced the `bun dev` "blank terminal tab"
report.

---

## Takeover atomicity (follow-up #5)

### Status

Implemented on `main`. The `terminal.takeover` response is now
the authoritative handshake for the new controller's view; the
realtime `ownership` event keeps the same shape (and the same
authority role) for the _other_ ownership-change paths
(controller crash, grace expiry, fresh attach). The renderer no
longer waits for a follow-up `ownership` event before painting
the post-takeover frame.

### The two-step handshake that was

Before this change, `terminal.takeover` returned only
`{ ok, sessionId, controller }`. The renderer treated the
realtime `ownership` event as the authority and used the bridge
response only to "trigger the server-side handoff". The
comment in `ManagedTerminalSession.takeover()` was explicit:

> "Ownership changes are applied exclusively via authoritative
> onOwnership realtime messages. The bridge response is only used
> to trigger the server-side handoff."

The cost was a stale window between the response settling and the
`onOwnership` event arriving:

- `runtime.canResize()` returned `false` (viewer gate), so any
  resize the user fired in that window was short-circuited at
  `flushResize` and never reached the PTY.
- User keystrokes typed in that window were dropped at the
  input gate.
- The takeover spinner cleared only after the realtime event
  arrived (~50–100ms after the response).

This violated the same "atomicity" R0 enforced for `create` /
`attach` / `restart`: the renderer had to wait for a separate
round-trip to know the new frame state, instead of trusting the
response.

### What changed

1. `TerminalTakeoverResult` now carries the full first-frame
   payload on the success branch — `role`,
   `controllerStatus`, `canonicalCols`, `canonicalRows`, `phase`,
   alongside the existing `controller`. The shape mirrors
   `TerminalFirstFrame` minus the snapshot fields
   (`snapshot`, `snapshotSeq`) — takeover doesn't return a fresh
   snapshot because the new controller keeps whatever the viewer
   was already showing (no need to re-fetch the buffer).
2. `TerminalOwnershipEvent` and the renderer-side
   `TerminalOwnershipViewModel` gain `phase` so the realtime path
   stays shape-consistent with the takeover response. Both
   surfaces carry the same fields, and the renderer can apply
   either without re-checking what fields it has.
3. The server-side `TerminalSessionManager.takeoverResult`
   builder now reads `session.cols`, `session.rows`,
   `session.phase` synchronously after `applyOwnershipEffect`
   runs and packs them into the response. The realtime
   `emitOwnership` payload carries `phase: session.phase` for
   the non-takeover paths.
4. `TerminalSessionState.applyOwnership` accepts `phase` and
   routes it through `setPhaseAndMessage` so role / geometry /
   phase are applied in the same atomic patch.
5. `ManagedTerminalSession.takeover()` now awaits the response
   and calls `runtime.applyTakeover(result)`, a new method that
   feeds the response into the existing `applyOwnership` path.
   The previous `.catch(() => {})` becomes
   `terminalLog.warn('takeover failed ...')` to mirror the
   `terminal.ts:resize` rejection pattern.
6. `TerminalSessionRegistry.handleOwnership` and the bridge
   conversion in `renderer-terminal-bridge.ts` were aligned to
   carry the new `phase` field through.

### What is _not_ changed

The realtime `ownership` event keeps its authority role on the
non-takeover paths (controller crash, grace expiry, controller
reconnect). For those, ownership-event-as-authority is the only
choice — there is no response to be authoritative. A subsequent
realtime event for the _same_ sessionId after a successful
takeover is treated as a benign re-apply with identical values
(no-op).

`TerminalSlot` and `BranchDetailToolbar` UI are unchanged — they
read `role` / `controllerStatus` from the runtime and simply see
the new values arrive one round-trip sooner.

### Multi-window safety

The authoritative takeover response and the realtime `ownership`
event for the same session carry the same fields. If two windows
take over in parallel, the server resolves the conflict (one
window becomes controller, the other becomes viewer); both
windows get a consistent picture within one round-trip — the
takeover winner sees role flip from the response, the loser
sees role flip from the realtime event the server emits. Both
arrive at the same final state.

### Verification

- `bun run test` — all 1425 tests pass (added 2 takeover tests
  asserting the new authoritative contract; flipped 2 existing
  tests that asserted the old "wait for the realtime event"
  behavior).
- `bun run typecheck` — clean (the new fields propagate through
  every typed surface; the inline `TerminalOwnershipViewModel`
  literal at `TerminalSessionRegistry.handleOwnership` and in
  the test files were collapsed to the named type so future
  field additions propagate automatically).
- `terminal.test.ts` — wire-format ownership message updated to
  include `phase` so the validator accepts it.
- `terminal-runtime.test.ts` — two takeover success assertions
  updated to the new 7-field shape; the existing
  `expect(ownershipMessage).toMatchObject({...})` for the
  realtime emission already accepts the new `phase` field as an
  additive change.

### Out of scope

- No restructuring of who-emits-when for the realtime event.
- `TerminalFirstFrame` is unchanged — takeover borrows its shape
  but doesn't need to extend it.
- Task #70 (P2 contract tests) — separate phase.

---

## Implementation history

All four roots landed on `main`:

- **R0** (first-frame atomicity) — `d020cd5`.
- **R1, R2, R3** landed together in `fa67adb`. The commit name is
  "wip: snapshot uncommitted tree"; that is a code-review prep
  label (the commit message says "Captures everything in the
  working tree at the start of the code-review pass so subsequent
  fixes (#15-#23) can be reviewed as atomic commits against this
  baseline"). The R1/R2/R3 code in `fa67adb` is the stable fix
  set this document describes — it is not a draft. Treat those
  three as implemented at `fa67adb` for any forward-looking
  planning.

Follow-up #5 from §Suggested follow-ups also landed: takeover's
two-step handshake (response + realtime `ownership` event) was
collapsed into a single authoritative handshake, with the realtime
event kept as the authority only on the non-takeover paths. See
§Takeover atomicity (follow-up #5).

For reference, the notional landing order _had_ this fix set been
split into separate commits (it was not, due to the wip-snapshot
baseline):

### P1 — Renderer-only, lowest risk

R3: empty-state CTA.

- Renderer-only. No protocol change, no registry change.
- i18n key already defined in all four locales.
- No risk of regressing existing terminal flows.
- Visible UX win on its own.

### P2 — Protocol addition

R2: `session-closed` broadcast.

- Adds a new `TerminalRealtimeMessage` variant. Additive — old
  subscribers ignore the new variant.
- Cross-window behavior change but no behavior regression.

### P3 — Largest blast radius

R1: durable close.

- Required injecting the registry into `ManagedTerminalSession`'s
  constructor.
- Changed `dispose()` semantics — every dispose path now goes
  through the pending-close map. Existing dispose tests had to be
  updated to await the pending close.
- Added a sequencing step at the top of `performCreateTerminal`
  (await `flushPendingClosesForRepo`). Existing registry tests that
  raced close + create in the same worktree were reviewed in
  lockstep.

**Suggested (notional) order had it been split**: R3 → R2 → R1.

---

## Verification

### Per fix — existing coverage

**R0**:

- `TerminalSessionProvider.test.tsx` test mocks supply the new
  first-frame hydration fields on both `created` and `reused`
  paths. Registry-side validation in
  `TerminalSessionRegistry.create.test.ts` covers the
  `create.sessionId` + `snapshot` + `snapshotSeq` rule.

**R1** — `TerminalSessionRegistry.create.test.ts`
(`describe('durable close')`):

- `awaits an in-flight close for the same worktree before creating`
  (215).
- `failures do not block the next create` (264).
- `deduplicates concurrent enqueues for the same session` (289).
- `destroys reject pending entries` (318).
- `handleSessionClosed drops the matching local session` (336).

**R2**:

- `terminal-runtime-actions.test.ts`:
  - `emits BOTH sessions-changed and session-closed on a successful
close` (56).
  - A non-owner close does not leak a phantom `session-closed`
    event (84).
  - A failed close path does not synthesize a `session-closed`
    with a fake repoRoot (100, 129).
- `TerminalSessionProvider.test.tsx`: `session-closed` mocks feed
  the registry's `handleSessionClosed` path (already exercised by
  the R1 durable-close test above).

**R3** — `TerminalSlot.test.tsx`:

- Renders the empty-state CTA when `!hasSessions` (success path
  asserts aria-label, title text, and button text match the
  i18n keys; click triggers `createTerminal` with the right args).
- `empty-state CTA failure toasts error.terminal-create-failed`
  (1361).

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

- `bun run test` — all 1419 tests pass.
- `bun run typecheck` — clean (architecture + no-html-injection +
  all 3 tsconfig projects).
- `bun run lint` (if present) — clean.

---

## Rules to preserve going forward

These rules are derived from the symptom family and should outlive
any individual implementation:

1. **Do not use `create.sessions` as the success criterion for first
   paint.** `create.sessionId` + `snapshot` + `snapshotSeq` are the
   authoritative created-session handshake. `create.sessions` is
   projection data.
2. **Keep `create`, `attach`, and `restart` aligned in first-frame
   semantics.** All three produce a terminal frame the user can
   immediately see; they all owe the same atomic handshake.
3. **Close is durable.** `dispose()` must not be fire-and-forget on
   the server side. The registry owns pending close state.
4. **Close is a broadcast event.** When the server confirms a close,
   other windows learn about it through `session-closed`, not
   through a full reconcile.
5. **A subsequent create in the same worktree must await in-flight
   closes in that worktree.** The catalog must never hand back an
   orphan as `action: 'restored'` when the local dispose is still
   pending.
6. **Empty-state UI is part of the contract.** A terminal slot with
   zero sessions must show the affordance to open one.
7. **Treat React/provider lifetime concerns separately from terminal
   protocol correctness.** The first-frame fix and the singleton
   lifetime cleanup (P1.7) are related but separate.

---

## Suggested follow-ups

1. **Done** — tighten the shared `TerminalCatalogMutationResult`
   type so the first-frame fields are required at the type level,
   not only by renderer-side validation. (See §Type-level atomicity.)
2. **Done (rolled back via `282ea76`)** — Decide explicitly whether
   the same-session snapshot reapply patch (broadened
   `ManagedTerminalSession.hydrate()`) should stay as a supported
   repair path. The broadened hydrate was rolled back: it
   re-painted xterm mid-session and caused terminal-emulator
   protocol replies (OSC color queries) to leak into the PTY
   stdin path as input pollution. Incident recorded in
   `docs/terminal-input-attribution.md`. The first-frame
   `applyOpenResult` path is the only re-apply route now; same-
   session re-hydration is a no-op.
3. **Done (P1.7)** — Decide explicitly whether the delayed
   provider-destroy heuristic (one-macrotask delay on
   `TerminalSessionProvider` cleanup) should remain until P1.7
   lands. P1.7 (`ebb88ef`) supersedes it — the registry is now a
   renderer-level singleton, so per-provider destroy debouncing is
   not needed. The debounce was removed in `f19eba1`.
4. **Done (P1.7)** — Move `TerminalSessionRegistry` to a renderer-
   level singleton lifetime. (See `terminal-roadmap.md` P1.7.)
5. **Done** — collapse the takeover two-step handshake (response +
   realtime `ownership` event) into a single authoritative
   handshake, keeping the realtime event as authority only on the
   non-takeover paths. (See §Takeover atomicity.)
6. Add a contract-test pass over the terminal invariants listed in
   `terminal-roadmap.md` P2.

---

## Related documents

- `docs/terminal.md` — terminal system design
- `docs/terminal-roadmap.md` — refactor roadmap (P1.7, P1.8, P2
  contract tests)
- `docs/terminal-target-model.md` — terminal target lifecycle and
  ownership model
- `docs/realtime.md` — realtime channel discipline that R2's
  `session-closed` broadcast inherits from
