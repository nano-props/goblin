import {
  markRepoOperationTargets,
  nextRepoOperationId,
  repoOperationBusy,
  repoOperationCurrent,
  scheduleRepoTask,
  settleRepoOperationTargets,
  type RepoRuntimeOperationTarget,
  type RepoTaskLane,
} from '#/renderer/stores/repos/runtime.ts'
import type { RepoState, ReposGet } from '#/renderer/stores/repos/types.ts'

export type RepoOperationTarget = RepoRuntimeOperationTarget

interface RepoOperationContext {
  id: string
  token: number
  requestId: number
  isCurrent: () => boolean
}

interface RepoOperationBaseOptions<T> {
  get: ReposGet
  id: string
  token?: number
  lane: RepoTaskLane
  priority: number
  targets: [RepoOperationTarget, ...RepoOperationTarget[]]
  task: (signal: AbortSignal) => Promise<T>
  operationKey?: string
  errorFromResult?: (result: T) => string | null
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

function operationCurrent(get: ReposGet, id: string, token: number, requestId: number, target: RepoOperationTarget) {
  const repo = get().repos[id]
  return !!repo && repo.instanceToken === token && repoOperationCurrent(id, target.key, requestId)
}

function anyTargetBusy(id: string, targets: RepoOperationTarget[]) {
  return targets.some((target) => repoOperationBusy(id, target.key))
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

  const requestId = nextRepoOperationId(options.id)
  const ctx: RepoOperationContext = {
    id: options.id,
    token,
    requestId,
    isCurrent: () => operationCurrent(options.get, options.id, token, requestId, primary),
  }
  let error: string | null = null
  let staleHandled = false
  async function handleStale() {
    if (staleHandled) return
    staleHandled = true
    await options.onStale?.(ctx)
  }
  try {
    const result = await scheduleRepoTask(options.id, options.lane, options.task, {
      priority: options.priority,
      replaceQueuedKey:
        options.policy === 'latest-wins' ? `${options.lane}:${options.operationKey ?? primary.key}` : undefined,
      onQueued: () => markRepoOperationTargets(options.id, requestId, options.targets, 'queued'),
      onStart: (wasQueued) => markRepoOperationTargets(options.id, requestId, options.targets, 'running', wasQueued),
    })
    if (!ctx.isCurrent()) {
      await handleStale()
      return null
    }
    error = options.errorFromResult?.(result) ?? null
    await options.onResult?.(result, ctx)
    return result
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
    if (ctx.isCurrent()) await options.onError?.(error, ctx)
    else await handleStale()
    if (options.rethrow) throw err
    return null
  } finally {
    settleRepoOperationTargets(options.id, requestId, options.targets, error)
  }
}

export function runLatestOperation<T>(options: RepoOperationBaseOptions<T>): Promise<T | null> {
  return runRepoOperation({ ...options, policy: 'latest-wins' })
}

export function runExclusiveOperation<T>(options: RunExclusiveOperationOptions<T>): Promise<T | null> {
  return runRepoOperation({ ...options, policy: 'exclusive' })
}
