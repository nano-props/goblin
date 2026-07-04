import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { createRepoWorkspaceTabModel, type RepoWorkspaceTabModel } from '#/web/components/repo-workspace/tab-model.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { useRepoSyncStore } from '#/web/stores/repo-sync.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { requireRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'

/** Resolves the tab model for whichever branch is currently selected on
 *  `repoId`. Shared by command entry points that need to read/act on "the
 *  tab strip the user is currently looking at" without knowing the branch
 *  name themselves. */
export function activeWorkspacePaneTabTarget(repoId: string): RepoWorkspaceTabModel | null {
  const repo = useReposStore.getState().repos[repoId]
  if (!repo?.ui.selectedBranch) return null
  return workspacePaneTabTargetForBranch(repoId, repo.ui.selectedBranch)
}

export function workspacePaneTabTargetForBranch(repoId: string, branchName: string): RepoWorkspaceTabModel | null {
  const state = useReposStore.getState()
  const repo = state.repos[repoId]
  if (!repo) return null
  const branchModel = requireRepoBranchQueryProjection(repo)
  const branch = branchModel.branches.find((candidate) => candidate.name === branchName)
  if (!branch) return null
  const worktreePath = branch.worktree?.path
  const terminalSyncReady = useRepoSyncStore.getState().ready.get(repoId) === repo.instanceId
  const terminalWorktreeKey = worktreePath ? formatTerminalWorktreeKey(repo.id, worktreePath) : null
  const snapshot = terminalWorktreeKey
    ? (readTerminalSessionCommandBridge()?.terminalWorktreeSnapshot(terminalWorktreeKey) ?? null)
    : null
  return createRepoWorkspaceTabModel({
    repoId,
    branchName,
    worktreePath: worktreePath ?? null,
    preferredTab: preferredWorkspacePaneTabForTarget(repo.ui, {
      repoRoot: repoId,
      branchName,
      worktreePath: worktreePath ?? null,
    }),
    tabEntries: readWorkspacePaneTabsForTarget({
      repoRoot: repoId,
      repoInstanceId: repo.instanceId,
      branchName,
      worktreePath: worktreePath ?? null,
    }),
    runtimeTerminalViews: snapshot?.sessions ?? [],
    terminalCreatePending: snapshot?.pendingCreate ?? false,
    terminalSyncReady,
    selectedTerminalSessionId: terminalWorktreeKey
      ? (state.selectedTerminalSessionIdByTerminalWorktree[terminalWorktreeKey] ?? null)
      : null,
  })
}
