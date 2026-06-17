# Terminal Performance Optimization Plan

> Status: **proposed — draft PR**. Owner: TBD. Last updated: 2026-06-17.

## 1. Background

Two inputs drive this plan:

1. **Audit of existing cache & performance mechanisms** in the in-memory
   terminal module (`src/server/terminal/`, `src/web/components/terminal/`,
   `src/web/renderer-terminal-bridge.ts`). The audit found that the existing
   mechanisms are largely sound — every layer has a clear invalidation
   contract and cleanup path — but a handful of hot paths and lifecycle edges
   are missing cheap wins or carry uncontrolled growth.

2. **First-open latency diagnosis**: opening a terminal tab for the first
   time in a session takes noticeably longer than subsequent opens. The
   orchestrator (`ManagedTerminalSession.openPhase`) is a 7-await chain; the
   two biggest contributors are *unprewarmed font fetch* and *lazy WebSocket
   attach*, with a fixed-cost 4-frame `waitForTerminalLayout` between them.

This document merges both inputs into a single tiered plan.

## 2. Existing mechanisms (kept as-is)

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
| Reattach snapshot cache (32 cap, insertion-order LRU) | `src/web/components/terminal/TerminalSessionRegistry.ts:79-636` | Clean eviction |
| `WorktreeTerminalSnapshot` lazy invalidation | `src/web/components/terminal/TerminalSessionRegistry.ts:561-566` | Worktree-keyed granular invalidation |
| Connection-state TTL: 30 s grace + 24 h detached | `src/server/terminal/terminal-connection-state.ts:30-53` | Disconnect/reconnect with no orphans |
| WeakMap-based socket metadata | `src/server/terminal/terminal-realtime-broker.ts:17-20` | GC-driven leak prevention |

## 3. Proposed changes

### Tier 1 — Quick wins (≤ 1 day, near-zero risk)

> Goal: remove the two largest sources of first-open latency; cost is a few
> lines of glue, no protocol change, no new tests beyond the existing suite.

#### T1.1 — Prewarm terminal font at app startup
- **File**: `src/web/components/terminal/terminal-geometry.ts:20-28`,
  call site in `src/web/components/terminal/TerminalSessionProvider.tsx` (or
  whatever bootstraps the terminal subsystem).
- **Change**: `void preloadTerminalFont()` once at provider mount. The
  function is idempotent (`document.fonts.check` short-circuits on
  subsequent calls), so double-invocation is harmless.
- **Eliminates**: 100-500 ms first-open font fetch.
- **Risk**: 0.

#### T1.2 — Prewarm WebSocket on terminal route enter
- **File**: `src/web/renderer-terminal-bridge.ts` (add `prewarm()`), call
  site in the route/tab switcher.
- **Change**: when the user focuses or hovers a terminal tab, fire a
  `terminalBridge.listSessions({ repoRoot })` (or new `prewarm()`). This
  triggers `ensureSocket` and pays DNS+TCP+TLS+WS before the user actually
  clicks.
- **Eliminates**: 100-500 ms first-open attach handshake.
- **Risk**: 0 (no new protocol; `listSessions` is already on the wire).
- **Caveat**: only fire on user intent, not on every route render. Use
  `onPointerEnter` or route-active detection.

#### T1.3 — Collapse the two `waitForTerminalLayout` calls in `openPhase`
- **File**: `src/web/components/terminal/ManagedTerminalSession.ts:351-357`
  and `:624-626`.
- **Change**: keep the pre-`fitNow` rAF barrier (it gates `term.open`
  layout), fire the post-`fitNow` rAF barrier as a `Promise` that runs in
  parallel with the subsequent `terminalBridge.attach`. The fit-then-wait
  dependency is already encoded by the `fitNow` mutation; we just don't
  need to *block* on the second wait.
- **Eliminates**: 2 frames (~33 ms) from every attach.
- **Risk**: 0 (purely a control-flow reshape; `waitForTerminalLayout` is
  pure).

#### T1.4 — Document the cell-metrics cache invariant
- **File**: `src/web/components/terminal/terminal-geometry.ts:18-67`.
- **Change**: add a JSDoc note that `cachedTerminalCellMetrics` is
  process-wide and assumes `TERMINAL_FONT_FAMILY` / `TERMINAL_FONT_SIZE`
  are constant for the page lifetime. Export a test-only
  `__resetCachedTerminalCellMetricsForTest` to make this testable.
- **Eliminates**: future footgun.
- **Risk**: 0.

### Tier 2 — Medium effort, low risk (1-3 days each)

> Goal: smooth out lifecycle spikes and per-output overhead. All changes
> preserve current wire semantics; expect to add a small amount of test
> coverage per item.

#### T2.1 — Async `detach` serialization via `requestIdleCallback`
- **File**: `src/web/components/terminal/TerminalSessionRegistry.ts:472-482`.
- **Change**: serialize on idle, not on the click handler. If an attach
  arrives before the idle fires, the server-side snapshot path already
  covers the gap (`terminal-session-projection.ts:67-83`, `isReattachMatch`
  requires `sessionId` match, so missing cache falls back to server
  snapshot).
- **Eliminates**: 0-30 ms main-thread spike on tab switch.
- **Risk**: low; needs a sync fallback path for the "attach before idle"
  race.

#### T2.2 — Run `preloadHydratedSnapshot` concurrent with `attach` IPC
- **File**: `src/web/components/terminal/ManagedTerminalSession.ts:315-359`.
- **Change**: kick off `terminalBridge.attach` first, then write the
  hydrated snapshot to the term as it resolves. The replay window
  (`beginReplay` / `finishReplay` in
  `src/web/components/terminal/terminal-session-state.ts:186-203`) was
  designed for exactly this — preload + post-attach filtered by boundary.
- **Eliminates**: `term.write(hydrated)` blocking the IPC roundtrip.
- **Risk**: medium; needs a regression test that a preloaded snapshot
  followed by server `output` events is written in correct order.

#### T2.3 — Server-side `output` broadcast microtask batch
- **File**: `src/server/terminal/terminal-session-manager.ts:527-572`
  (listener registration) and `src/server/terminal/terminal-runtime.ts:55-70`
  (broadcast site).
- **Change**: keep a per-session `pendingOutput: { data, seq }[]` and a
  `flushScheduled` microtask flag; flush as a single broadcast. The `seq`
  monotonicity is preserved by reusing the highest seq in the batch; the
  client uses `seq` only for dedup boundaries, so dropped intermediate
  seqs are safe.
- **Eliminates**: O(n) `JSON.stringify` + `send` on PTY bursts (`cat` on
  a large file, `npm install` output, etc.).
- **Risk**: medium; add a stress test that simulates a high-rate PTY and
  asserts the client receives all bytes in order.

#### T2.4 — Merge `outputSummary` notifications
- **File**: `src/web/components/terminal/ManagedTerminalSession.ts:211,
  :563-565` and the viewer-only path in
  `src/web/components/terminal/terminal-session-state.ts:233-274`.
- **Change**: schedule the `outputSummary` notify via `requestAnimationFrame`
  so multiple `appendOutput` calls in the same frame produce a single
  `useSyncExternalStore` snapshot update.
- **Eliminates**: re-render fan-out on every output chunk in viewer mode.
- **Risk**: low; only affects viewer mode (where this currently matters).

#### T2.5 — Bound the reattach snapshot size
- **File**: `src/web/components/terminal/TerminalSessionRegistry.ts:628-636`
  and `src/web/components/terminal/terminal-session-view.ts:190-192`.
- **Change**: estimate the serialized size (`Buffer.byteLength(snapshot)`)
  before caching. If it exceeds a soft cap (e.g. 1 MiB), fall back to
  truncating via the serialize addon or skip the cache and rely on the
  server snapshot.
- **Eliminates**: worst-case 32×N MiB memory in the reattach cache.
- **Risk**: low; the cache is best-effort by design.

### Tier 3 — Larger refactors (3-7 days, design review)

> Goal: structural improvements. Each item touches a hot path or a
> lifecycle edge; they need a design review and a test plan before
> implementation.

#### T3.1 — Shared `ResizeObserver` per host
- **File**: `src/web/components/terminal/terminal-session-view.ts:355-359`,
  with shared state in `TerminalSessionRegistry` or a new
  `TerminalGeometryObserver` module.
- **Change**: one RO per host, fan out to subscribed views. Last unsubscriber
  disconnects.
- **Eliminates**: N observers per multi-tab worktree; one fewer frame of
  latency on attach for tabs 2..N.
- **Risk**: medium; lifecycle of the shared observer is subtle (e.g. RO
  fires on size change, not on initial measure — need to keep the
  synchronous first-measure path).

#### T3.2 — PTY input chunking
- **File**: `src/server/terminal/terminal-session-manager.ts:597-614`.
- **Change**: cap the merged batch at e.g. 64 KiB and write in a loop
  inside one microtask flush, so a single long-paused-then-bursty input
  (e.g. 1 MB paste) doesn't become a single oversized `pty.write`.
- **Eliminates**: `node-pty` / IPC frame-size edge cases and head-of-line
  blocking for later writes.
- **Risk**: medium; order must be preserved across chunks (loop in
  sequence, not microtask-deferred).

#### T3.3 — Bound server `output` broadcast payload size
- **File**: `src/server/terminal/terminal-realtime-broker.ts:57-67`.
- **Change**: when `JSON.stringify(message).byteLength` exceeds a cap
  (e.g. 256 KiB), fragment into multiple `output` events with a shared
  fragment id, and reassemble on the client. Alternatively, switch
  terminal output to a binary WebSocket frame.
- **Eliminates**: silent truncation / WS frame-size errors on a single
  16 MiB chunk.
- **Risk**: high; needs wire-protocol negotiation with the client. Worth
  a separate RFC.

#### T3.4 — Cold-session LRU eviction
- **File**: `src/server/terminal/terminal-connection-state.ts:43-53` and
  `src/server/terminal/terminal-session-manager.ts:331-333`.
- **Change**: keep the 24 h TTL but add a soft cap on total detached
  sessions (e.g. 64 across all clients). When the cap is exceeded, evict
  the oldest detached session; PTY is killed, ring buffer freed.
- **Eliminates**: unbounded memory growth in long-running Goblin
  instances with many ephemeral sessions.
- **Risk**: high; user-visible behavior change. Must be opt-in or
  surfaced in `getDiagnostics()`.

## 4. Out of scope (intentionally not done)

These were considered and rejected:

- **Cell-metrics reactive invalidation on theme change** — no current
  trigger; introduces complexity for no user-visible win.
- **LZ4 compression of the 16 MiB ring buffer** — the buffer is bounded
  and small; CPU cost dominates any memory win.
- **Rewriting xterm addon loading order** — xterm's `loadAddon` is
  synchronous; no parallel-loading API.
- **Binary WebSocket framing for output** — large undertaking, deferred
  to T3.3 or a separate protocol PR.

## 5. Validation plan

For every Tier 1 / 2 change:

1. **Unit tests**: extend the existing `terminal-render-state.test.ts`,
   `terminal-realtime-broker.test.ts`, and any new module-level tests
   for the touched code.
2. **Browser smoke**: open 4 worktrees, 3 tabs each; switch tabs
   rapidly; resize the window; observe no leaked listeners (DevTools
   → Memory → Heap snapshot delta).
3. **Latency check**: for T1.1, T1.2, T1.3, measure `openPhase` total
   time with `performance.now()` instrumentation behind a debug flag
   (already exists in `terminalLog`); target ≥ 50 % reduction in cold
   path.
4. **PTY stress test**: for T2.3, T3.2, run a synthetic
   `yes | head -n 100000` against an attached terminal; assert
   every byte reaches the client and no seq is reordered.

For Tier 3 items: a separate RFC in `docs/` before implementation
begins.

## 6. Rollout

| Phase | Items | Duration |
|---|---|---|
| Phase 1 (this PR) | T1.1, T1.2, T1.3, T1.4 | ≤ 1 day |
| Phase 2 (next) | T2.1, T2.4, T2.5 | 1 week |
| Phase 3 (this month) | T2.2, T2.3 | 1-2 weeks |
| Phase 4 (design review) | T3.1, T3.2, T3.3, T3.4 | scoped per RFC |

Each phase lands as a separate PR with its own test pass and a
`docs/terminal-perf-plan.md` update.
