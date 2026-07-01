import { workspacePaneTabsTargetIdentityKeyFromIdentity } from '#/shared/workspace-pane-tabs-target.ts'

/**
 * Per-(user, target) identifier for `terminal-session-service`'s
 * workspace-pane-tabs operation queue. The web-side queue
 * (`web/workspace-pane/workspace-pane-tabs-operation-queue.ts`) does not
 * include `userId` because the web queue is per-session, not per-user.
 */
export type WorkspacePaneTabsUserQueueTarget =
  | { userId: string | number; kind: 'branch'; repoRoot: string; branchName: string }
  | { userId: string | number; kind: 'worktree'; repoRoot: string; worktreePath: string }

export function workspacePaneTabsUserQueueTarget(
  userId: string | number,
  scope: string,
  branchName: string,
  worktreePath: string | null,
): WorkspacePaneTabsUserQueueTarget {
  return worktreePath === null
    ? { userId, kind: 'branch', repoRoot: scope, branchName }
    : { userId, kind: 'worktree', repoRoot: scope, worktreePath }
}

export function workspacePaneTabsUserQueueKey(target: WorkspacePaneTabsUserQueueTarget): string {
  return `${String(target.userId)}\0${workspacePaneTabsTargetIdentityKeyFromIdentity(
    target.kind === 'branch'
      ? { kind: 'branch', repoRoot: target.repoRoot, branchName: target.branchName }
      : { kind: 'worktree', repoRoot: target.repoRoot, worktreePath: target.worktreePath },
  )}`
}
