import PQueue from 'p-queue'
import { parseCanonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
export type WorkspacePaneActionTarget =
  | { kind: 'workspace-root'; repoId: string; workspaceRuntimeId: string }
  | { kind: 'git-branch'; repoId: string; workspaceRuntimeId: string; branchName: string }
  | { kind: 'git-worktree'; repoId: string; workspaceRuntimeId: string; worktreePath: string }

export function workspacePaneActionTargetFromCoordinates(coordinates: {
  repoId: string
  workspaceRuntimeId: string
  branchName: string | null
  worktreePath: string | null
}): WorkspacePaneActionTarget {
  if (coordinates.worktreePath !== null) {
    return {
      kind: 'git-worktree',
      repoId: coordinates.repoId,
      workspaceRuntimeId: coordinates.workspaceRuntimeId,
      worktreePath: coordinates.worktreePath,
    }
  }
  return coordinates.branchName === null
    ? { kind: 'workspace-root', repoId: coordinates.repoId, workspaceRuntimeId: coordinates.workspaceRuntimeId }
    : {
        kind: 'git-branch',
        repoId: coordinates.repoId,
        workspaceRuntimeId: coordinates.workspaceRuntimeId,
        branchName: coordinates.branchName,
      }
}

export function workspacePaneActionTargetFromFilesystemTarget(
  target: WorkspacePaneFilesystemExecutionTarget,
): WorkspacePaneActionTarget {
  if (target.kind === 'workspace-root') {
    return { kind: target.kind, repoId: target.workspaceId, workspaceRuntimeId: target.workspaceRuntimeId }
  }
  const root = parseCanonicalWorkspaceLocator(target.root)
  if (!root) throw new Error('filesystem action target requires a canonical worktree root')
  return {
    kind: target.kind,
    repoId: target.workspaceId,
    workspaceRuntimeId: target.workspaceRuntimeId,
    worktreePath: root.path,
  }
}

const queuesByTarget = new Map<string, PQueue>()
const pendingRouteIntents = new Map<number, { targetKey: string; fromRouteKey: string }>()
const routeIntentSubscribers = new Set<() => void>()
let nextRouteIntentId = 1

export async function runWorkspacePaneAction<T>(
  target: WorkspacePaneActionTarget,
  task: () => Promise<T> | T,
): Promise<T> {
  const queueKey = workspacePaneActionTargetKey(target)
  const queue = workspacePaneActionQueue(queueKey)
  try {
    return await queue.add(task)
  } finally {
    scheduleWorkspacePaneActionQueueCleanup(queueKey, queue)
  }
}

export function workspacePaneActionTargetKey(target: WorkspacePaneActionTarget): string {
  switch (target.kind) {
    case 'workspace-root':
      return `${target.repoId}\0${target.workspaceRuntimeId}\0workspace-root`
    case 'git-branch':
      return `${target.repoId}\0${target.workspaceRuntimeId}\0git-branch\0${target.branchName}`
    case 'git-worktree':
      return `${target.repoId}\0${target.workspaceRuntimeId}\0git-worktree\0${target.worktreePath}`
  }
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

export function beginWorkspacePaneRouteIntent(target: WorkspacePaneActionTarget, fromRouteKey: string): number {
  const targetKey = workspacePaneActionTargetKey(target)
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
