/**
 * Unified orchestrator for the remote-repo lifecycle.
 *
 * Per docs/goblin-remote-repo-refactor-plan.md §6: every path that
 * starts, retries, or re-probes a remote repo's lifecycle must go
 * through this function. The previous design had three independent
 * entry points (hydrateSession, ensureWorkspaceOpen, ad-hoc retry)
 * that each composed resolveTarget + probe + classification
 * themselves; the renderer ended up owning the entire lifecycle
 * state machine. Phase 3 lifts the resolveTarget + probe +
 * classification work to the server boundary, leaving the
 * orchestrator with a single server call to make and a single
 * terminal state to write.
 *
 * Responsibilities (§6.2):
 *   1. Mark the repo as `connecting` (preserving last-known target
 *      so the UI keeps showing the remote locator during re-probe).
 *   2. Call the server lifecycle boundary
 *      (`resolveRemoteRepoLifecycle` — see §5).
 *   3. Settle the lifecycle to `ready` or `failed`.
 *   4. On `ready`, trigger the initial repo data refresh.
 *   5. Guarantee no `connecting` ever stays in the store without
 *      an owner — aborts without a successor fall back to
 *      `failed { reason: 'unknown' }` (§6.5).
 *
 * Implementation: reuses `runLatestOperation` on the dedicated
 * `lifecycle` lane. `operationKey: 'remoteLifecycle'` gives us
 * latest-wins across re-entrant calls. The lane's signal is
 * plumbed all the way to the server boundary so a superseded
 * run actually unblocks instead of holding a TCP connection
 * open until its own timeout.
 */
import { isRemoteRepoId, type RemoteRepoLifecycleResult, type RemoteRepoFailureReason, type RemoteRepoTarget } from '#/shared/remote-repo.ts'
import { addResolvedRepo, addUnavailableRepo, type InitialRepoRefresh } from '#/web/stores/repos/lifecycle-write-paths.ts'
import { markRemoteLifecycleConnecting } from '#/web/stores/repos/availability.ts'
import { runLatestOperation } from '#/web/stores/repos/operation-runner.ts'
import { runRepoRefreshIntent } from '#/web/stores/repos/refresh-coordinator.ts'
import type { ReposGet, ReposSet } from '#/web/stores/repos/types.ts'
import { resolveRemoteRepoLifecycle } from '#/web/remote-client.ts'

export interface RemoteLifecycleOutcome {
  kind: 'ready' | 'failed'
  reason?: RemoteRepoFailureReason
  repoId: string
  name: string
  target?: RemoteRepoTarget
}

/** Translate the server's converged result into the orchestrator's
 *  internal outcome shape. The two are nearly identical — the only
 *  difference is the orchestrator's optional `target` (server
 *  guarantees it on `ready`, optional on `failed`). */
function toOutcome(result: RemoteRepoLifecycleResult): RemoteLifecycleOutcome {
  if (result.kind === 'ready') {
    return {
      kind: 'ready',
      repoId: result.repoId,
      name: result.name,
      target: result.lifecycle.target,
    }
  }
  return {
    kind: 'failed',
    reason: result.lifecycle.reason,
    repoId: result.repoId,
    name: result.name,
    target: result.lifecycle.target,
  }
}

/**
 * Start (or join) a remote-repo lifecycle run. Safe to call from
 * any of: boot hydrate, user-initiated open, retry, and the
 * `useNetworkReconnect` hook.
 *
 * Returns a promise that resolves with the outcome (or `null` for
 * local ids and pre-conditions that don't reach the server). The
 * promise is *not* idempotent at the OS level — concurrent calls
 * share a single in-flight `runLatestOperation` so the latest
 * caller wins, but the user-facing outcome is delivered to
 * whichever call started the run.
 */
export async function runRemoteRepoLifecycle(
  set: ReposSet,
  get: ReposGet,
  repoId: string,
  options: { token?: number; signal?: AbortSignal } = {},
): Promise<RemoteLifecycleOutcome | null> {
  if (!isRemoteRepoId(repoId)) return null
  const token = options.token ?? get().repos[repoId]?.instanceToken
  if (!token) return null

  // Mark the repo as `connecting` BEFORE entering the lane so
  // observers see the projection change immediately. The lane's
  // abortController is owned by `runLatestOperation`; we hand the
  // resolved signal to the inner resolve step and rely on
  // `runLatestOperation` to drive the abort on supersede / dispose.
  const outerSignal = options.signal
  let outerAbortHandler: (() => void) | null = null
  const innerSignal = new AbortController()
  if (outerSignal) {
    if (outerSignal.aborted) innerSignal.abort(outerSignal.reason)
    else {
      outerAbortHandler = () => innerSignal.abort(outerSignal.reason)
      outerSignal.addEventListener('abort', outerAbortHandler, { once: true })
    }
  }

  try {
    set((s) => {
      const repo = s.repos[repoId]
      if (!repo) return s
      if (repo.instanceToken !== token) return s
      // Already in 'connecting'? No-op — the in-flight run owns
      // the writes. This is the idempotency layer the design calls
      // for: re-entrant calls don't double-mark the projection.
      if (repo.remote.lifecycle?.kind === 'connecting') return s
      // Zustand's middleware (immer) freezes the state tree, so a
      // shallow `{ ...repo }` isn't enough — `repo.remote` is
      // still the frozen reference. Re-clone the remote slice
      // so markRemoteLifecycleConnecting can mutate it freely.
      const next = { ...repo, remote: { ...repo.remote } }
      markRemoteLifecycleConnecting(next)
      return { ...s, repos: { ...s.repos, [repoId]: next } }
    })

    // Phase 5 fix: outer-scoped holder for the server-resolved
    // target. The task body writes to it on every settled
    // outcome (ready or failed-with-target). The `onError`
    // fallback uses it so an abort-without-successor preserves
    // the last-known `user@host` display context on the failed
    // tab — without this, the UI would lose the remote locator
    // the moment a `disposeRepoRuntime` raced the in-flight
    // HTTP work.
    let cachedTarget: RemoteRepoTarget | null = null

    const result = await runLatestOperation<RemoteLifecycleOutcome>({
      set,
      get,
      id: repoId,
      token,
      lane: 'lifecycle',
      operationKey: 'remoteLifecycle',
      priority: 50,
      targets: [{ key: 'remoteLifecycle', reason: 'remote-lifecycle' }],
      task: async (signal) => {
        // Compose the lane signal with the caller's outer signal
        // (boot/retry/useNetworkReconnect). Either aborting cancels
        // the in-flight HTTP work. The server boundary is a
        // single RPC; the server internally composes
        // resolveTarget + probe + classification (see §5.2) and
        // returns a converged result.
        const composed = AbortSignal.any
          ? AbortSignal.any([signal, innerSignal.signal])
          : composeSignals(signal, innerSignal.signal)
        const result = await resolveRemoteRepoLifecycle({ repoId }, composed)
        // Phase 5 fix: cache the server-resolved target so the
        // `onError` fallback (abort-without-successor) can
        // preserve the `user@host` display context. The server
        // includes `lifecycle.target` on both `ready` and
        // `failed`-with-target, so this is a safe over-fetch.
        cachedTarget = result.lifecycle.target ?? null
        return toOutcome(result)
      },
      onResult: (outcome, ctx) => {
        if (!ctx.isCurrent()) return
        if (outcome.kind === 'ready' && outcome.target) {
          const refreshHolder: { value: InitialRepoRefresh | null } = { value: null }
          set((s) => {
            const result = addResolvedRepo(s, { id: outcome.repoId, name: outcome.name, target: outcome.target! })
            if (!result.changed) return s
            // Promote the just-resolved repo into a refreshed
            // workspace. Mirrors the boot path's
            // refreshInitialRepoState — the user expects fresh
            // data after a successful lifecycle, not a stale
            // cached projection.
            const repo = result.repos[outcome.repoId]
            if (repo) refreshHolder.value = { id: repo.id, token: repo.instanceToken }
            return { ...s, repos: result.repos, order: result.order }
          })
          const pending = refreshHolder.value
          if (pending) {
            void runRepoRefreshIntent(get, {
              kind: 'core-data-changed',
              reason: 'initial-load',
              id: pending.id,
              token: pending.token,
            })
          }
        } else {
          set((s) => {
            return addUnavailableRepo(s, outcome.repoId, outcome.reason ?? 'unknown', outcome.target)
          })
        }
      },
      onError: (message, ctx) => {
        if (!ctx.isCurrent()) return
        // An abort without a successor falls back to `failed` with
        // a synthesized 'unknown' reason (per §6.5). The
        // server-resolved target, if any was cached before the
        // abort, is preserved on the failed tab so the user can
        // still see the remote locator. (cachedTarget is set by
        // the task body before the abort propagates; on a
        // before-resolve abort, it's null and we degrade to
        // 'no-target' which is the pre-Phase-5 behaviour.)
        set((s) => {
          return addUnavailableRepo(s, repoId, message || 'unknown', cachedTarget ?? undefined)
        })
        void ctx
      },
      onStale: () => {
        // A newer lifecycle run has taken over. The newer run's
        // onResult / onError will write the state — we MUST NOT
        // touch the lifecycle here, or we'll trample the new run.
      },
    })
    return result
  } finally {
    if (outerAbortHandler && outerSignal) outerSignal.removeEventListener('abort', outerAbortHandler)
  }
}

function composeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  if (a.aborted || b.aborted) {
    ctrl.abort((a.aborted ? a : b).reason)
  } else {
    a.addEventListener('abort', onAbort, { once: true })
    b.addEventListener('abort', onAbort, { once: true })
  }
  return ctrl.signal
}
