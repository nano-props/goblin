# Terminal Performance Optimization Plan

> Status: **proposed — draft PR**. Owner: TBD. Last updated: 2026-06-17.
>
> **Project context.** Goblin is a single-user desktop terminal app.
> This plan is written under the constraint that **safety and
> reliability matter more than raw performance**, and **new caches are
> admitted only when they have a clear invalidation contract and a
> fallback path to the source of truth**. Many items in earlier drafts
> were cut for that reason — see "Items removed" at the bottom.

## 1. Background

Two inputs drive this plan:

1. **Audit of existing cache & performance mechanisms** in the
   in-memory terminal module (`src/server/terminal/`,
   `src/web/components/terminal/`,
   `src/web/renderer-terminal-bridge.ts`). The audit found that the
   existing mechanisms are largely sound — every layer has a clear
   invalidation contract and cleanup path — but a handful of hot
   paths and lifecycle edges are missing cheap wins or carry
   uncontrolled growth.

2. **First-open latency diagnosis**: opening a terminal tab for the
   first time in a session takes noticeably longer than subsequent
   opens. The orchestrator (`ManagedTerminalSession.openPhase`) is a
   7-await chain; the two biggest contributors are *unprewarmed font
   fetch* and *lazy WebSocket attach*, with a fixed-cost 4-frame
   `waitForTerminalLayout` between them.

## 2. Decision rules (safety-first)

Before adding any optimization, the following must be true:

- **No new cache without an explicit invalidation path.** If a
  fallback to the source of truth isn't obvious, don't add the cache.
- **No async write paths in lifecycle hooks.** Sync `detach`
  (snapshot into reattach cache), sync `serialize()` — these are
  user-visible guarantees, not implementation details. A user's
  scrollback and cursor position survive a tab switch because we
  serialize synchronously; an async version can drop that guarantee
  in the idle window before reattach.
- **No state machine reshaping for an edge case.** If a change only
  helps when a particular cache is warm, the right fix is to warm
  the cache earlier — not to reorder the state machine.
- **No "estimate and skip" logic that hides the cost.** If a
  snapshot is huge, the right answer is to bound the source (lower
  the ring-buffer cap, lower the cache cap), not to silently drop
  user state at write time.
- **No fragmentation / binary framing** until measurements show the
  single-message cap is actually a bottleneck.
- **No replacing established caps with larger ones without a
  measurement.** The 32-cap on `reattachSnapshotCache` was
  multi-tenant sized; for a single user it's over-provisioned, not
  undersized.

These rules are why several items in earlier drafts of this plan
were removed (see "Items removed").

## 3. Existing mechanisms (kept as-is)

These are already correct and stay unchanged:

| Mechanism | Location | Notes |
|---|---|---|
| 16 MiB ring buffer with `safeTail` boundary repair | `src/server/terminal/terminal-render-state.ts:7-92` | Theoretical edge case documented and accepted |
| Microtask-batched PTY input | `src/server/terminal/terminal-session-manager.ts:597-614` | Avoids write interleaving |
| Per-socket pause/resume counter | `src/server/terminal/buffered-terminal-socket.ts:50-60` | Replay+live dedup on attach |
| 30 s request timeout, socket generation stale-check | `src/web/renderer-terminal-bridge.ts:357-390`, `67-89` | Prevents stuck requests |
| rAF-batched xterm output | `src/web/components/terminal/ManagedTerminalSession.ts:525-544` | One `term.write` per paint frame |
| Microtask-batched resize | `src/web/components/terminal/ManagedTerminalSession.ts:481-514` | Coalesces resize storms |
| `waitForMeasurableHost` with AbortSignal, no hardcoded timeout | `src/web/components/terminal/terminal-session-geometry.ts:59-99` | Lands in #55; do not regress |
| 80 ms resize / font-load debounce | `src/web/components/terminal/terminal-session-view.ts:34-35` | 5 frames, well-tuned |
| Reattach snapshot cache (cap 32, insertion-order LRU) | `src/web/components/terminal/TerminalSessionRegistry.ts:79-636` | Correctness is fine; the cap itself is over-sized for single-user (see T2.1) |
| `WorktreeTerminalSnapshot` lazy invalidation | `src/web/components/terminal/TerminalSessionRegistry.ts:561-566` | Worktree-keyed granular invalidation |
| Connection-state TTL: 30 s grace + 24 h detached | `src/server/terminal/terminal-connection-state.ts:30-53` | Disconnect/reconnect with no orphans |
| WeakMap-based socket metadata | `src/server/terminal/terminal-realtime-broker.ts:17-20` | GC-driven leak prevention |

## 4. Proposed changes

### Tier 1 — Quick wins (≤ 1 day, no new state)

> Goal: remove the two largest sources of first-open latency; cost
> is a few lines of glue. No new state, no new cache, no protocol
> change. All four items have **no fallback path** concerns because
> they don't introduce any new persistence.

#### T1.1 — Prewarm terminal font at app startup
- **File**: `src/web/components/terminal/terminal-geometry.ts:20-28`,
  call site in `src/web/components/terminal/TerminalSessionProvider.tsx`
  (or whatever bootstraps the terminal subsystem).
- **Change**: `void preloadTerminalFont()` once at provider mount.
  The function is idempotent (`document.fonts.check` short-circuits
  on subsequent calls), so double-invocation is harmless. Failure
  is already swallowed by `.catch(() => {})`.
- **Eliminates**: 100-500 ms first-open font fetch.
- **Risk**: 0.

#### T1.2 — Prewarm WebSocket on `WorktreePane` mount
- **File**: `src/web/renderer-terminal-bridge.ts` (add
  `prewarm()`), call site in `src/web/components/terminal/TerminalSlot.tsx`
  (or the worktree pane container).
- **Change**: when a `WorktreePane` mounts, fire a
  `terminalBridge.listSessions({ repoRoot })`. This triggers
  `ensureSocket` and pays DNS+TCP+TLS+WS before the user actually
  clicks a terminal tab.
- **Eliminates**: 100-500 ms first-open attach handshake.
- **Risk**: 0 (no new protocol; `listSessions` is already on the
  wire).
- **Note (revised trigger)**: earlier draft suggested
  `pointerenter` / `focus`. For a single-user app the cleaner
  semantic is "the user entered a worktree pane, so they may open a
  terminal" — wire the prewarm to `WorktreePane` mount instead of a
  per-tab hover, to avoid a dangling WS when the user hovers but
  never clicks.

#### T1.3 — Collapse the two `waitForTerminalLayout` calls in `openPhase`
- **File**:
  `src/web/components/terminal/ManagedTerminalSession.ts:351-357` and
  `:624-626`.
- **Change**: keep the pre-`fitNow` rAF barrier (it gates
  `term.open` layout). Fire the post-`fitNow` rAF barrier as a
  `Promise` that runs in parallel with the subsequent
  `terminalBridge.attach`. The fit-then-wait dependency is encoded
  by the `fitNow` mutation; we just don't need to *block* on the
  second wait.
- **Eliminates**: 2 frames (~33 ms) from every attach.
- **Risk**: 0 (purely a control-flow reshape; `waitForTerminalLayout`
  is pure).
- **Doc contract**: add a comment at the call site explaining that
  the second rAF barrier is *intentionally* concurrent with the IPC
  roundtrip, so a future refactor that turns `attach` into a local
  cache lookup must restore the blocking wait.

#### T1.4 — Document the cell-metrics cache invariant
- **File**: `src/web/components/terminal/terminal-geometry.ts:18-67`.
- **Change**: add a JSDoc note that `cachedTerminalCellMetrics` is
  process-wide and assumes `TERMINAL_FONT_FAMILY` /
  `TERMINAL_FONT_SIZE` are constant for the page lifetime. Export
  a test-only `__resetCachedTerminalCellMetricsForTest` so this
  invariant is exercisable in unit tests.
- **Eliminates**: future footgun.
- **Risk**: 0.

#### T1.5 — Clear `hydratedSnapshot` after successful preload
- **File**:
  `src/web/components/terminal/ManagedTerminalSession.ts:56, 191, 452-471, 473-479`.
- **Status**: **bug fix, not optimization**. The current code
  stores the hydration snapshot on every `hydrate()` call and
  never clears it. After the snapshot is written into xterm
  (via `preloadHydratedSnapshot` or
  `applyHydratedSnapshotToActiveView`), the in-memory copy is
  pure waste. Worst case: ~16 MiB per session × N sessions,
  re-populated on every reconcile.
- **Change**: in `preloadHydratedSnapshot` and
  `applyHydratedSnapshotToActiveView`, after the
  `term.write(snapshot)` resolves, clear
  `this.hydratedSnapshot` — but only if the field still holds
  the same reference (the registry may re-hydrate between
  `await termWrite` and the clear; without the identity check
  we'd discard a fresher value).
  ```ts
  // inside preloadHydratedSnapshot, after the write:
  if (this.hydratedSnapshot === hydratedSnapshot) {
    this.hydratedSnapshot = { snapshot: '', snapshotSeq: 0 }
  }
  ```
  Same pattern in `applyHydratedSnapshotToActiveView`.
- **Eliminates**: up to 16 MiB × session count of dead
  memory, kept forever.
- **Risk**: 0. The identity check prevents the only race
  (re-hydration during the write). No external behavior change.
- **Why this lives in Tier 1**: it's a 4-line patch that
  fixes a real leak, not a perf optimization. Doing it now
  also means every later tier operates on the smaller,
  saner memory profile.

### Tier 2 — Single-user memory tuning (≤ 1 day, one number change)

> Goal: align an over-provisioned cap with single-user reality,
> without adding new decision logic.

#### T2.1 — Lower reattach snapshot cache cap from 32 to 8
- **File**: `src/web/components/terminal/TerminalSessionRegistry.ts:79`.
- **Change**: `REATTACH_SNAPSHOT_CACHE_HARD_CAP = 32` → `8`.
- **Rationale**: a single user has at most a few detached sessions
  at a time (typical 1-3, occasional 5). The 32-cap was sized for
  multi-tenant assumptions that don't apply here. Dropping to 8
  gives generous headroom and caps worst-case reattach memory
  growth at ~16 MiB (assuming worst-case 2 MiB snapshots, which
  themselves are not the case for typical sessions — see below).
- **Fallback path**: if users later report reattach eviction,
  raise the cap. The change is one line.
- **Risk**: very low; the cache is best-effort, eviction falls
  back to the server-side ring-buffer snapshot.
- **Why not also cap per-snapshot bytes?**: a `Buffer.byteLength`
  check at write time is "estimate and skip" logic that hides
  cost. If a single snapshot is huge, the right next step is to
  cap the ring buffer or split the serialize path, not to
  silently drop user state at the cache boundary.

### Tier 3 — Server-side output batching (deferred; needs measurement)

> Goal: reduce per-output `JSON.stringify` + `send` overhead on
> high-throughput PTYs. Not implemented yet — see "Preflight".

- **File**: `src/server/terminal/terminal-session-manager.ts:527-572`
  (listener registration) and `src/server/terminal/terminal-runtime.ts:55-70`
  (broadcast site).
- **Candidate change**: keep a per-session `pendingOutput: { data,
  seq }[]` and a `flushScheduled` microtask flag; flush as a single
  broadcast. `seq` monotonicity is preserved by reusing the highest
  seq in the batch; the client uses `seq` only for dedup
  boundaries, so dropped intermediate seqs are safe.
- **Bound the pendingOutput queue** (must be in any
  implementation): flush when
  - `pendingOutput.length >= MAX_OUTPUT_BATCH_EVENTS` (e.g.
    1000), **or**
  - sum of `data.length` across events
    `>= MAX_OUTPUT_BATCH_BYTES` (e.g. 1 MiB).

  Whichever hits first triggers a synchronous flush on the
  current microtask, not a deferred one. This prevents
  pathological memory growth if JS is busy between microtasks,
  and caps a single `JSON.stringify` payload at ~1.3 MiB (below
  the WebSocket frame cap). Without this bound the deferred
  status of this tier is unsound.
- **Risk profile**: safe IF implemented carefully (preserved order,
  preserved bytes, no panic between push and flush). Adds a
  microtask delay (ms-level) before output reaches the client; for
  a single user on a modest machine this saves 5-10% CPU on
  sustained high-rate PTY output.
- **Status**: **deferred**. The Preflight measurement below must
  show that server CPU is a real bottleneck for a single user
  before this work is justified. If Preflight shows
  no measurable savings, this tier is dropped entirely.

### Tier 4 — Observability (≤ 0.5 day, additive only)

> Goal: make the existing caps and buffers observable so future
> capacity decisions are based on data, not estimates.

#### T4.1 — Surface terminal buffer totals in `getDiagnostics()`
- **File**: `src/server/terminal/terminal-runtime.ts:102-110`
  (`getDiagnostics()`).
- **Change**: add fields for
  - total live session count,
  - total ring-buffer bytes (sum across live sessions),
  - max single-session ring buffer,
  - currently-reattach-cached snapshot count + bytes (from the
    renderer; requires a small bridge round-trip on demand only).
- **Risk**: 0 (additive; no behavior change).

### Tier 5 — Mobile / background-tab resilience (≤ 1 day)

> Goal: gracefully recover when the browser tab is backgrounded and
> resumed on mobile, where the OS may silently drop the WebSocket
> or kill the page entirely. Goal is to fail *open* — the user
> should never see a frozen terminal that won't recover.
>
> All items in this tier are **reactive, not aggressive**: we add
> hooks for the OS to tell us we just resumed, but we don't
> periodically poll, force-close, or pre-emptively reconcile.

#### T5.1 — `visibilitychange` + `pageshow` recovery hook
- **Files**:
  - `src/web/renderer-terminal-bridge.ts` (expose
    `kickReconnect()`),
  - `src/web/components/terminal/TerminalSessionProvider.tsx`
    (subscribe to `visibilitychange` / `pageshow`).
- **Change**:
  1. Bridge gains a `kickReconnect()` that **only** acts if
     the socket is in a non-OPEN state (`CONNECTING`,
     `CLOSING`, `CLOSED`); if the socket is already OPEN, the
     call is a no-op. The method does not actively probe or
     close a working socket.
  2. `TerminalSessionProvider` listens for
     `document.visibilitychange === 'visible'` and for
     `pageshow` with `event.persisted === true`. On either
     event: call `bridge.kickReconnect()`.
  3. **No** proactive `reconcileServerSessions` call. State
     updates flow through the existing server-push
     `sessions-changed` event after `scheduleReconnect`
     re-establishes the socket. A client-side reconcile would
     multiply round-trips on slow mobile networks and is a
     second source of truth for state the server already
     broadcasts.
- **Fallback paths**:
  - If `kickReconnect` is a no-op (socket is fine), nothing
    changes — no extra traffic, no extra reconnects.
  - If the bridge can't reach the server, the existing
    `scheduleReconnect` 300 ms backoff keeps retrying.
  - If the socket is OPEN but silently dead (rare, mobile NAT
    edge case), the user is not blocked — `output` events from
    the server resume on the next reconnect.
- **What this does NOT do**:
  - No periodic polling. No `setInterval`. No `setTimeout`
    chain outside the existing reconnect timer.
  - No force-close of a socket that's reporting OPEN.
  - No `freeze` / `resume` events (Chrome desktop only;
    overlap with `visibilitychange`).
  - No client-side state reconcile (see Change 3).
- **Risk**: low. The hook is a thin event-listener; the
  `kickReconnect` guard makes it a no-op on a healthy socket.

#### T5.2 — Persist scroll position on lifecycle events *(Phase 5+ optional)*
- **Status**: implement **only** if Phase 5 (T5.1) ships and
  users report scroll-position loss as a real friction point.
  This is a polish item, not a correctness fix. The server
  snapshot already covers content restoration.
- **Files**:
  - `src/web/components/terminal/TerminalSessionView.ts`
    (expose `getCurrentScrollLine()`; read on attach),
  - `src/web/components/terminal/ManagedTerminalSession.ts`
    (write on `detach`; clear on `handleExit`),
  - `src/web/components/terminal/TerminalSessionRegistry.ts`
    (clear on `discardLocalSessionAndDismissDetailIfLast`).
- **Change**: store
  `goblin:terminal-scroll:${sessionId} = <lineNumber>` in
  `sessionStorage`. On attach, restore in this exact order
  (each step awaits):
  ```ts
  await termWrite(term, serverSnapshot)        // 1. ingest replay
  const saved = readSavedScrollTop(sessionId)  // 2. read persisted
  if (saved !== null && saved <= term.buffer.active.length - 1) {
    await termScrollToLine(term, saved)        // 3. apply if valid
  }
  ```
  The `termWrite` / `termScrollToLine` wrappers follow the
  same callback-to-Promise pattern as `termWrite` in
  `ManagedTerminalSession.ts:628-632`.
- **Write triggers — sync only, lifecycle events only**:
  1. `ManagedTerminalSession.detach()` — existing lifecycle
     hook; write the current scroll line before the host is
     moved to the parking lot.
  2. `document.visibilitychange === 'hidden'` — new hook
     added in the same place as T5.1's bridge listener;
     iterates active sessions and calls each's
     `persistScrollTop()`.
- **No debounce. No scroll-event writes.** The latest scroll
  position is always in memory; persistence happens on
  lifecycle transition only. This satisfies the plan's
  "no async writes outside lifecycle hooks" rule
  unconditionally.
- **Explicit invalidation** (the rule this item used to
  violate):
  1. `ManagedTerminalSession.handleExit` →
     `sessionStorage.removeItem(key)`.
  2. `TerminalSessionRegistry.discardLocalSessionAndDismissDetailIfLast`
     → same.
  3. These are the *only* lifecycle points where the entry
     becomes unreachable from the renderer; clearing them is
     exact, not a best-effort scan. No entries accumulate.
- **Failure handling**:
  - `sessionStorage` write failure (quota, privacy mode) is
    caught and ignored — the resume falls back to the existing
    "scroll to bottom" behavior.
  - Stale value (saved line beyond current buffer) is skipped
    silently — the buffer's `scrollToBottom` remains the
    default. We do **not** clamp; we skip.
  - Cross-tab writes: last writer wins (i.e. last
    `visibilitychange:hidden` to fire). Acceptable for a single
    user; explicit cross-tab sync via the `storage` event is a
    future option, not required now.
- **Primitives (xterm 5.x)**:
  - `term.buffer.active.viewportY` is the canonical
    "current top line" reading.
  - `term.scrollToLine(line)` is async (returns Promise /
    accepts callback). Wrap consistently with `termWrite`.
  - Requires xterm.js ≥ 5.x. Verify in `package.json` before
    implementing.
- **Why this is safer than the previous draft**:
  - All writes are sync and in lifecycle hooks (matches the
    plan's "no async write outside lifecycle" rule).
  - All entries are removed when the session ends (matches
    the "explicit invalidation" rule).
  - No debounce timer means no cleanup complexity in
    `destroyTerminal()`.
  - No main-thread hitch during scroll events.

### Items rejected from the mobile resilience pass

- **Periodic WS ping (e.g. every 30s)** — pure overhead for
  a single-user app. The OS's TCP keepalive plus the
  `visibilitychange` hook together cover the recovery case.
  If a real "socket OPEN but dead" complaint surfaces, add
  an opt-in probe with a short (5s) timeout — not a
  recurring timer.
- **Native WebSocket ping/pong frames** — depends on
  `Hono`/`ws` server-side support, which is out of scope for
  this plan. Revisit only if the application-level probe
  proves insufficient.
- **Proactive `reconcileServerSessions` on visibility** —
  the server already broadcasts `sessions-changed`. After
  `kickReconnect` re-establishes the socket, missed events
  replay naturally. Adding a client-side reconcile would be
  a second source of truth and would multiply round-trips on
  slow mobile networks.
- **Persisting scrollback content in `sessionStorage`** —
  duplicates the server ring buffer. The 5-10 MB
  `sessionStorage` quota is a hard ceiling; the server
  already has 16 MiB. Two sources of truth for the same
  content is a correctness hazard.
- **iOS-specific hacks (e.g. silent audio for keepalive)** —
  out of scope and ethically questionable. The standard
  `visibilitychange` API is enough.
- **`freeze` / `resume` events** — Chrome desktop only;
  mobile Safari/Firefox use `visibilitychange`. Listening
  to both adds code with no extra coverage.

### Tier 6 — Refresh / boot UX (≤ 1 day)

> Goal: when the user hits F5 (or the page is killed on
> mobile), make the terminal tabs visible immediately with a
> clear "Loading..." state, instead of an empty tab strip
> during the `listSessions` round-trip. T6.1 covers the cold
> path (no cache), T6.2 covers the warm path (cache hit on
> subsequent refreshes).

#### T6.1 — Skeleton tab strip during `listSessions`
- **Files**:
  - `src/web/components/terminal/TerminalSessionProvider.tsx`
    (expose `isInitialSyncInFlight` derived state),
  - `src/web/components/terminal/TerminalTabs.tsx` (add
    `isLoading` prop, render skeleton when empty + loading).
- **Change**:
  1. `TerminalSessionProvider` tracks whether
     `syncServerSessions` has ever completed successfully
     since mount. Before the first completion, pass
     `isLoading: true` to `TerminalTabs`.
  2. `TerminalTabs`, when `sessions.length === 0`:
     - if `isLoading`: render 3 placeholder tab chips,
       each with a spinner inside (per the user's
       original request: "loading spinner is also OK").
       The exact animation is an implementation
       detail; the contract is "3 visible placeholders
       that disappear when the real tabs arrive".
     - else: render the existing single "+ New" button
       (current behavior).
  3. The `TerminalSlot` "Opening..." overlay already covers
     per-tab loading; this just extends the same idea to the
     tab strip level.
- **What this does NOT do**:
  - No new state beyond the `isInitialSyncInFlight` boolean.
  - No cache. No `sessionStorage` write. No new decision
    logic.
  - No change to when `listSessions` is called or how
    `reconcileServerSessions` runs.
- **Risk**: 0.

#### T6.2 — Persist last-known session list in `sessionStorage`
- **Files**:
  - `src/web/components/terminal/TerminalSessionRegistry.ts`
    (read in `syncServerSessions` start, write in
    `reconcileServerSessions` success),
  - `src/web/components/terminal/TerminalSessionProvider.tsx`
    (pass cached list into the initial render).
- **Cache contract** (must be respected exactly):
  - **Key**: `goblin:terminal-sessions:${worktreeTerminalKey}`
  - **Value**: JSON of
    `{ sessions: TerminalSessionSummary[], savedAt: <epochMs> }`
  - **Writer (single)**: `reconcileServerSessions` success
    path only. Every successful reconcile overwrites the
    key.
  - **Reader (single)**: Provider mount only. The cache
    is **not** read on subsequent `syncServerSessions`
    calls (window focus, sessions-changed events)
    because the registry already has live data in those
    cases — reading the cache would briefly override it
    and cause a "flash back to last session's tabs"
    regression. Implementation: read the cache inside
    `useState(() => readCachedSessionList(...))` at the
    top of `TerminalSessionProvider`, then never read it
    again.
  - **Invalidation**: implicit — the next reconcile
    overwrites the key. There is no other writer.
  - **Read-time guard (optional, recommended)**:
    on read, check `savedAt` against
    `Date.now() - MAX_CACHED_SESSION_AGE_MS` (e.g.
    10 minutes). If the cache is older, ignore it and
    fall back to T6.1's skeleton. This bounds the
    "phantom tab flash" window for the case where the
    user closes the browser and returns hours later
    — without it, the cache could be arbitrarily old.
    Without this guard, the `evictOrphanedLocalSessions`
    filter still removes stale entries correctly, but
    the user sees the flash for longer.
- **Stale handling**:
  - Cached entries the server has since closed are filtered
    by the existing `evictOrphanedLocalSessions` path
    (`TerminalSessionRegistry.ts:265-279`). The user sees
    a brief "Loading..." flash for closed sessions, then
    they disappear.
  - If the server is in a *totally* different state (e.g.,
    user switched databases), all cached tabs will be
    filtered. Worst case: 5-10 seconds of phantom tabs
    being filtered. For a single user this is annoying but
    not breaking. We accept the trade-off.
- **Failure handling**:
  - `sessionStorage` read failure (quota, privacy mode,
    malformed JSON, schema mismatch): caught and ignored —
    the UI falls back to T6.1's skeleton.
  - `sessionStorage` write failure: caught and ignored — the
    next session boots with the older cache (or no cache).
  - Cross-tab consistency: last writer wins. Acceptable for
    a single user; explicit cross-tab sync via the
    `storage` event is a future option, not required now.
- **Size**: each `TerminalSessionSummary` is ~200 bytes
  (key + title + processName). 10 sessions × 10 worktrees
  = 20 KB total across the sessionStorage. The 5-10 MB
  quota is not a constraint.
- **Why this is safe** (per the cache rules):
  - Explicit invalidation: every reconcile success
    overwrites the entry. No other writer.
  - Read-once: only on mount, only as a render hint, never
    as authoritative.
  - Stale values are filtered by the existing
    `evictOrphanedLocalSessions` path (already on the
    critical path).
  - No decision logic at write time (no "estimate and
    skip").
- **Risk**: low. Worst case is a brief flash of phantom
  tabs, never a correctness bug.

### Items rejected from the boot UX pass

- **Cache the per-session snapshot (server or reattach) for
  instant xterm content** — already covered by
  `reattachSnapshotCache` for in-session refresh; the
  cross-page-refresh case is served by T6.2's session list
  cache + the existing server ring buffer (which restores
  scrollback on attach). A separate per-session snapshot
  cache would duplicate that.
- **Stream session list to the client as soon as one
  session is known** — the server's `listSessions` is a
  single response; no streaming API exists. Adding one is
  a protocol change, out of scope.
- **Persist `displayOrder` separately** — folded into
  T6.2's `TerminalSessionSummary` payload. Splitting them
  would add a key per worktree for no benefit.
- **Use IndexedDB instead of sessionStorage** — overkill
  for ~2 KB per worktree; sessionStorage is synchronous
  and bounded for the use case.
- **Add a hard TTL to the cached session list** — false
  sense of safety. The cache is always overwritten by the
  next reconcile; a hard TTL would just produce more
  "expired" reads that the existing filter already
  handles. (The *optional* read-time guard in T6.2 is
  different: it's a soft age cap that just chooses
  between cache-vs-skeleton at read time, not an
  expiration that actively invalidates the entry.)

## 5. Preflight (do this first)

Before any Tier 2+ change, run a measurement pass to confirm the
problem is real and the proposed saving is correct.

1. **First-open latency**: instrument `openPhase` with
   `performance.now()` per stage; record median + p95 over 50 cold
   starts.
2. **`detach` serialize cost**: time `session.serialize()` in
   `TerminalSessionRegistry.detach` over 100 calls. If the median
   is < 5 ms, T-async-detach (which was already removed) is
   justified after all — revisit.
3. **output event rate**: log PTY output rate under a synthetic
   `yes | head -n 10000` workload, and the corresponding
   `JSON.stringify` + `send` CPU. If the rate exceeds 1000 events/s
   for an extended period, Tier 3 is justified.
4. **Ring buffer + reattach cache memory**: dump totals from a
   realistic session. Use these numbers to size T2.1's cap and to
   decide if the 16 MiB per-session buffer is appropriate.

If Tier 1 already reduces first-open by ≥ 50% (the plan's stated
target), no further work is justified.

## 6. Items removed

These were considered and explicitly cut under the safety-first
lens:

- **T-async-detach (T2.1 in earlier draft)** — replacing sync
  `serialize()` with `requestIdleCallback`. Removes the guarantee
  that a reattach finds the same scrollback/cursor state. Saves
  5-20 ms at the cost of a visible regression. For a single user
  the 5-20 ms is even less valuable (no contention). **Cut**.
- **T-preload-parallel (T2.2 in earlier draft)** — reordering
  `openPhase` to issue `attach` IPC in parallel with
  `preloadHydratedSnapshot`. The hydrated snapshot is empty in the
  common case (only filled by a prior detach in the same browser
  session), so the change is 0% helpful in the dominant path; the
  state-machine reshape is a real safety hit. **Cut**.
- **T-output-summary-merge (T2.4 in earlier draft)** — rAF-merging
  `outputSummary` notify calls. Viewer mode is a cold path; not
  justified for a single user. **Cut**.
- **T-shared-resize-observer (T3.1 in earlier draft)** — sharing a
  single `ResizeObserver` per host across multiple views. The
  benefit is one fewer frame of attach latency for multi-tab
  worktrees; the cost is a refcounted subscription lifecycle. For
  a single user the saving is invisible. **Cut**.
- **T-pty-input-chunking (T3.2 in earlier draft)** — capping the
  merged PTY input at 64 KiB. This is a Windows ConPTY-only
  concern; on Unix `node-pty` handles large writes natively. The
  `MAX_TERMINAL_WRITE_CHARS` cap (1 MiB) is already in place as a
  defense. **Cut**.
- **T-broadcast-fragmentation (T3.3 in earlier draft)** — splitting
  large `output` events into multiple WebSocket frames. The 1 MiB
  single-write cap already bounds the worst case; no measurements
  show this is a real bottleneck. **Cut**.
- **T-cold-lru (T3.4 in earlier draft)** — adding a session-count
  LRU on top of the 24 h TTL. This is a user-visible behavior
  change with an unvetted cap value (the proposed 64 × 16 MiB =
  1 GiB is itself an OOM risk). If memory becomes a concern, the
  right move is to lower the ring-buffer cap, not to evict user
  sessions. **Cut**.

## 7. Validation plan

For every change:

1. **Unit tests**: extend existing tests for touched code paths.
2. **Browser smoke**: open 4 worktrees, 3 tabs each; switch tabs
   rapidly; resize the window; observe no leaked listeners
   (DevTools → Memory → Heap snapshot delta).
3. **Latency check**: for T1.1, T1.2, T1.3, measure `openPhase`
   total time with `performance.now()` instrumentation; target
   ≥ 50% reduction in cold path. If not achieved, the change is
   wrong — revert.
4. **PTY stress test**: for any Tier 3+ work, run a synthetic
   `yes | head -n 100000` against an attached terminal; assert
   every byte reaches the client and no seq is reordered.

## 8. Rollout

| Phase | Items | Duration | Gate |
|---|---|---|---|
| Phase 1 (this PR or next) | T1.1, T1.2, T1.3, T1.4, **T1.5** | ≤ 1 day | run Preflight; ≥ 50% cold-start reduction |
| Phase 2 | T2.1 (cap 32 → 8) | ≤ 0.5 day | if reattach eviction complaints come in, revert |
| Phase 3 (deferred) | T3.1 (output batching) | 1-2 weeks | only if preflight shows server CPU bottleneck |
| Phase 4 | T4.1 (diagnostics) | ≤ 0.5 day | none |
| Phase 5 | T5.1 (visibility hook + kickReconnect) | ≤ 0.5 day | manual test on iOS Safari + Android Chrome; confirm no reconnect storms |
| Phase 5+ (optional) | T5.2 (scrollTop persistence) | ≤ 1 day | only if Phase 5 ships and users report scroll-position loss |
| Phase 6 | **T6.1 (skeleton tab strip), T6.2 (session list cache)** | ≤ 1 day | manual refresh test; confirm no flash of phantom tabs on cold cache, fast paint on warm cache |

Each phase lands as a separate PR with its own test pass and a
`docs/terminal-perf-plan.md` update.
