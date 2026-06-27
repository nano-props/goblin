/**
 * Unified orchestrator for the remote-repo lifecycle.
 *
 * Per docs/goblin-remote-repo-refactor-plan.md §6: every path that
 * starts, retries, or re-probes a remote repo's lifecycle must go
 * through this function. The previous design had three independent
 * entry points (hydrateRepoSession, ensureWorkspaceOpen, ad-hoc retry)
 * that each composed resolveTarget + probe + classification
 * themselves; the client ended up owning the entire lifecycle
 * state machine. Phase 3 lifts the resolveTarget + probe +
 * classification work to the server boundary, leaving the
 * orchestrator with a single server call to make and a single
 * terminal state to write.
 *
 * Responsibilities (§6.2):
 *   1. Mark the repo as `connecting` (preserving last-known target
 *      so the UI keeps showing the remote locator during re-probe).
 *   2. Call the server lifecycle boundary
 *      (`resolveRemoteRepoConnection` — see §5).
 *   3. Settle the lifecycle to `ready` or `failed`.
 *   4. On `ready`, trigger the initial repo data refresh.
 *   5. Guarantee no `connecting` ever stays in the store without
 *      an owner — aborts without a successor fall back to
 *      `failed { reason: 'unknown' }` (§6.5).
 *
 * Implementation: reuses `runLatestOperation` on the dedicated
 * `lifecycle` lane. The lane's signal is plumbed all the way to
 * the server boundary so a superseded run actually unblocks
 * instead of holding a TCP connection open until its own timeout.
 */
import {
  isRemoteRepoId,
  type RemoteRepoFailureReason,
  type RemoteRepoConnectionResult,
  type RemoteRepoTarget,
} from '#/shared/remote-repo.ts'
import {
  addResolvedRepo,
  addUnavailableRepo,
  type InitialRepoRefresh,
} from '#/web/stores/repos/repo-session-write-paths.ts'
import { markRemoteLifecycleConnecting } from '#/web/stores/repos/availability.ts'
import { runLatestOperation } from '#/web/stores/repos/operation-runner.ts'
import { runRepoRefreshIntent } from '#/web/stores/repos/refresh-coordinator.ts'
import type { ReposGet, ReposSet } from '#/web/stores/repos/types.ts'
import { resolveRemoteRepoConnection } from '#/web/remote-client.ts'

export interface RemoteRepoConnectionOutcome {
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
function toOutcome(result: RemoteRepoConnectionResult): RemoteRepoConnectionOutcome {
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
export async function runRemoteRepoConnection(
  set: ReposSet,
  get: ReposGet,
  repoId: string,
  options: { token?: number; signal?: AbortSignal } = {},
): Promise<RemoteRepoConnectionOutcome | null> {
  if (!isRemoteRepoId(repoId)) return null
  const token = options.token ?? get().repos[repoId]?.instanceToken
  if (!token) return null

  // Mark the repo as `connecting` BEFORE entering the lane so
  // observers see the projection change immediately.
  set((s) => {
    const repo = s.repos[repoId]
    if (!repo) return s
    if (repo.instanceToken !== token) return s
    if (repo.remote.lifecycle?.kind === 'connecting') return s
    const next = { ...repo, remote: { ...repo.remote } }
    markRemoteLifecycleConnecting(next)
    return { ...s, repos: { ...s.repos, [repoId]: next } }
  })

  const result = await runLatestOperation<RemoteRepoConnectionOutcome>({
    set,
    get,
    id: repoId,
    token,
    lane: 'lifecycle',
    priority: 50,
    targets: [{ key: 'lifecycle', reason: 'manual-refresh' as const }],
    task: async (signal) => {
      const composed = options.signal ? AbortSignal.any([signal, options.signal]) : signal
      const result = await resolveRemoteRepoConnection({ repoId }, composed)
      return toOutcome(result)
    },
    onResult: (outcome, ctx) => {
      if (!ctx.isCurrent()) return
      if (outcome.kind === 'ready' && outcome.target) {
        const refreshHolder: { value: InitialRepoRefresh | null } = { value: null }
        set((s) => {
          const result = addResolvedRepo(s, { id: outcome.repoId, name: outcome.name, target: outcome.target! })
          if (!result.changed) return s
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
      // a synthesized 'unknown' reason (§6.5). The server never
      // resolved a target (the task threw before completion), so
      // we degrade gracefully with no last-known target.
      set((s) => {
        return addUnavailableRepo(s, repoId, message || 'unknown', undefined)
      })
    },
    onStale: () => {
      // A newer lifecycle run has taken over. The newer run's
      // onResult / onError will write the state.
    },
  })
  return result
}
