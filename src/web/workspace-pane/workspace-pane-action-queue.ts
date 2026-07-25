import PQueue from 'p-queue'
import { parseCanonicalWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
export type WorkspacePaneActionTarget =
  | { kind: 'workspace-root'; workspaceId: WorkspaceId; workspaceRuntimeId: string }
  | { kind: 'git-branch'; workspaceId: WorkspaceId; workspaceRuntimeId: string; branchName: string }
  | { kind: 'git-worktree'; workspaceId: WorkspaceId; workspaceRuntimeId: string; worktreePath: string }

export function workspacePaneActionTargetFromCoordinates(coordinates: {
  workspaceId: WorkspaceId
  workspaceRuntimeId: string
  branchName: string | null
  worktreePath: string | null
}): WorkspacePaneActionTarget {
  if (coordinates.worktreePath !== null) {
    return {
      kind: 'git-worktree',
      workspaceId: coordinates.workspaceId,
      workspaceRuntimeId: coordinates.workspaceRuntimeId,
      worktreePath: coordinates.worktreePath,
    }
  }
  return coordinates.branchName === null
    ? {
        kind: 'workspace-root',
        workspaceId: coordinates.workspaceId,
        workspaceRuntimeId: coordinates.workspaceRuntimeId,
      }
    : {
        kind: 'git-branch',
        workspaceId: coordinates.workspaceId,
        workspaceRuntimeId: coordinates.workspaceRuntimeId,
        branchName: coordinates.branchName,
      }
}

export function workspacePaneActionTargetFromFilesystemTarget(
  target: WorkspacePaneFilesystemExecutionTarget,
): WorkspacePaneActionTarget {
  if (target.kind === 'workspace-root') {
    return { kind: target.kind, workspaceId: target.workspaceId, workspaceRuntimeId: target.workspaceRuntimeId }
  }
  const root = parseCanonicalWorkspaceLocator(target.root)
  if (!root) throw new Error('filesystem action target requires a canonical worktree root')
  return {
    kind: target.kind,
    workspaceId: target.workspaceId,
    workspaceRuntimeId: target.workspaceRuntimeId,
    worktreePath: root.path,
  }
}

const queuesByTarget = new Map<string, PQueue>()

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
      return `${target.workspaceId}\0${target.workspaceRuntimeId}\0workspace-root`
    case 'git-branch':
      return `${target.workspaceId}\0${target.workspaceRuntimeId}\0git-branch\0${target.branchName}`
    case 'git-worktree':
      return `${target.workspaceId}\0${target.workspaceRuntimeId}\0git-worktree\0${target.worktreePath}`
  }
}

export function resetWorkspacePaneActionQueueForTest(): void {
  queuesByTarget.clear()
}

export function workspacePaneActionQueueStatsForTest(): { targetQueues: number } {
  return { targetQueues: queuesByTarget.size }
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
