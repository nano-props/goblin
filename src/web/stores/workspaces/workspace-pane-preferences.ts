import {
  gitWorktreeWorkspacePaneTabsTarget,
  type WorkspacePaneTabsTarget,
  workspacePaneTabsTargetIdentityKey,
} from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { repoWorktreeForBranch } from '#/shared/git-types.ts'
import type { RepoWorktreeSnapshot } from '#/shared/git-types.ts'

export const INITIAL_WORKSPACE_PANE_TAB: WorkspacePaneTabType = 'status'

export interface WorkspacePanePreferenceState {
  preferredWorkspacePaneTabByTarget: Record<string, WorkspacePaneTabType | null>
}

interface WorkspacePaneTargetBranches {
  workspaceId: WorkspaceId
  branches: ReadonlyArray<{ name: string }>
  worktrees: readonly RepoWorktreeSnapshot[]
}

export function workspacePaneTabsTargetForRepoBranch(
  repo: WorkspacePaneTargetBranches,
  branchName: string | null | undefined,
): WorkspacePaneTabsTarget | null {
  if (!branchName) return null
  const branch = repo.branches.find((candidate) => candidate.name === branchName)
  if (!branch) return null
  const worktree = repoWorktreeForBranch(repo.worktrees, branch.name)
  if (!worktree) {
    return { kind: 'git-branch', workspaceId: repo.workspaceId, branchName: branch.name }
  }
  return gitWorktreeWorkspacePaneTabsTarget(repo.workspaceId, worktree.path)
}

export function preferredWorkspacePaneTabForTarget(
  ui: WorkspacePanePreferenceState,
  target: WorkspacePaneTabsTarget | null | undefined,
): WorkspacePaneTabType | null {
  if (!target) return null
  const targetKey = workspacePaneTabsTargetIdentityKey(target)
  return Object.hasOwn(ui.preferredWorkspacePaneTabByTarget, targetKey)
    ? ui.preferredWorkspacePaneTabByTarget[targetKey]
    : INITIAL_WORKSPACE_PANE_TAB
}

export function preferredWorkspacePaneTabByTargetRecordWith(
  ui: WorkspacePanePreferenceState,
  target: WorkspacePaneTabsTarget,
  view: WorkspacePaneTabType | null,
): Record<string, WorkspacePaneTabType | null> {
  return {
    ...ui.preferredWorkspacePaneTabByTarget,
    [workspacePaneTabsTargetIdentityKey(target)]: view,
  }
}
