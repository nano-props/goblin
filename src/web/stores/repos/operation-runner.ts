import {
  markRepoOperationTargets,
  nextRepoOperationId,
  repoOperationBusy,
  repoOperationCurrent,
  scheduleRepoOperation,
  settleRepoOperationTargets,
  type RepoOperationLane,
} from '#/web/stores/repos/repo-operation-scheduler.ts'
import { isExpectedRepoOperationCancellation } from '#/web/stores/repos/operation-cancellation.ts'
import { updateIfFresh } from '#/web/stores/repos/repo-guards.ts'
import {
  markRepoOperationViews,
  settleRepoOperationViews,
  type RepoOperationTarget,
} from '#/web/stores/repos/operations.ts'
import type { RepoState, ReposGet, ReposSet } from '#/web/stores/repos/types.ts'
export type { RepoOperationTarget }

interface RepoOperationContext {
  id: string
  repoRuntimeId: string
  operationId: number
  isCurrent: () => boolean
  setPhase: (phase: 'queued' | 'running') => void
}

interface RepoOperationBaseOptions<T> {
  set: ReposSet
  get: ReposGet
  id: string
  repoRuntimeId?: string
  lane: RepoOperationLane
  priority: number
  targets: [RepoOperationTarget, ...RepoOperationTarget[]]
  task: (signal: AbortSignal, ctx: RepoOperationContext) => Promise<T>
  operationKey?: string
  queuedTimeoutMs?: number
  queuedTimeoutMessage?: string
  errorFromResult?: (result: T) => string | null
  errorResult?: (message: string) => T
  onResult?: (result: T, ctx: RepoOperationContext) => void | Promise<void>
  onError?: (message: string, ctx: RepoOperationContext) => void | Promise<void>
  onStale?: (ctx: RepoOperationContext) => void | Promise<void>
  rethrow?: boolean
}

type RunLatestOperationOptions<T> = RepoOperationBaseOptions<T>

interface RunExclusiveOperationOptions<T> extends RepoOperationBaseOptions<T> {
  canStart?: (repo: RepoState) => boolean
  busyResult?: T
}

type InternalRepoOperationOptions<T> =
  | (RunLatestOperationOptions<T> & { policy: 'latest-wins' })
  | (RunExclusiveOperationOptions<T> & { policy: 'exclusive' })

function operationCurrent(
  get: ReposGet,
  id: string,
  repoRuntimeId: string,
  operationId: number,
  target: RepoOperationTarget,
) {
  const repo = get().repos[id]
  return !!repo && repo.repoRuntimeId === repoRuntimeId && repoOperationCurrent(id, target.key, operationId)
}

function anyTargetBusy(id: string, targets: RepoOperationTarget[]) {
  return targets.some((target) => repoOperationBusy(id, target.key))
}

function markOperationState<T>(
  options: InternalRepoOperationOptions<T>,
  repoRuntimeId: string,
  operationId: number,
  phase: 'queued' | 'running',
  wasQueued = false,
) {
  markRepoOperationTargets(options.id, operationId, options.targets, phase, wasQueued)
  updateIfFresh(options.set, options.id, repoRuntimeId, (repo) => {
    markRepoOperationViews(repo.operations, operationId, options.targets, phase, wasQueued)
  })
}

function settleOperationState<T>(
  options: InternalRepoOperationOptions<T>,
  repoRuntimeId: string,
  operationId: number,
  error: string | null,
) {
  settleRepoOperationTargets(options.id, operationId, options.targets, error)
  updateIfFresh(options.set, options.id, repoRuntimeId, (repo) => {
    settleRepoOperationViews(repo.operations, operationId, options.targets, error)
  })
}

async function runRepoOperation<T>(options: InternalRepoOperationOptions<T>): Promise<T | null> {
  const repoBefore = options.get().repos[options.id]
  if (!repoBefore) return null
  const repoRuntimeId = options.repoRuntimeId ?? repoBefore.repoRuntimeId
  if (repoBefore.repoRuntimeId !== repoRuntimeId) return null
  const primary = options.targets[0]
  if (options.policy !== 'latest-wins') {
    const busy = anyTargetBusy(options.id, options.targets)
    if (busy || (options.canStart && !options.canStart(repoBefore))) return options.busyResult ?? null
  }

  const operationId = nextRepoOperationId(options.id)
  const ctx: RepoOperationContext = {
    id: options.id,
    repoRuntimeId,
    operationId,
    isCurrent: () => operationCurrent(options.get, options.id, repoRuntimeId, operationId, primary),
    setPhase: (phase) => {
      if (ctx.isCurrent()) markOperationState(options, repoRuntimeId, operationId, phase)
    },
  }

  // Run the core task first so follow-up side effects cannot alter the outcome.
  type Outcome =
    | { kind: 'stale' }
    | { kind: 'error'; error: string; original: unknown }
    | { kind: 'success'; result: T; error: string | null }

  let outcome: Outcome
  try {
    const result = await scheduleRepoOperation(options.id, options.lane, (signal) => options.task(signal, ctx), {
      priority: options.priority,
      replaceQueuedKey:
        options.policy === 'latest-wins' ? `${options.lane}:${options.operationKey ?? primary.key}` : undefined,
      queuedTimeoutMs: options.queuedTimeoutMs,
      queuedTimeoutMessage: options.queuedTimeoutMessage,
      onQueued: () => markOperationState(options, repoRuntimeId, operationId, 'queued'),
      onStart: (wasQueued) => markOperationState(options, repoRuntimeId, operationId, 'running', wasQueued),
    })
    if (!ctx.isCurrent()) {
      outcome = { kind: 'stale' }
    } else {
      outcome = { kind: 'success', result, error: options.errorFromResult?.(result) ?? null }
    }
  } catch (err) {
    outcome = isExpectedRepoOperationCancellation(err)
      ? { kind: 'stale' }
      : { kind: 'error', error: err instanceof Error ? err.message : String(err), original: err }
  }

  // Settle operation state exactly once before running side effects.
  const settleError = outcome.kind === 'success' ? outcome.error : outcome.kind === 'error' ? outcome.error : null
  settleOperationState(options, repoRuntimeId, operationId, settleError)

  if (outcome.kind === 'stale') {
    await options.onStale?.(ctx)
    return null
  }

  if (outcome.kind === 'error') {
    if (ctx.isCurrent()) {
      await options.onError?.(outcome.error, ctx)
      if (options.rethrow) throw outcome.original
      return options.errorResult?.(outcome.error) ?? null
    }
    await options.onStale?.(ctx)
    if (options.rethrow) throw outcome.original
    return null
  }

  await options.onResult?.(outcome.result, ctx)
  return outcome.result
}

export function runLatestOperation<T>(options: RepoOperationBaseOptions<T>): Promise<T | null> {
  return runRepoOperation({ ...options, policy: 'latest-wins' })
}

export function runExclusiveOperation<T>(options: RunExclusiveOperationOptions<T>): Promise<T | null> {
  return runRepoOperation({ ...options, policy: 'exclusive' })
}
