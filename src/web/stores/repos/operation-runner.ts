import {
  markRepoOperationTargets,
  nextRepoOperationId,
  repoOperationBusy,
  repoOperationCurrent,
  scheduleRepoTask,
  settleRepoOperationTargets,
  type RepoTaskLane,
} from '#/web/stores/repos/runtime.ts'
import { updateIfFresh } from '#/web/stores/repos/helpers.ts'
import {
  markRepoOperationViews,
  settleRepoOperationViews,
  type RepoOperationTarget,
} from '#/web/stores/repos/operations.ts'
import type { RepoState, ReposGet, ReposSet } from '#/web/stores/repos/types.ts'
export type { RepoOperationTarget }

interface RepoOperationContext {
  id: string
  token: number
  operationId: number
  isCurrent: () => boolean
  setPhase: (phase: 'queued' | 'running') => void
}

interface RepoOperationBaseOptions<T> {
  set: ReposSet
  get: ReposGet
  id: string
  token?: number
  lane: RepoTaskLane
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

function operationCurrent(get: ReposGet, id: string, token: number, operationId: number, target: RepoOperationTarget) {
  const repo = get().repos[id]
  return !!repo && repo.instanceToken === token && repoOperationCurrent(id, target.key, operationId)
}

function anyTargetBusy(id: string, targets: RepoOperationTarget[]) {
  return targets.some((target) => repoOperationBusy(id, target.key))
}

function markOperationState<T>(
  options: InternalRepoOperationOptions<T>,
  token: number,
  operationId: number,
  phase: 'queued' | 'running',
  wasQueued = false,
) {
  markRepoOperationTargets(options.id, operationId, options.targets, phase, wasQueued)
  updateIfFresh(options.set, options.id, token, (repo) => {
    markRepoOperationViews(repo.operations, operationId, options.targets, phase, wasQueued)
  })
}

function settleOperationState<T>(
  options: InternalRepoOperationOptions<T>,
  token: number,
  operationId: number,
  error: string | null,
) {
  settleRepoOperationTargets(options.id, operationId, options.targets, error)
  updateIfFresh(options.set, options.id, token, (repo) => {
    settleRepoOperationViews(repo.operations, operationId, options.targets, error)
  })
}

async function runRepoOperation<T>(options: InternalRepoOperationOptions<T>): Promise<T | null> {
  const repoBefore = options.get().repos[options.id]
  if (!repoBefore) return null
  const token = options.token ?? repoBefore.instanceToken
  if (repoBefore.instanceToken !== token) return null
  const primary = options.targets[0]
  if (options.policy !== 'latest-wins') {
    const busy = anyTargetBusy(options.id, options.targets)
    if (busy || (options.canStart && !options.canStart(repoBefore))) return options.busyResult ?? null
  }

  const operationId = nextRepoOperationId(options.id)
  const ctx: RepoOperationContext = {
    id: options.id,
    token,
    operationId,
    isCurrent: () => operationCurrent(options.get, options.id, token, operationId, primary),
    setPhase: (phase) => {
      if (ctx.isCurrent()) markOperationState(options, token, operationId, phase)
    },
  }
  let error: string | null = null
  let staleHandled = false
  async function handleStale() {
    if (staleHandled) return
    staleHandled = true
    await options.onStale?.(ctx)
  }
  try {
    const result = await scheduleRepoTask(options.id, options.lane, (signal) => options.task(signal, ctx), {
      priority: options.priority,
      replaceQueuedKey:
        options.policy === 'latest-wins' ? `${options.lane}:${options.operationKey ?? primary.key}` : undefined,
      queuedTimeoutMs: options.queuedTimeoutMs,
      queuedTimeoutMessage: options.queuedTimeoutMessage,
      onQueued: () => markOperationState(options, token, operationId, 'queued'),
      onStart: (wasQueued) => markOperationState(options, token, operationId, 'running', wasQueued),
    })
    if (!ctx.isCurrent()) {
      settleOperationState(options, token, operationId, null)
      await handleStale()
      return null
    }
    error = options.errorFromResult?.(result) ?? null
    settleOperationState(options, token, operationId, error)
    await options.onResult?.(result, ctx)
    return result
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
    settleOperationState(options, token, operationId, error)
    if (ctx.isCurrent()) {
      await options.onError?.(error, ctx)
      if (options.rethrow) throw err
      return options.errorResult?.(error) ?? null
    }
    await handleStale()
    if (options.rethrow) throw err
    return null
  }
}

export function runLatestOperation<T>(options: RepoOperationBaseOptions<T>): Promise<T | null> {
  return runRepoOperation({ ...options, policy: 'latest-wins' })
}

export function runExclusiveOperation<T>(options: RunExclusiveOperationOptions<T>): Promise<T | null> {
  return runRepoOperation({ ...options, policy: 'exclusive' })
}
