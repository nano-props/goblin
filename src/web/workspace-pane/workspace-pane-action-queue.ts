import PQueue from 'p-queue'
import { parseCanonicalWorkspaceLocator, type WorkspaceId } from '#/shared/workspace-locator.ts'
import type { WorkspacePaneFilesystemExecutionTarget } from '#/shared/workspace-runtime.ts'
import type { WorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspacePaneLocation } from '#/web/workspace-pane/workspace-pane-location.ts'
export type WorkspacePaneActionTarget =
  | { kind: 'workspace-root'; workspaceId: WorkspaceId; workspaceRuntimeId: string }
  | { kind: 'git-branch'; workspaceId: WorkspaceId; workspaceRuntimeId: string; branchName: string }
  | { kind: 'git-worktree'; workspaceId: WorkspaceId; workspaceRuntimeId: string; worktreePath: string }

export function workspacePaneActionTargetFromPaneTarget(
  target: WorkspacePaneTabsTarget,
  workspaceRuntimeId: string,
): WorkspacePaneActionTarget {
  if (target.kind === 'workspace-root') {
    return { kind: target.kind, workspaceId: target.workspaceId, workspaceRuntimeId }
  }
  return target.kind === 'git-branch'
    ? { kind: target.kind, workspaceId: target.workspaceId, workspaceRuntimeId, branchName: target.branchName }
    : { kind: target.kind, workspaceId: target.workspaceId, workspaceRuntimeId, worktreePath: target.worktreePath }
}

export function workspacePaneActionTargetFromLocation(location: WorkspacePaneLocation): WorkspacePaneActionTarget {
  return workspacePaneActionTargetFromPaneTarget(location.paneTarget, location.workspaceRuntimeId)
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

type WorkspacePaneActionAdmission<T> = { kind: 'accepted'; result: T } | { kind: 'busy' }

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

export async function tryRunWorkspacePaneAction<T>(
  target: WorkspacePaneActionTarget,
  task: () => Promise<T> | T,
): Promise<WorkspacePaneActionAdmission<T>> {
  const queueKey = workspacePaneActionTargetKey(target)
  const queue = workspacePaneActionQueue(queueKey)
  if (queue.pending > 0 || queue.size > 0) return { kind: 'busy' }
  try {
    return { kind: 'accepted', result: await queue.add(task) }
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
