import type { WorkspaceNavigationHistoryEntry } from '#/web/stores/repos/types.ts'

export function workspaceNavigationHistoryEntryEqual(
  a: WorkspaceNavigationHistoryEntry | null,
  b: WorkspaceNavigationHistoryEntry | null,
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.repoId !== b.repoId || a.route.kind !== b.route.kind) return false
  switch (a.route.kind) {
    case 'empty':
    case 'workspace':
    case 'dashboard':
      return true
    case 'newWorktree':
      return b.route.kind === 'newWorktree' && a.route.returnTo === b.route.returnTo
    case 'worktree':
      return (
        b.route.kind === 'worktree' &&
        a.route.worktreePath === b.route.worktreePath &&
        a.route.workspacePaneTab === b.route.workspacePaneTab &&
        a.route.terminalSessionId === b.route.terminalSessionId
      )
    case 'branch':
      return (
        b.route.kind === 'branch' &&
        a.route.branchName === b.route.branchName &&
        a.route.workspacePaneTab === b.route.workspacePaneTab &&
        a.route.terminalWorktreeKey === b.route.terminalWorktreeKey &&
        a.route.terminalSessionId === b.route.terminalSessionId
      )
  }
}

export function workspaceNavigationHistoryEntryCanReplaceCurrent(
  a: WorkspaceNavigationHistoryEntry | null,
  b: WorkspaceNavigationHistoryEntry | null,
): boolean {
  if (!a || !b) return false
  if (a.repoId !== b.repoId || a.route.kind !== b.route.kind) return false
  switch (a.route.kind) {
    case 'empty':
    case 'workspace':
    case 'dashboard':
    case 'newWorktree':
      return false
    case 'worktree':
      if (
        b.route.kind !== 'worktree' ||
        a.route.worktreePath !== b.route.worktreePath ||
        a.route.workspacePaneTab !== b.route.workspacePaneTab
      )
        return false
      return (
        a.route.workspacePaneTab !== 'terminal' ||
        !a.route.terminalSessionId ||
        !b.route.terminalSessionId ||
        a.route.terminalSessionId === b.route.terminalSessionId
      )
    case 'branch': {
      if (
        b.route.kind !== 'branch' ||
        a.route.branchName !== b.route.branchName ||
        a.route.workspacePaneTab !== b.route.workspacePaneTab
      ) {
        return false
      }
      if (a.route.workspacePaneTab !== 'terminal') return true
      return (
        !a.route.terminalSessionId ||
        !b.route.terminalSessionId ||
        a.route.terminalSessionId === b.route.terminalSessionId
      )
    }
  }
}
