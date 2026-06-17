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
| Phase 1 (this PR or next) | T1.1, T1.2, T1.3, T1.4 | ≤ 1 day | run Preflight; ≥ 50% cold-start reduction |
| Phase 2 | T2.1 (cap 32 → 8) | ≤ 0.5 day | if reattach eviction complaints come in, revert |
| Phase 3 (deferred) | T3.1 (output batching) | 1-2 weeks | only if preflight shows server CPU bottleneck |
| Phase 4 | T4.1 (diagnostics) | ≤ 0.5 day | none |

Each phase lands as a separate PR with its own test pass and a
`docs/terminal-perf-plan.md` update.
