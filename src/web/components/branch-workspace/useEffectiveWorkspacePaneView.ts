import { computeEffectiveWorkspacePaneView, type WorkspacePaneViewContext } from '#/web/lib/workspace-pane-view.ts'
import {
  useTerminalRepoSyncReady,
  useWorktreeTerminalSnapshot,
} from '#/web/components/terminal/terminal-session-store.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import type { WorkspacePaneView } from '#/shared/workspace-pane.ts'
import type { RepoDataState, RepoState, RepoUiState } from '#/web/stores/repos/types.ts'

type EffectiveWorkspacePaneViewRepo = {
  id: RepoState['id']
  ui: Pick<RepoUiState, 'selectedBranch' | 'preferredWorkspacePaneView'>
  data: Pick<RepoDataState, 'branches'>
}

/**
 * Resolve the preferred workspace pane view type after applying worktree and
 * terminal-session fallbacks. Whether a view of that type is actually open is
 * still checked by callers against the branch-scope open view state and the
 * live worktree-scope view list.
 *
 * Use this before resolving an active view identity. The repos store only
 * carries the user's preferred view type; branch-scope open view state owns
 * status, and the live worktree view list owns changes/terminal.
 */
export function useEffectiveWorkspacePaneView(
  repo: EffectiveWorkspacePaneViewRepo | null | undefined,
): WorkspacePaneView {
  const repoId = repo?.id ?? null
  const syncReady = useTerminalRepoSyncReady(repoId)
  const selectedBranch = repo?.ui.selectedBranch ?? null
  const branch =
    selectedBranch && repo ? (repo.data.branches.find((entry) => entry.name === selectedBranch) ?? null) : null
  const worktreePath = branch?.worktree?.path ?? null
  const terminalKey = worktreePath && repoId ? worktreeTerminalKey(repoId, worktreePath) : null
  const terminalSnapshot = useWorktreeTerminalSnapshot(terminalKey)
  if (!repo) return 'status'
  const context: WorkspacePaneViewContext = {
    hasWorktree: !!worktreePath,
    terminalSessionCount: terminalSnapshot.count,
    terminalSyncReady: syncReady,
    terminalPendingCreate: terminalSnapshot.pendingCreate,
  }
  return computeEffectiveWorkspacePaneView(repo.ui.preferredWorkspacePaneView, context)
}
