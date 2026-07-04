import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { createRepoWorkspaceTabModel, type RepoWorkspaceTabModel } from '#/web/components/repo-workspace/tab-model.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { useRepoSyncStore } from '#/web/stores/repo-sync.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'

export type WorkspacePaneTabTargetResolution =
  | { kind: 'ready'; target: RepoWorkspaceTabModel }
  | { kind: 'missing' }
  | { kind: 'unavailable'; reason: 'branch-read-model-unavailable' }

/** Resolves the tab model for whichever branch is currently selected on
 *  `repoId`. Shared by command entry points that need to read/act on "the
 *  tab strip the user is currently looking at" without knowing the branch
 *  name themselves. */
export function activeWorkspacePaneTabTarget(repoId: string): RepoWorkspaceTabModel | null {
  const resolution = activeWorkspacePaneTabTargetResolution(repoId)
  return resolution.kind === 'ready' ? resolution.target : null
}

export function activeWorkspacePaneTabTargetResolution(repoId: string): WorkspacePaneTabTargetResolution {
  const repo = useReposStore.getState().repos[repoId]
  if (!repo?.ui.selectedBranch) return { kind: 'missing' }
  return resolveWorkspacePaneTabTargetForBranch(repoId, repo.ui.selectedBranch)
}

export function workspacePaneTabTargetForBranch(repoId: string, branchName: string): RepoWorkspaceTabModel | null {
  const resolution = resolveWorkspacePaneTabTargetForBranch(repoId, branchName)
  return resolution.kind === 'ready' ? resolution.target : null
}

export function resolveWorkspacePaneTabTargetForBranch(
  repoId: string,
  branchName: string,
): WorkspacePaneTabTargetResolution {
  const state = useReposStore.getState()
  const repo = state.repos[repoId]
  if (!repo) return { kind: 'missing' }
  const branchModel = readRepoBranchQueryProjection(repo)
  if (!branchModel) return { kind: 'unavailable', reason: 'branch-read-model-unavailable' }
  const branch = branchModel.branches.find((candidate) => candidate.name === branchName)
  if (!branch) return { kind: 'missing' }
  const worktreePath = branch.worktree?.path
  const terminalSyncReady = useRepoSyncStore.getState().ready.get(repoId) === repo.instanceId
  const terminalWorktreeKey = worktreePath ? formatTerminalWorktreeKey(repo.id, worktreePath) : null
  const snapshot = terminalWorktreeKey
    ? (readTerminalSessionCommandBridge()?.terminalWorktreeSnapshot(terminalWorktreeKey) ?? null)
    : null
  return {
    kind: 'ready',
    target: createRepoWorkspaceTabModel({
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
    }),
  }
}
