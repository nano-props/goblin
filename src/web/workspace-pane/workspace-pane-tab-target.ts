import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import { createRepoWorkspaceTabModel, type RepoWorkspaceTabModel } from '#/web/components/repo-workspace/tab-model.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'

export type WorkspacePaneTabTargetResolution =
  | { kind: 'ready'; target: RepoWorkspaceTabModel }
  | { kind: 'missing' }
  | { kind: 'unavailable'; reason: 'branch-read-model-unavailable' }

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
  const terminalProjectionHydration = useTerminalProjectionHydrationStore.getState().hydrationByRepo.get(repoId)
  const currentTerminalProjectionHydration =
    terminalProjectionHydration?.instanceId === repo.instanceId ? terminalProjectionHydration : null
  const terminalProjectionPhase = currentTerminalProjectionHydration?.phase ?? 'pending'
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
      terminalProjectionPhase,
      terminalProjectionErrorMessage: currentTerminalProjectionHydration?.errorMessage,
      selectedTerminalSessionId: terminalWorktreeKey
        ? (state.selectedTerminalSessionIdByTerminalWorktree[terminalWorktreeKey] ?? null)
        : null,
    }),
  }
}
