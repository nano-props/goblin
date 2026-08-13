import type { BranchViewMode } from '#/shared/api-types.ts'
import type { BranchSnapshotInfo, RepoWorktreeSnapshot } from '#/shared/git-types.ts'
import { repoWorktreeForBranch } from '#/shared/git-types.ts'
import { visibleBranches } from '#/web/stores/workspaces/branch-view-mode.ts'

export type BranchNavigatorRow =
  | { kind: 'branch'; branch: BranchSnapshotInfo }
  | { kind: 'worktree'; worktree: RepoWorktreeSnapshot; branch: BranchSnapshotInfo | null }

export type BranchNavigatorRowIdentity =
  { kind: 'branch'; branchName: string } | { kind: 'worktree'; worktreePath: string }

interface BranchNavigatorRowsInput {
  branches: BranchSnapshotInfo[]
  worktrees: readonly RepoWorktreeSnapshot[]
  viewMode: BranchViewMode
}

export function branchNavigatorRows({ branches, worktrees, viewMode }: BranchNavigatorRowsInput): BranchNavigatorRow[] {
  const renderedWorktrees = new Set<string>()
  const rows = visibleBranches({ branches, worktrees, viewMode }).map((branch): BranchNavigatorRow => {
    const worktree = repoWorktreeForBranch(worktrees, branch.name)
    if (!worktree) return { kind: 'branch', branch }
    renderedWorktrees.add(worktree.path)
    return { kind: 'worktree', worktree, branch }
  })

  for (const worktree of worktrees) {
    if (renderedWorktrees.has(worktree.path)) continue
    if (worktree.head.kind === 'branch' && worktree.operation === null) continue
    rows.push({ kind: 'worktree', worktree, branch: null })
  }

  return rows
}

export function branchNavigatorRowIdentity(row: BranchNavigatorRow): BranchNavigatorRowIdentity {
  return row.kind === 'branch'
    ? { kind: 'branch', branchName: row.branch.name }
    : { kind: 'worktree', worktreePath: row.worktree.path }
}

export function branchNavigatorRowMatchesIdentity(
  row: BranchNavigatorRow,
  identity: BranchNavigatorRowIdentity,
): boolean {
  const rowIdentity = branchNavigatorRowIdentity(row)
  if (rowIdentity.kind === 'branch') {
    return identity.kind === 'branch' && rowIdentity.branchName === identity.branchName
  }
  return identity.kind === 'worktree' && rowIdentity.worktreePath === identity.worktreePath
}
