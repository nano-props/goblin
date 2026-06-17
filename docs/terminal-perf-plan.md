# Terminal Performance Optimization Plan

> Status: **shipped**. Owner: TBD. Last updated: 2026-06-17.
>
> **Project context.** Goblin is a single-user desktop terminal app.
> This plan is written under the constraint that **safety and
> reliability matter more than raw performance**, and **new caches are
> admitted only when they have a clear invalidation contract and a
> fallback path to the source of truth**. Several items in earlier
> drafts were cut for that reason — see "Items removed" at the bottom.

## 0. TL;DR

8 items shipped across Phases 1, 2, 4, 5, 6. T3.1 deferred; T5.2
and T6.2 explicitly out of scope (see "Items removed" for the
rationale on each).

| Phase | Items shipped                | Item count |
| ----- | ---------------------------- | ---------- |
| 1     | T1.1, T1.2, T1.3, T1.4, T1.5 | 5          |
| 2     | T2.1                         | 1          |
| 3     | (deferred)                   | 0          |
| 4     | T4.1                         | 1          |
| 5     | T5.1                         | 1          |
| 6     | T6.1                         | 1          |

The only real bug found in the audit: T1.5 (hydratedSnapshot was
never cleared after writing to xterm, leaking up to 16 MiB per
session for the page lifetime).

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
   5-await chain (the full `startAsync` adds 2 more for `ipcPhase`
   and `replayPhase`); the two biggest contributors are _unprewarmed
   font fetch_ and _lazy WebSocket attach_, with two `waitForTerminalLayout`
   barriers (2 rAF each) sitting between them.

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

| Mechanism                                                      | Location                                                         | Notes                                                                        |
| -------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 16 MiB ring buffer with `safeTail` boundary repair             | `src/server/terminal/terminal-render-state.ts:7-92`              | Theoretical edge case documented and accepted                                |
| Microtask-batched PTY input                                    | `src/server/terminal/terminal-session-manager.ts:597-614`        | Avoids write interleaving                                                    |
| Per-socket pause/resume counter                                | `src/server/terminal/buffered-terminal-socket.ts:50-60`          | Replay+live dedup on attach                                                  |
| 30 s request timeout, socket generation stale-check            | `src/web/renderer-terminal-bridge.ts:357-390`, `67-89`           | Prevents stuck requests                                                      |
| rAF-batched xterm output                                       | `src/web/components/terminal/ManagedTerminalSession.ts:525-544`  | One `term.write` per paint frame                                             |
| Microtask-batched resize                                       | `src/web/components/terminal/ManagedTerminalSession.ts:481-514`  | Coalesces resize storms                                                      |
| `waitForMeasurableHost` with AbortSignal, no hardcoded timeout | `src/web/components/terminal/terminal-session-geometry.ts:59-99` | Lands in #55; do not regress                                                 |
| 80 ms resize / font-load debounce                              | `src/web/components/terminal/terminal-session-view.ts:34-35`     | 5 frames, well-tuned                                                         |
| Reattach snapshot cache (cap 32, insertion-order LRU)          | `src/web/components/terminal/TerminalSessionRegistry.ts:79-636`  | Correctness is fine; the cap itself is over-sized for single-user (see T2.1) |
| `WorktreeTerminalSnapshot` lazy invalidation                   | `src/web/components/terminal/TerminalSessionRegistry.ts:561-566` | Worktree-keyed granular invalidation                                         |
| Connection-state TTL: 30 s grace + 24 h detached               | `src/server/terminal/terminal-connection-state.ts:30-53`         | Disconnect/reconnect with no orphans                                         |
| WeakMap-based socket metadata                                  | `src/server/terminal/terminal-realtime-broker.ts:17-20`          | GC-driven leak prevention                                                    |

## 4. Proposed changes

### Tier 1 — Quick wins (≤ 1 day, no new state)

> Goal: remove the two largest sources of first-open latency; cost
> is a few lines of glue. No new state, no new cache, no protocol
> change. All four items have **no fallback path** concerns because
> they don't introduce any new persistence.

#### T1.1 — Prewarm terminal font at app startup

- **File**: `src/web/components/terminal/TerminalSessionProvider.tsx`.
- **Change**: `useEffect` with empty deps calls `void preloadTerminalFont()`
  once on mount. The function is idempotent (`document.fonts.check`
  short-circuits on subsequent calls) and the function swallows
  its own errors.
- **Eliminates**: 100-500 ms first-open font fetch (only on the
  first cold start per session; subsequent opens hit the font
  cache).
- **Risk**: 0.

#### T1.2 — Prewarm WebSocket on worktree-pane mount

- **Files**: `src/web/renderer-terminal-bridge.ts` (add `prewarm()`),
  `src/web/components/branch-detail/BranchDetailToolbar.tsx`
  (call it on `[worktreeTerminalKey]`).
- **Change**: when a worktree pane mounts, call
  `terminalBridge.prewarm({ repoRoot })`. The bridge method resolves
  `waitForSocketOpen()` and resolves once the underlying WebSocket
  reaches the OPEN state. Idempotent (already-open socket resolves
  immediately) and best-effort (failures are swallowed; the next
  real IPC surfaces real errors).
- **Eliminates**: 100-500 ms first-attach WebSocket handshake when
  the socket was previously closed (e.g. on mobile after a tab
  suspend).
- **Risk**: 0.

#### T1.3 — Collapse the two `waitForTerminalLayout` calls in `openPhase`

- **File**:
  `src/web/components/terminal/ManagedTerminalSession.ts`.
- **Change**: keep the pre-`fitNow` rAF barrier (it gates
  `term.open` layout). Make the post-`fitNow` rAF barrier
  fire-and-forget (`void waitForTerminalLayout()`) — it settles
  the layout paint for later measurement, but the attach IPC
  doesn't need to block on it. `view.fitNow()` is synchronous so
  `term.cols`/`term.rows` are correct the moment `openPhase`
  returns, and the attach IPC reads them synchronously.
- **Eliminates**: 2 frames (~33 ms) from every attach.
- **Risk**: 0.

#### T1.4 — Document the cell-metrics cache invariant

- **File**: `src/web/components/terminal/terminal-geometry.ts`.
- **Change**: JSDoc on the `TERMINAL_FONT_FAMILY` / `_SIZE` /
  `_LINE_HEIGHT` constants and on the `cachedTerminalCellMetrics`
  field, explaining the invariant and the consequence of
  violating it (silently stale cell dimensions).
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

### Tier 3 — Server-side output batching (deferred)

Server-side microtask-bounded batching of `output` events would
save 5-10% CPU on sustained high-throughput PTYs by collapsing
many small `JSON.stringify` + `send` calls into one. **Not
implemented** — would only be worth doing if a real workload
shows server CPU as the bottleneck, which single-user desktop
usage is unlikely to trigger.

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
> or kill the page entirely. Goal is to fail _open_ — the user
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

- **T5.2 — Persist scroll position on lifecycle events** — would
  add a `sessionStorage` entry per session for a UX-polish item
  (restore scroll on reattach) that the server snapshot already
  implicitly covers. Caches of scroll position outside the source
  of truth violate the "explicit invalidation" rule, and the
  user-visible benefit is small. **Not implemented.**

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
    regression.
- **Architecture for the reader (must be `方案 A`)**:
  the cached list is consumed by pre-populating
  `registry.worktreeSnapshotCache` at registry
  construction. `TerminalTabs` continues to read via
  `useWorktreeTerminalSnapshot(worktreeKey)` → it sees
  the cached data without any prop drilling. The
  existing lazy-invalidation path (rebuild on
  `notifyWorktree`) handles the transition from cache to
  live data:
  ```ts
  // TerminalSessionRegistry.ts, in constructor
  // NOTE: this loop MUST run before the first setRepoIndex() call.
  // setRepoIndex() → syncDescriptorsFromRepoIndex() → notifyWorktree()
  // deletes cache entries (TerminalSessionRegistry.ts:562), so any
  // pre-population done after that point is immediately wiped.
  for (const [worktreeKey, cached] of readAllCachedSessionLists()) {
    this.worktreeSnapshotCache.set(worktreeKey, {
      worktreeTerminalKey: worktreeKey,
      selectedDescriptor: null, // filled by reconcile
      sessions: cached.sessions,
      count: cached.sessions.length,
      pendingCreate: false,
    })
  }
  ```
  This reuses the existing `worktreeSnapshotCache` as
  the in-memory layer between the persisted cache and
  the React components. No new prop, no new state hook
  in the Provider, no architectural surface area added.
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
  - If the server is in a _totally_ different state (e.g.,
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

- **T6.2 — Persist last-known session list in `sessionStorage`** —
  would add a real cache (read on mount, write on reconcile) for
  a UX polish item (avoid ~2-3 s of "empty tab strip" on F5).
  The cache violates the "explicit invalidation" rule (server
  already broadcasts `sessions-changed`; the cache has its own
  phantom-tab flash hazards that the server doesn't) and adds a
  second source of truth for the same data. **Not implemented.**

## 5. Items removed

These were considered and explicitly cut:

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
  `outputSummary` notify calls in
  `ManagedTerminalSession.scheduleSummaryNotify`. Viewer mode
  (non-controller) is a cold path for a single user; the rAF
  merge would add a microtask/rAF scheduling state for a
  ~5-10% re-render saving that the user is unlikely to notice.
  If viewer mode ever becomes hot (e.g., a collaboration feature
  is added that has many viewers per session), revisit with
  measurement. **Cut**.
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
3. **PTY stress test**: for any Tier 3+ work, run a synthetic
   `yes | head -n 100000` against an attached terminal; assert
   every byte reaches the client and no seq is reordered.

## 8. Rollout

Each phase landed as a separate commit with its own test pass
and a `docs/terminal-perf-plan.md` update.

| Phase | Items shipped                | Note                                           |
| ----- | ---------------------------- | ---------------------------------------------- |
| 1     | T1.1, T1.2, T1.3, T1.4, T1.5 | shipped                                        |
| 2     | T2.1                         | shipped; revert if eviction complaints come in |
| 3     | —                            | deferred (T3.1)                                |
| 4     | T4.1                         | shipped                                        |
| 5     | T5.1                         | shipped                                        |
| 6     | T6.1                         | shipped                                        |

Not implemented: T3.1 (deferred), T5.2 (UX polish, no real
benefit), T6.2 (real cache that violates the safety policy).
