import {
  markRepoOperationTargets,
  nextRepoOperationId,
  repoOperationBusy,
  repoOperationCurrent,
  scheduleRepoOperation,
  settleRepoOperationTargets,
  type RepoOperationLane,
} from '#/web/stores/workspaces/repo-operation-scheduler.ts'
import { isExpectedRepoOperationCancellation } from '#/web/stores/workspaces/operation-cancellation.ts'
import { updateIfFresh } from '#/web/stores/workspaces/workspace-guards.ts'
import { gitWorkspaceProjection, isGitWorkspace } from '#/web/stores/workspaces/git-workspace-projection.ts'
import {
  markRepoOperationViews,
  settleRepoOperationViews,
  type RepoOperationTarget,
} from '#/web/stores/workspaces/operations.ts'
import type { WorkspaceState, WorkspacesGet, WorkspacesSet } from '#/web/stores/workspaces/types.ts'
export type { RepoOperationTarget }

export interface RepoOperationContext {
  id: string
  workspaceRuntimeId: string
  operationId: number
  isCurrent: () => boolean
  ownsTarget: (key: string) => boolean
  setPhase: (phase: 'queued' | 'running') => void
}

interface RepoOperationBaseFields<T> {
  set: WorkspacesSet
  get: WorkspacesGet
  id: string
  workspaceRuntimeId?: string
  lane: RepoOperationLane
  priority: number
  targets: [RepoOperationTarget, ...RepoOperationTarget[]]
  task: (signal: AbortSignal, ctx: RepoOperationContext) => Promise<T>
  completionBarrier?: (result: T, ctx: RepoOperationContext) => void | Promise<void>
  operationKey?: string
  errorFromResult?: (result: T) => string | null
  errorResult?: (message: string) => T
  onResult?: (result: T, ctx: RepoOperationContext) => void | Promise<void>
  onError?: (message: string, ctx: RepoOperationContext) => void | Promise<void>
  onStale?: (ctx: RepoOperationContext) => void | Promise<void>
  rethrow?: boolean
}

type RepoOperationBaseOptions<T> = RepoOperationBaseFields<T> &
  (
    | { queuedTimeoutMs?: undefined; queuedTimeoutMessage?: undefined }
    | { queuedTimeoutMs: number; queuedTimeoutMessage: string }
  )

type RunLatestOperationOptions<T> = RepoOperationBaseOptions<T>

type RunExclusiveOperationOptions<T> = RepoOperationBaseOptions<T> & {
  canStart?: (repo: WorkspaceState) => boolean
  busyResult?: T
}

type InternalRepoOperationOptions<T> =
  | (RunLatestOperationOptions<T> & { policy: 'latest-wins' })
  | (RunExclusiveOperationOptions<T> & { policy: 'exclusive' })

function operationCurrent(
  get: WorkspacesGet,
  id: string,
  workspaceRuntimeId: string,
  operationId: number,
  target: RepoOperationTarget,
) {
  const repo = get().workspaces[id]
  return !!repo && repo.workspaceRuntimeId === workspaceRuntimeId && repoOperationCurrent(id, target.key, operationId)
}

function anyTargetBusy(id: string, targets: RepoOperationTarget[]) {
  return targets.some((target) => repoOperationBusy(id, target.key))
}

function markOperationState<T>(
  options: InternalRepoOperationOptions<T>,
  workspaceRuntimeId: string,
  operationId: number,
  phase: 'queued' | 'running',
  wasQueued = false,
) {
  markRepoOperationTargets(options.id, operationId, options.targets, phase, wasQueued)
  updateIfFresh(options.set, options.id, workspaceRuntimeId, (repo) => {
    if (!isGitWorkspace(repo)) return
    markRepoOperationViews(gitWorkspaceProjection(repo).operations, operationId, options.targets, phase, wasQueued)
  })
}

function settleOperationState<T>(
  options: InternalRepoOperationOptions<T>,
  workspaceRuntimeId: string,
  operationId: number,
  error: string | null,
) {
  settleRepoOperationTargets(options.id, operationId, options.targets, error)
  updateIfFresh(options.set, options.id, workspaceRuntimeId, (repo) => {
    if (!isGitWorkspace(repo)) return
    settleRepoOperationViews(gitWorkspaceProjection(repo).operations, operationId, options.targets, error)
  })
}

async function runRepoOperation<T>(options: InternalRepoOperationOptions<T>): Promise<T | null> {
  const repoBefore = options.get().workspaces[options.id]
  if (!repoBefore || !isGitWorkspace(repoBefore)) return null
  const workspaceRuntimeId = options.workspaceRuntimeId ?? repoBefore.workspaceRuntimeId
  if (repoBefore.workspaceRuntimeId !== workspaceRuntimeId) return null
  const primary = options.targets[0]
  let ownedTargetKeysAtSettle: Set<string> | null = null
  if (options.policy !== 'latest-wins') {
    const busy = anyTargetBusy(options.id, options.targets)
    if (busy || (options.canStart && !options.canStart(repoBefore))) return options.busyResult ?? null
  }

  const operationId = nextRepoOperationId(options.id)
  const ctx: RepoOperationContext = {
    id: options.id,
    workspaceRuntimeId,
    operationId,
    isCurrent: () => operationCurrent(options.get, options.id, workspaceRuntimeId, operationId, primary),
    ownsTarget: (key) =>
      ownedTargetKeysAtSettle
        ? ownedTargetKeysAtSettle.has(key)
        : options.targets.some(
            (target) =>
              target.key === key && operationCurrent(options.get, options.id, workspaceRuntimeId, operationId, target),
          ),
    setPhase: (phase) => {
      if (ctx.isCurrent()) markOperationState(options, workspaceRuntimeId, operationId, phase)
    },
  }

  // The task and its optional completion barrier share one scheduled lifetime.
  // Operation state settles only after both have completed.
  type Outcome =
    | { kind: 'stale' }
    | { kind: 'error'; error: string; original: unknown }
    | { kind: 'success'; result: T; error: string | null }

  let outcome: Outcome
  let operationSignal: AbortSignal | null = null
  try {
    const scheduleOptions = {
      priority: options.priority,
      replaceQueuedKey:
        options.policy === 'latest-wins' ? `${options.lane}:${options.operationKey ?? primary.key}` : undefined,
      onQueued: () => markOperationState(options, workspaceRuntimeId, operationId, 'queued'),
      onStart: (wasQueued: boolean) =>
        markOperationState(options, workspaceRuntimeId, operationId, 'running', wasQueued),
    }
    const result = await scheduleRepoOperation<T>(
      options.id,
      options.lane,
      async (signal) => {
        operationSignal = signal
        const taskResult = await options.task(signal, ctx)
        if (ctx.isCurrent()) await options.completionBarrier?.(taskResult, ctx)
        return taskResult
      },
      options.queuedTimeoutMs === undefined
        ? scheduleOptions
        : {
            ...scheduleOptions,
            queuedTimeoutMs: options.queuedTimeoutMs,
            queuedTimeoutMessage: options.queuedTimeoutMessage,
          },
    )
    if (!ctx.isCurrent()) {
      outcome = { kind: 'stale' }
    } else {
      outcome = { kind: 'success', result, error: options.errorFromResult?.(result) ?? null }
    }
  } catch (err) {
    outcome = isExpectedRepoOperationCancellation(err, operationSignal)
      ? { kind: 'stale' }
      : { kind: 'error', error: err instanceof Error ? err.message : String(err), original: err }
  }

  // Settle operation state exactly once before running side effects.
  ownedTargetKeysAtSettle = new Set(
    options.targets
      .filter((target) => operationCurrent(options.get, options.id, workspaceRuntimeId, operationId, target))
      .map((target) => target.key),
  )
  const settleError = outcome.kind === 'success' ? outcome.error : outcome.kind === 'error' ? outcome.error : null
  settleOperationState(options, workspaceRuntimeId, operationId, settleError)

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
