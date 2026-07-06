import { workspacePaneTabsTargetIdentityKeyFromIdentity } from '#/shared/workspace-pane-tabs-target.ts'

/**
 * Per-(user, target) identifier for `terminal-session-service`'s
 * workspace-pane-tabs operation queue. The web-side queue
 * (`web/workspace-pane/workspace-pane-tabs-operation-queue.ts`) does not
 * include `userId` because the web queue is per-session, not per-user.
 */
export type WorkspacePaneTabsUserQueueTarget =
  | { userId: string | number; kind: 'branch'; scope: string; branchName: string }
  | { userId: string | number; kind: 'worktree'; scope: string; worktreePath: string }

export function workspacePaneTabsUserQueueTarget(
  userId: string | number,
  scope: string,
  branchName: string,
  worktreePath: string | null,
): WorkspacePaneTabsUserQueueTarget {
  return worktreePath === null
    ? { userId, kind: 'branch', scope, branchName }
    : { userId, kind: 'worktree', scope, worktreePath }
}

export function workspacePaneTabsUserQueueKey(target: WorkspacePaneTabsUserQueueTarget): string {
  return `${String(target.userId)}\0${workspacePaneTabsTargetIdentityKeyFromIdentity(
    target.kind === 'branch'
      ? { kind: 'branch', repoRoot: target.scope, branchName: target.branchName }
      : { kind: 'worktree', repoRoot: target.scope, worktreePath: target.worktreePath },
  )}`
}
