import PQueue from 'p-queue'

export interface WorkspacePaneTabsOperationTarget {
  repoRoot: string
  branchName: string
  worktreePath: string | null
}

const workspacePaneTabsOperationQueues = new Map<string, PQueue>()

/**
 * Serializes workspace pane tab operations for a branch tab target.
 *
 * The tab list is owned by (repoRoot, branchName). worktreePath travels with
 * each operation because some tab types require a worktree, but it is not a
 * second ordering key.
 */
export async function runWorkspacePaneTabsOperation<T>(
  target: WorkspacePaneTabsOperationTarget,
  operation: () => T | Promise<T>,
): Promise<T> {
  return await workspacePaneTabsOperationQueue(target).add(operation)
}

export function workspacePaneTabsOperationQueueKey(
  target: Pick<WorkspacePaneTabsOperationTarget, 'repoRoot' | 'branchName'>,
): string {
  return `${target.repoRoot}\0${target.branchName}`
}

export function clearWorkspacePaneTabsOperationQueuesForTests(): void {
  workspacePaneTabsOperationQueues.clear()
}

function workspacePaneTabsOperationQueue(target: WorkspacePaneTabsOperationTarget): PQueue {
  const key = workspacePaneTabsOperationQueueKey(target)
  const current = workspacePaneTabsOperationQueues.get(key)
  if (current) return current
  const next = new PQueue({ concurrency: 1 })
  workspacePaneTabsOperationQueues.set(key, next)
  return next
}
