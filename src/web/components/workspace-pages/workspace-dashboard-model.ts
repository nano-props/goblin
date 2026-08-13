import type { PullRequestEntry, RepoSnapshot } from '#/shared/api-types.ts'
import { repoWorktreeForBranch } from '#/shared/git-types.ts'
import type { BranchSnapshotInfo, WorktreeStatus } from '#/shared/git-types.ts'

export interface DashboardBranchItem {
  branch: BranchSnapshotInfo
  dirty: boolean | undefined
  pullRequest?: PullRequestEntry['pullRequest']
}

export interface DashboardSummary {
  branchCount: number
  worktreeCount: number
  dirtyWorktreeCount: number | undefined
  aheadCount: number
  behindCount: number
  openPullRequestCount: number | undefined
  attentionBranches: DashboardBranchItem[]
  recentBranches: DashboardBranchItem[]
}

export interface DashboardRepositoryFacts {
  snapshot: RepoSnapshot
  status: WorktreeStatus[] | undefined
}

export type DashboardPullRequestState = 'pending' | 'unavailable' | 'error' | 'empty' | 'ready' | 'stale'

export function buildDashboardSummary(
  branchModel: DashboardRepositoryFacts,
  pullRequestEntries: PullRequestEntry[] | null | undefined,
): DashboardSummary {
  const branches = branchModel.snapshot.branches
  const worktrees = branchModel.snapshot.worktrees
  const pullRequestsByBranch = new Map(pullRequestEntries?.map((entry) => [entry.branch, entry.pullRequest]) ?? [])
  const branchItems = branches.map((branch) => buildDashboardBranchItem(branchModel, pullRequestsByBranch, branch))
  const statusByWorktreePath = branchModel.status
    ? new Map(branchModel.status.map((status) => [status.path, status]))
    : null
  const dirtyWorktreeCount =
    statusByWorktreePath && worktrees.every((worktree) => statusByWorktreePath.has(worktree.path))
      ? worktrees.filter((worktree) => statusByWorktreePath.get(worktree.path)!.entries.length > 0).length
      : undefined
  const aheadCount = branches.filter((branch) => branch.ahead > 0).length
  const behindCount = branches.filter((branch) => branch.behind > 0).length
  const openPullRequestCount = pullRequestEntries
    ? [...pullRequestsByBranch.values()].filter((pullRequest) => pullRequest.state === 'open').length
    : undefined
  const attentionBranches = branchItems
    .filter(
      ({ branch, dirty, pullRequest }) =>
        !!branch.trackingGone || branch.behind > 0 || branch.ahead > 0 || dirty || pullRequest?.checks?.failing,
    )
    .sort(compareBranchesForAttention)
    .slice(0, 6)
  const recentBranches = [...branchItems].sort(compareBranchesByCommitDate).slice(0, 8)

  return {
    branchCount: branches.length,
    worktreeCount: worktrees.length,
    dirtyWorktreeCount,
    aheadCount,
    behindCount,
    openPullRequestCount,
    attentionBranches,
    recentBranches,
  }
}

function buildDashboardBranchItem(
  branchModel: DashboardRepositoryFacts,
  pullRequestsByBranch: Map<string, PullRequestEntry['pullRequest']>,
  branch: BranchSnapshotInfo,
): DashboardBranchItem {
  return {
    branch,
    dirty: branchWorktreeDirty(branchModel, branch),
    pullRequest: pullRequestsByBranch.get(branch.name),
  }
}

function compareBranchesByCommitDate(a: DashboardBranchItem, b: DashboardBranchItem) {
  return Date.parse(b.branch.lastCommitDate) - Date.parse(a.branch.lastCommitDate)
}

function compareBranchesForAttention(a: DashboardBranchItem, b: DashboardBranchItem) {
  return branchAttentionScore(b) - branchAttentionScore(a) || compareBranchesByCommitDate(a, b)
}

function branchAttentionScore({ branch, dirty, pullRequest }: DashboardBranchItem) {
  return (
    (branch.trackingGone ? 100 : 0) +
    (dirty ? 40 : 0) +
    Math.min(branch.behind, 20) * 3 +
    Math.min(branch.ahead, 20) * 2 +
    (pullRequest?.checks?.failing ?? 0) * 8
  )
}

function branchWorktreeDirty(branchModel: DashboardRepositoryFacts, branch: BranchSnapshotInfo): boolean | undefined {
  const worktreePath = repoWorktreeForBranch(branchModel.snapshot.worktrees, branch.name)?.path
  if (!worktreePath) return false
  const status = branchModel.status?.find((wt) => wt.path === worktreePath)
  return status ? status.entries.length > 0 : undefined
}
