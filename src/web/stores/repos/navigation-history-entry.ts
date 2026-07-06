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
    case 'dashboard':
      return true
    case 'newWorktree':
      return b.route.kind === 'newWorktree' && a.route.returnTo === b.route.returnTo
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
