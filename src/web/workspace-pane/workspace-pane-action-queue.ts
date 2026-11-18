import { KeyedSerialQueue } from '#/web/lib/keyed-serial-queue.ts'
import type { WorkspacePaneLocation } from '#/web/workspace-pane/workspace-pane-location.ts'

let queuesByPaneOwner = new KeyedSerialQueue()

type WorkspacePaneActionAdmission<T> = { kind: 'accepted'; result: T } | { kind: 'busy' }

export async function runWorkspacePaneAction<T>(
  location: WorkspacePaneLocation,
  task: () => Promise<T> | T,
): Promise<T> {
  return queuesByPaneOwner.run(workspacePaneActionQueueKey(location), task)
}

export async function tryRunWorkspacePaneAction<T>(
  location: WorkspacePaneLocation,
  task: () => Promise<T> | T,
): Promise<WorkspacePaneActionAdmission<T>> {
  const queueKey = workspacePaneActionQueueKey(location)
  if (queuesByPaneOwner.has(queueKey)) return { kind: 'busy' }
  return { kind: 'accepted', result: await queuesByPaneOwner.run(queueKey, task) }
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
  queuesByPaneOwner = new KeyedSerialQueue()
}

export function workspacePaneActionQueueStatsForTest(): { paneOwnerQueues: number } {
  return { paneOwnerQueues: queuesByPaneOwner.size }
}
