import type { BranchSnapshotInfo, WorktreeStatus } from '#/web/types.ts'
import type { RepoBranchState, RepoState, RepoWorktreeState } from '#/web/stores/repos/types.ts'
export interface BranchWorktreeState {
  path: string
  dirty: boolean
  changeCount: number
  known: boolean
  isMain: boolean
  isLocked: boolean
}

export function worktreeStatesFromBranches(
  branches: BranchSnapshotInfo[],
  previous: Record<string, RepoWorktreeState> = {},
  status: WorktreeStatus[] = [],
): Record<string, RepoWorktreeState> {
  const statusByPath = new Map(status.map((wt) => [wt.path, wt]))
  const next: Record<string, RepoWorktreeState> = {}
  for (const branch of branches) {
    const snapshotWorktree = branch.worktree
    if (!snapshotWorktree) continue
    const prev = previous[snapshotWorktree.path]
    const statusEntry = statusByPath.get(snapshotWorktree.path)
    const statusCount = statusEntry?.entries.length
    const snapshotSummary = snapshotWorktree.summary
    const changeCount = statusCount ?? snapshotSummary?.changeCount ?? prev?.changeCount
    const isDirty = statusCount === undefined ? (snapshotSummary?.dirty ?? prev?.isDirty) : statusCount > 0
    next[snapshotWorktree.path] = {
      path: snapshotWorktree.path,
      branch: statusEntry?.branch ?? branch.name,
      isMain: snapshotWorktree.isPrimary ?? statusEntry?.isMain ?? prev?.isMain ?? false,
      isDirty,
      changeCount,
      isLocked: snapshotWorktree.isLocked ?? prev?.isLocked,
    }
  }
  return next
}

export function stripBranchWorktreeMetadata(branches: BranchSnapshotInfo[]): RepoBranchState[] {
  return branches.map((branch) => {
    const { worktree, ...rest } = branch
    if (!worktree) return rest
    return { ...rest, worktree: { path: worktree.path } }
  })
}

export function applyStatusToWorktreeStates(
  previous: Record<string, RepoWorktreeState>,
  status: WorktreeStatus[],
): Record<string, RepoWorktreeState> {
  const next = { ...previous }
  for (const wt of status) {
    const prev = previous[wt.path]
    const changeCount = wt.entries.length
    next[wt.path] = {
      path: wt.path,
      branch: wt.branch ?? prev?.branch,
      isMain: wt.isMain,
      isDirty: changeCount > 0,
      changeCount,
      isLocked: prev?.isLocked,
    }
  }
  return next
}

export function getBranchWorktreeState(repo: RepoState, branch: RepoBranchState): BranchWorktreeState | null {
  if (!branch.worktree) return null
  const worktree = repo.data.worktreesByPath[branch.worktree.path]
  const status = repo.data.status.find((wt) => wt.path === branch.worktree?.path)
  const statusChangeCount = status?.entries.length
  const dirty = statusChangeCount === undefined ? (worktree?.isDirty ?? false) : statusChangeCount > 0
  const changeCount = statusChangeCount ?? worktree?.changeCount ?? (dirty ? 1 : 0)
  return {
    path: branch.worktree.path,
    dirty,
    changeCount,
    known: status !== undefined || worktree?.isDirty !== undefined || changeCount > 0,
    isMain: worktree?.isMain ?? false,
    isLocked: worktree?.isLocked ?? false,
  }
}

export function selectedBranchStatus(repo: RepoState, branch: RepoBranchState | null): WorktreeStatus[] {
  return branch?.worktree ? repo.data.status.filter((wt) => wt.path === branch.worktree?.path) : []
}
