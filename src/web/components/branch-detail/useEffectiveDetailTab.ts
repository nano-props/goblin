import { computeEffectiveDetailTab } from '#/web/lib/detail-tabs.ts'
import { useTerminalRepoSyncReady, useWorktreeTerminalCount } from '#/web/components/terminal/terminal-session-store.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import type { DetailTab, RepoDataState, RepoState, RepoUiState } from '#/web/stores/repos/types.ts'

type EffectiveDetailTabRepo = {
  id: RepoState['id']
  ui: Pick<RepoUiState, 'selectedBranch' | 'preferredDetailTab'>
  data: Pick<RepoDataState, 'branches'>
}

/**
 * Resolve the detail tab the UI should actually render, given the
 * stored user preference and live terminal session truth.
 *
 * Use this in any UI that decides which panel to show, which tab button
 * to highlight, or where focus should land. The repos store only carries
 * the user's *preferred* tab — the actual renderable tab is a function
 * of that preference plus the active branch's worktree and the
 * terminal session count.
 */
export function useEffectiveDetailTab(repo: EffectiveDetailTabRepo | null | undefined): DetailTab {
  const repoId = repo?.id ?? null
  const syncReady = useTerminalRepoSyncReady(repoId)
  const selectedBranch = repo?.ui.selectedBranch ?? null
  const branch =
    selectedBranch && repo ? (repo.data.branches.find((entry) => entry.name === selectedBranch) ?? null) : null
  const worktreePath = branch?.worktree?.path ?? null
  const terminalKey = worktreePath && repoId ? worktreeTerminalKey(repoId, worktreePath) : null
  const sessionCount = useWorktreeTerminalCount(terminalKey)
  if (!repo) return 'status'
  return computeEffectiveDetailTab(repo.ui.preferredDetailTab, !!worktreePath, sessionCount, syncReady)
}
