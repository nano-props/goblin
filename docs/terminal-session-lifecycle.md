# Terminal: session lifecycle correctness

> **Status**: combined bug-fix and design note.
> Covers the `create` first-frame protocol (already implemented in `d020cd5`),
> the durable-close + `session-closed` broadcast rework (planned),
> and the empty-state CTA (planned).
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

### Transitional type shape (known follow-up)

`TerminalCatalogMutationResult` is currently in a transitional state:
the new first-frame fields are surfaced through a partial
attach-like shape, with the renderer enforcing them at runtime.
A follow-up should tighten the shared type so the first-frame fields
are required at the type level, not only by renderer-side validation.
Tracked in §Suggested follow-ups.

---

## R1: Durable close

### Status

Planned. Not yet implemented.

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

Planned. Not yet implemented.

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

In `terminal-runtime-actions.ts`, after `manager.closeOwnedSession(...)`
returns `true`:

```ts
broker.broadcastGlobal({
  type: 'session-closed',
  sessionId: input.sessionId,
  repoRoot: input.repoRoot ?? '',
})
```

The `repoRoot` is derived from the session's scope — the manager
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

Planned. Not yet implemented.

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

## Implementation priority

These three fixes have very different blast radii and dependencies.
Do not land them in one commit.

### P0 — Already done

R0 (first-frame atomicity). Landed in `d020cd5`.

### P1 — Land first (lowest risk, smallest surface)

R3: empty-state CTA.

- Renderer-only. No protocol change, no registry change.
- i18n key already defined in most locales.
- No risk of regressing existing terminal flows.
- Visible UX win on its own.

### P2 — Land second (protocol addition)

R2: `session-closed` broadcast.

- Adds a new `TerminalRealtimeMessage` variant. Additive — old
  subscribers ignore the new variant.
- Requires bumping the renderer-bridge manifest entry for the new
  channel and updating `extractIpcChannelLiterals` lockdown test
  to include it.
- Cross-window behavior change but no behavior regression.

### P3 — Land last (largest blast radius)

R1: durable close.

- Requires injecting the registry into `ManagedTerminalSession`'s
  constructor.
- Touches `dispose()` semantics — every dispose path now goes
  through the pending-close map. Existing tests must be updated to
  await the pending close.
- The flush-on-create addition is a sequencing change at the
  registry level. Existing registry tests that race close + create
  in the same worktree must be reviewed.

**Suggested order**: R3 → R2 → R1, in three separate commits.

---

## Verification

### Per fix

**R0 (done)**: covered by the `TerminalSessionProvider` test mocks
and the registry's first-frame validation. Manual smoke test:
`bun dev` → click terminal tab → single prompt, no inverse-video `%`,
no false failure toast.

**R1**:

- `TerminalSessionRegistry.test.ts`:
  - `enqueueDurableClose` records an entry; entry is removed after
    `terminalBridge.close` resolves.
  - `flushPendingClosesForRepo` awaits the in-flight close; the
    next `performCreateTerminal` only fires `terminalBridge.create`
    after the close settles.
  - `destroy` rejects pending entries — no leaked promises.
- `ManagedTerminalSession.test.ts`:
  - Successful `terminalBridge.close` → no pending close, no warn.
  - Rejected `terminalBridge.close` → entry recorded, `terminalLog.warn`
    called.
- `TerminalSessionRegistry.create.test.ts`:
  - A previous `enqueueDurableClose` for the same worktree is awaited
    before the create is issued; the create sees fresh `action:
    'created'`.

**R2**:

- `terminal-runtime-actions.test.ts`:
  - Successful close emits both `sessions-changed` and
    `session-closed`.
  - Failed / not-found close emits neither.
- `renderer-terminal-bridge.test.ts`:
  - `onSessionClosed` subscribers receive the event.
- `TerminalSessionProvider.test.tsx`:
  - `session-closed` for a known key calls
    `discardLocalSessionAndDismissDetailIfLast`.

**R3**:

- `TerminalSlot.test.tsx`:
  - Zero sessions → renders empty-state CTA.
  - Click CTA → calls stubbed `createTerminal`.
  - Failed create → `sonner` toast.

### Manual smoke (R1 + R2 + R3)

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

- `bun run test` — all existing tests + the new durable-close
  / broadcast / CTA tests pass.
- `bun run typecheck` — clean.
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

1. Tighten the shared `TerminalCatalogMutationResult` type so the
   first-frame fields are required at the type level, not only by
   renderer-side validation. (R0 transitional state.)
2. Decide explicitly whether the same-session snapshot reapply
   patch (broadened `ManagedTerminalSession.hydrate()`) should stay
   as a supported repair path.
3. Decide explicitly whether the delayed provider-destroy heuristic
   (one-macrotask delay on `TerminalSessionProvider` cleanup) should
   remain until P1.7 lands.
4. Move `TerminalSessionRegistry` to a renderer-level singleton
   lifetime. Tracked as `terminal-roadmap.md` P1.7.
5. Add a contract-test pass over the terminal invariants listed in
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
