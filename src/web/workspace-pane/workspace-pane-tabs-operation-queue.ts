import PQueue from 'p-queue'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'

export interface WorkspacePaneTabsOperationTarget {
  repoRoot: string
  branchName: string
  worktreePath: string | null
}

const workspacePaneTabsOperationQueues = new Map<string, PQueue>()

/**
 * Serializes workspace pane tab operations for one canonical tab target.
 *
 * Worktree-backed tab lists are owned by (repoRoot, worktreePath). Branch-only
 * tab lists are owned by (repoRoot, branchName).
 */
export async function runWorkspacePaneTabsOperation<T>(
  target: WorkspacePaneTabsOperationTarget,
  operation: () => T | Promise<T>,
): Promise<T> {
  const key = workspacePaneTabsOperationQueueKey(target)
  const queue = workspacePaneTabsOperationQueue(key)
  try {
    return await queue.add(operation)
  } finally {
    scheduleWorkspacePaneTabsOperationQueueCleanup(key, queue)
  }
}

export function workspacePaneTabsOperationQueueKey(target: WorkspacePaneTabsOperationTarget): string {
  return workspacePaneTabsTargetIdentityKey(target)
}

export function clearWorkspacePaneTabsOperationQueuesForTests(): void {
  workspacePaneTabsOperationQueues.clear()
}

function workspacePaneTabsOperationQueue(key: string): PQueue {
  const current = workspacePaneTabsOperationQueues.get(key)
  if (current) return current
  const next = new PQueue({ concurrency: 1 })
  workspacePaneTabsOperationQueues.set(key, next)
  return next
}

function scheduleWorkspacePaneTabsOperationQueueCleanup(key: string, queue: PQueue): void {
  void queue.onIdle().then(() => {
    if (workspacePaneTabsOperationQueues.get(key) !== queue) return
    if (queue.size === 0 && queue.pending === 0) workspacePaneTabsOperationQueues.delete(key)
  })
}
