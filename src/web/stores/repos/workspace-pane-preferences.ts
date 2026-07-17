import {
  parseWorkspacePaneTabsTargetIdentityKey,
  type WorkspacePaneTabsTarget,
  workspacePaneTabsTargetIdentityKey,
} from '#/shared/workspace-pane-tabs-target.ts'
import type { RepoUiState } from '#/web/stores/repos/types.ts'
import type { WorkspacePaneTabType } from '#/shared/workspace-pane.ts'

export const INITIAL_WORKSPACE_PANE_TAB: WorkspacePaneTabType = 'status'

interface WorkspacePaneTargetBranches {
  repoRoot: string
  branches: ReadonlyArray<{ name: string; worktree?: { path?: string } | undefined }>
}

export function workspacePaneTabsTargetForRepoBranch(
  repo: WorkspacePaneTargetBranches,
  branchName: string | null | undefined,
): WorkspacePaneTabsTarget | null {
  if (!branchName) return null
  const branch = repo.branches.find((candidate) => candidate.name === branchName)
  if (!branch) return null
  return {
    repoRoot: repo.repoRoot,
    branchName: branch.name,
    worktreePath: branch.worktree?.path ?? null,
  }
}

export function workspacePaneTabsTargetForRepoTargetKey(
  repo: WorkspacePaneTargetBranches,
  targetKey: string,
): WorkspacePaneTabsTarget | null {
  const target = parseWorkspacePaneTabsTargetIdentityKey(targetKey)
  if (!target || target.repoRoot !== repo.repoRoot) return null
  if (target.kind === 'workspace-root') {
    return { kind: 'workspace-root', repoRoot: repo.repoRoot, branchName: null, worktreePath: null }
  }
  if (target.kind === 'branch') {
    return repo.branches.some((branch) => branch.name === target.branchName)
      ? { repoRoot: repo.repoRoot, branchName: target.branchName, worktreePath: null }
      : null
  }
  const branch = repo.branches.find((candidate) => candidate.worktree?.path === target.worktreePath)
  return branch
    ? {
        repoRoot: repo.repoRoot,
        branchName: branch.name,
        worktreePath: target.worktreePath,
      }
    : null
}

export function preferredWorkspacePaneTabForTarget(
  ui: Pick<RepoUiState, 'preferredWorkspacePaneTabByTarget'>,
  target: WorkspacePaneTabsTarget | null | undefined,
): WorkspacePaneTabType | null {
  if (!target) return null
  const targetKey = workspacePaneTabsTargetIdentityKey(target)
  return Object.hasOwn(ui.preferredWorkspacePaneTabByTarget, targetKey)
    ? ui.preferredWorkspacePaneTabByTarget[targetKey]
    : INITIAL_WORKSPACE_PANE_TAB
}

export function preferredWorkspacePaneTabByTargetRecordWith(
  ui: Pick<RepoUiState, 'preferredWorkspacePaneTabByTarget'>,
  target: WorkspacePaneTabsTarget,
  view: WorkspacePaneTabType | null,
): Record<string, WorkspacePaneTabType | null> {
  return {
    ...ui.preferredWorkspacePaneTabByTarget,
    [workspacePaneTabsTargetIdentityKey(target)]: view,
  }
}
