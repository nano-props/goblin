import PQueue from 'p-queue'
import { runtimeWorkspacePaneTarget } from '#/shared/workspace-pane-tabs-target.ts'

export interface GitWorkspacePaneActionTarget {
  repoId: string
  repoRuntimeId: string
  branchName: string | null
  worktreePath: string | null
}

export interface RootWorkspacePaneActionTarget {
  kind: 'workspace-root'
  repoId: string
  repoRuntimeId: string
  branchName: null
  worktreePath: null
}

export type WorkspacePaneActionTarget = GitWorkspacePaneActionTarget | RootWorkspacePaneActionTarget

const queuesByTarget = new Map<string, PQueue>()
const pendingRouteIntents = new Map<number, { targetKey: string; fromRouteKey: string }>()
const routeIntentSubscribers = new Set<() => void>()
let nextRouteIntentId = 1

export async function runWorkspacePaneAction<T>(
  target: WorkspacePaneActionTarget,
  task: () => Promise<T> | T,
): Promise<T> {
  const queueKey = workspacePaneActionTargetKey(target)
  if (!queueKey) return await task()
  const queue = workspacePaneActionQueue(queueKey)
  try {
    return await queue.add(task)
  } finally {
    scheduleWorkspacePaneActionQueueCleanup(queueKey, queue)
  }
}

export function workspacePaneActionTargetKey(target: WorkspacePaneActionTarget): string | null {
  const runtimeTarget = runtimeWorkspacePaneTarget(
    'kind' in target
      ? { kind: 'workspace-root', repoRoot: target.repoId, branchName: null, worktreePath: null }
      : {
          repoRoot: target.repoId,
          branchName: target.branchName ?? '',
          worktreePath: target.worktreePath,
        },
    target.repoRuntimeId,
  )
  if (!runtimeTarget) return null
  if (runtimeTarget.kind === 'workspace-root')
    return `${runtimeTarget.workspaceId}\0${runtimeTarget.workspaceRuntimeId}\0workspace-root`
  if (runtimeTarget.kind === 'git-branch') {
    return `${runtimeTarget.workspaceId}\0${runtimeTarget.workspaceRuntimeId}\0git-branch\0${runtimeTarget.branch}`
  }
  return `${runtimeTarget.workspaceId}\0${runtimeTarget.workspaceRuntimeId}\0git-worktree\0${runtimeTarget.root}`
}

export function resetWorkspacePaneActionQueueForTest(): void {
  queuesByTarget.clear()
  const hadPendingRouteIntents = pendingRouteIntents.size > 0
  pendingRouteIntents.clear()
  nextRouteIntentId = 1
  if (hadPendingRouteIntents) notifyWorkspacePaneRouteIntentSubscribers()
}

export function workspacePaneActionQueueStatsForTest(): { targetQueues: number; pendingRouteIntents: number } {
  return { targetQueues: queuesByTarget.size, pendingRouteIntents: pendingRouteIntents.size }
}

export function beginWorkspacePaneRouteIntent(target: WorkspacePaneActionTarget, fromRouteKey: string): number | null {
  const targetKey = workspacePaneActionTargetKey(target)
  if (!targetKey) return null
  const intentId = nextRouteIntentId++
  pendingRouteIntents.set(intentId, { targetKey, fromRouteKey })
  notifyWorkspacePaneRouteIntentSubscribers()
  return intentId
}

export function finishWorkspacePaneRouteIntent(intentId: number | null | undefined): void {
  if (intentId && pendingRouteIntents.delete(intentId)) notifyWorkspacePaneRouteIntentSubscribers()
}

export function subscribeWorkspacePaneRouteIntents(onStoreChange: () => void): () => void {
  routeIntentSubscribers.add(onStoreChange)
  return () => routeIntentSubscribers.delete(onStoreChange)
}

export function workspacePaneRouteIntentPending(target: WorkspacePaneActionTarget, fromRouteKey: string): boolean {
  const targetKey = workspacePaneActionTargetKey(target)
  if (!targetKey) return false
  return [...pendingRouteIntents.values()].some(
    (intent) => intent.targetKey === targetKey && intent.fromRouteKey === fromRouteKey,
  )
}

function workspacePaneActionQueue(queueKey: string): PQueue {
  let queue = queuesByTarget.get(queueKey)
  if (!queue) {
    queue = new PQueue({ concurrency: 1 })
    queuesByTarget.set(queueKey, queue)
  }
  return queue
}

function scheduleWorkspacePaneActionQueueCleanup(queueKey: string, queue: PQueue): void {
  void queue.onIdle().then(() => {
    if (queuesByTarget.get(queueKey) !== queue) return
    if (queue.size === 0 && queue.pending === 0) queuesByTarget.delete(queueKey)
  })
}

function notifyWorkspacePaneRouteIntentSubscribers(): void {
  for (const subscriber of routeIntentSubscribers) subscriber()
}
