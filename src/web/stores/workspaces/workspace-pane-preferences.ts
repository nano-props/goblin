import {
  gitWorktreeWorkspacePaneTabsTarget,
  type WorkspacePaneTabsTarget,
  workspacePaneTabsTargetIdentityKey,
} from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspaceUiState } from '#/web/stores/workspaces/types.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export const INITIAL_WORKSPACE_PANE_TAB: WorkspacePaneTabType = 'status'

interface WorkspacePaneTargetBranches {
  workspaceId: WorkspaceId
  branches: ReadonlyArray<{ name: string; worktree?: { path?: string } | undefined }>
}

export function workspacePaneTabsTargetForRepoBranch(
  repo: WorkspacePaneTargetBranches,
  branchName: string | null | undefined,
): WorkspacePaneTabsTarget | null {
  if (!branchName) return null
  const branch = repo.branches.find((candidate) => candidate.name === branchName)
  if (!branch) return null
  if (!branch.worktree?.path) {
    return { kind: 'git-branch', workspaceId: repo.workspaceId, branchName: branch.name }
  }
  return gitWorktreeWorkspacePaneTabsTarget(repo.workspaceId, branch.worktree.path)
}

export function preferredWorkspacePaneTabForTarget(
  ui: Pick<WorkspaceUiState, 'preferredWorkspacePaneTabByTarget'>,
  target: WorkspacePaneTabsTarget | null | undefined,
): WorkspacePaneTabType | null {
  if (!target) return null
  const targetKey = workspacePaneTabsTargetIdentityKey(target)
  return Object.hasOwn(ui.preferredWorkspacePaneTabByTarget, targetKey)
    ? ui.preferredWorkspacePaneTabByTarget[targetKey]
    : INITIAL_WORKSPACE_PANE_TAB
}

export function preferredWorkspacePaneTabByTargetRecordWith(
  ui: Pick<WorkspaceUiState, 'preferredWorkspacePaneTabByTarget'>,
  target: WorkspacePaneTabsTarget,
  view: WorkspacePaneTabType | null,
): Record<string, WorkspacePaneTabType | null> {
  return {
    ...ui.preferredWorkspacePaneTabByTarget,
    [workspacePaneTabsTargetIdentityKey(target)]: view,
  }
}
