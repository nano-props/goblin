import { computeEffectiveDetailTab, type DetailTabContext } from '#/web/lib/detail-tabs.ts'
import {
  useTerminalRepoSyncReady,
  useWorktreeTerminalSnapshot,
} from '#/web/components/terminal/terminal-session-store.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import { branchWorktreeHasChanges } from '#/web/stores/repos/worktree-state.ts'
import type { DetailTab, RepoDataState, RepoState, RepoUiState } from '#/web/stores/repos/types.ts'

type EffectiveDetailTabRepo = {
  id: RepoState['id']
  ui: Pick<RepoUiState, 'selectedBranch' | 'preferredDetailTab'>
  // `worktreesByPath` and `status` together drive the dirty-state
  // derivation in `branchWorktreeHasChanges`; the canonical fallback
  // chain (status entries → snapshot changeCount → isDirty) lives
  // there so we don't reinvent it here.
  data: Pick<RepoDataState, 'branches' | 'worktreesByPath' | 'status'>
}

/**
 * Resolve the detail tab the UI should actually render, given the
 * stored user preference and live terminal session truth.
 *
 * Use this in any UI that decides which panel to show, which tab button
 * to highlight, or where focus should land. The repos store only carries
 * the user's *preferred* tab — the actual renderable tab is a function
 * of that preference plus the active branch's worktree, the worktree's
 * dirty state, and the terminal session count.
 */
export function useEffectiveDetailTab(repo: EffectiveDetailTabRepo | null | undefined): DetailTab {
  const repoId = repo?.id ?? null
  const syncReady = useTerminalRepoSyncReady(repoId)
  const selectedBranch = repo?.ui.selectedBranch ?? null
  const branch =
    selectedBranch && repo ? (repo.data.branches.find((entry) => entry.name === selectedBranch) ?? null) : null
  const worktreePath = branch?.worktree?.path ?? null
  const hasChanges = branch && repo ? branchWorktreeHasChanges(repo, branch) : false
  const terminalKey = worktreePath && repoId ? worktreeTerminalKey(repoId, worktreePath) : null
  const terminalSnapshot = useWorktreeTerminalSnapshot(terminalKey)
  if (!repo) return 'status'
  const context: DetailTabContext = {
    hasWorktree: !!worktreePath,
    hasChanges,
    terminalSessionCount: terminalSnapshot.count,
    terminalSyncReady: syncReady,
    terminalPendingCreate: terminalSnapshot.pendingCreate,
  }
  return computeEffectiveDetailTab(repo.ui.preferredDetailTab, context)
}
