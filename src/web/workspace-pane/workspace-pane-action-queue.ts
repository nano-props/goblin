import PQueue from 'p-queue'
import type { WorkspacePaneLocation } from '#/web/workspace-pane/workspace-pane-location.ts'

const queuesByPaneOwner = new Map<string, PQueue>()

type WorkspacePaneActionAdmission<T> = { kind: 'accepted'; result: T } | { kind: 'busy' }

export async function runWorkspacePaneAction<T>(
  location: WorkspacePaneLocation,
  task: () => Promise<T> | T,
): Promise<T> {
  const queueKey = workspacePaneActionQueueKey(location)
  const queue = workspacePaneActionQueue(queueKey)
  try {
    return await queue.add(task)
  } finally {
    scheduleWorkspacePaneActionQueueCleanup(queueKey, queue)
  }
}

export async function tryRunWorkspacePaneAction<T>(
  location: WorkspacePaneLocation,
  task: () => Promise<T> | T,
): Promise<WorkspacePaneActionAdmission<T>> {
  const queueKey = workspacePaneActionQueueKey(location)
  const queue = workspacePaneActionQueue(queueKey)
  if (queue.pending > 0 || queue.size > 0) return { kind: 'busy' }
  try {
    return { kind: 'accepted', result: await queue.add(task) }
  } finally {
    scheduleWorkspacePaneActionQueueCleanup(queueKey, queue)
  }
}

function workspacePaneActionQueueKey(location: WorkspacePaneLocation): string {
  const { paneTarget, workspaceRuntimeId } = location
  switch (paneTarget.kind) {
    case 'workspace-root':
      return `${paneTarget.workspaceId}\0${workspaceRuntimeId}\0workspace-root`
    case 'git-branch':
      return `${paneTarget.workspaceId}\0${workspaceRuntimeId}\0git-branch\0${paneTarget.branchName}`
    case 'git-worktree':
      return `${paneTarget.workspaceId}\0${workspaceRuntimeId}\0git-worktree\0${paneTarget.worktreePath}`
  }
}

export function resetWorkspacePaneActionQueueForTest(): void {
  queuesByPaneOwner.clear()
}

export function workspacePaneActionQueueStatsForTest(): { paneOwnerQueues: number } {
  return { paneOwnerQueues: queuesByPaneOwner.size }
}

function workspacePaneActionQueue(queueKey: string): PQueue {
  let queue = queuesByPaneOwner.get(queueKey)
  if (!queue) {
    queue = new PQueue({ concurrency: 1 })
    queuesByPaneOwner.set(queueKey, queue)
  }
  return queue
}

function scheduleWorkspacePaneActionQueueCleanup(queueKey: string, queue: PQueue): void {
  void queue.onIdle().then(() => {
    if (queuesByPaneOwner.get(queueKey) !== queue) return
    if (queue.size === 0 && queue.pending === 0) queuesByPaneOwner.delete(queueKey)
  })
}
