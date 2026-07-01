import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { createRepoWorkspaceTabModel, type RepoWorkspaceTabModel } from '#/web/components/repo-workspace/tab-model.ts'
import { preferredWorkspacePaneTabForBranch } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { useRepoSyncStore } from '#/web/stores/repo-sync.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { readWorkspacePaneTabsForBranch } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'

export function workspacePaneTabTargetForBranch(repoId: string, branchName: string): RepoWorkspaceTabModel | null {
  const state = useReposStore.getState()
  const repo = state.repos[repoId]
  if (!repo) return null
  const branch = repo.data.branches.find((candidate) => candidate.name === branchName)
  if (!branch) return null
  const worktreePath = branch.worktree?.path
  const terminalSyncReady = useRepoSyncStore.getState().ready.get(repoId) === repo.instanceToken
  const terminalWorktreeKey = worktreePath ? formatTerminalWorktreeKey(repo.id, worktreePath) : null
  const snapshot = terminalWorktreeKey
    ? (readTerminalSessionCommandBridge()?.terminalWorktreeSnapshot(terminalWorktreeKey) ?? null)
    : null
  return createRepoWorkspaceTabModel({
    repoId,
    branchName,
    worktreePath: worktreePath ?? null,
    preferredTab: preferredWorkspacePaneTabForBranch(repo.ui, branchName),
    tabEntries: readWorkspacePaneTabsForBranch(repoId, branchName),
    runtimeTerminalViews: snapshot?.sessions ?? [],
    terminalSessionCount: snapshot?.count ?? 0,
    terminalCreatePending: snapshot?.pendingCreate ?? false,
    terminalSyncReady,
    selectedTerminalSessionId: terminalWorktreeKey
      ? (state.selectedTerminalSessionIdByTerminalWorktree[terminalWorktreeKey] ?? null)
      : null,
  })
}
