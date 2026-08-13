import type { BranchViewMode } from '#/shared/api-types.ts'
import type { BranchSnapshotInfo, RepoWorktreeSnapshot } from '#/shared/git-types.ts'
import { repoWorktreeForBranch } from '#/shared/git-types.ts'
import { visibleBranches } from '#/web/stores/workspaces/branch-view-mode.ts'

export type GitWorkspaceNavigatorRow =
  | { kind: 'branch'; branch: BranchSnapshotInfo }
  | { kind: 'worktree'; worktree: RepoWorktreeSnapshot; branch: BranchSnapshotInfo | null }

export type GitWorkspaceNavigatorRowIdentity =
  { kind: 'branch'; branchName: string } | { kind: 'worktree'; worktreePath: string }

interface GitWorkspaceNavigatorRowsInput {
  branches: BranchSnapshotInfo[]
  worktrees: readonly RepoWorktreeSnapshot[]
  viewMode: BranchViewMode
}

export function gitWorkspaceNavigatorRows({
  branches,
  worktrees,
  viewMode,
}: GitWorkspaceNavigatorRowsInput): GitWorkspaceNavigatorRow[] {
  const renderedWorktrees = new Set<string>()
  const rows = visibleBranches({ branches, worktrees, viewMode }).map((branch): GitWorkspaceNavigatorRow => {
    const worktree = repoWorktreeForBranch(worktrees, branch.name)
    if (!worktree) return { kind: 'branch', branch }
    renderedWorktrees.add(worktree.path)
    return { kind: 'worktree', worktree, branch }
  })

  for (const worktree of worktrees) {
    if (renderedWorktrees.has(worktree.path)) continue
    rows.push({ kind: 'worktree', worktree, branch: null })
  }

  return rows
}

export function gitWorkspaceNavigatorRowIdentity(row: GitWorkspaceNavigatorRow): GitWorkspaceNavigatorRowIdentity {
  return row.kind === 'branch'
    ? { kind: 'branch', branchName: row.branch.name }
    : { kind: 'worktree', worktreePath: row.worktree.path }
}

export function gitWorkspaceNavigatorRowMatchesIdentity(
  row: GitWorkspaceNavigatorRow,
  identity: GitWorkspaceNavigatorRowIdentity,
): boolean {
  const rowIdentity = gitWorkspaceNavigatorRowIdentity(row)
  if (rowIdentity.kind === 'branch') {
    return identity.kind === 'branch' && rowIdentity.branchName === identity.branchName
  }
  return identity.kind === 'worktree' && rowIdentity.worktreePath === identity.worktreePath
}
