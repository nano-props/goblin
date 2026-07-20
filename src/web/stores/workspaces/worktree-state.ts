import { omit } from 'es-toolkit'
import type { BranchSnapshotInfo, WorktreeStatus } from '#/web/types.ts'
import type { RepoBranchState, RepoWorktreeState } from '#/web/stores/workspaces/types.ts'
import type { RepoBranchReadModelData } from '#/web/repo-branch-read-model.ts'
interface BranchWorktreeState {
  path: string
  dirty: boolean
  changeCount: number
  known: boolean
  isMain: boolean
  isLocked: boolean
}

export interface BranchWorktreeRepo {
  branchModel: Pick<RepoBranchReadModelData, 'worktreesByPath' | 'status'>
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

export function worktreeStatesFromBranchReadModel(
  branches: BranchSnapshotInfo[],
  status: WorktreeStatus[],
): Record<string, RepoWorktreeState> {
  const statusByPath = new Map(status.map((wt) => [wt.path, wt]))
  const next: Record<string, RepoWorktreeState> = {}
  for (const branch of branches) {
    const snapshotWorktree = branch.worktree
    if (!snapshotWorktree) continue
    const statusEntry = statusByPath.get(snapshotWorktree.path)
    const statusCount = statusEntry?.entries.length
    next[snapshotWorktree.path] = {
      path: snapshotWorktree.path,
      branch: statusEntry?.branch ?? branch.name,
      isMain: snapshotWorktree.isPrimary ?? statusEntry?.isMain ?? false,
      isDirty: statusCount === undefined ? false : statusCount > 0,
      changeCount: statusCount ?? 0,
      isLocked: snapshotWorktree.isLocked,
    }
  }
  // The status snapshot comes from the complete authoritative `git worktree
  // list`, whereas the branch projection necessarily omits detached HEADs.
  // Preserve those filesystem members in the worktree catalog instead of
  // making UI reachability depend on an associated branch.
  for (const statusEntry of status) {
    if (next[statusEntry.path]) continue
    next[statusEntry.path] = {
      path: statusEntry.path,
      branch: statusEntry.branch,
      isMain: statusEntry.isMain,
      isDirty: statusEntry.entries.length > 0,
      changeCount: statusEntry.entries.length,
    }
  }
  return next
}

export function stripBranchWorktreeMetadata(branches: BranchSnapshotInfo[]): RepoBranchState[] {
  return branches.map((branch) => {
    const worktree = branch.worktree
    const rest = omit(branch, ['worktree', 'pullRequest'])
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

export function getBranchWorktreeState(repo: BranchWorktreeRepo, branch: RepoBranchState): BranchWorktreeState | null {
  if (!branch.worktree) return null
  const worktree = repo.branchModel.worktreesByPath[branch.worktree.path]
  const status = repo.branchModel.status.find((wt) => wt.path === branch.worktree?.path)
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

export function selectedBranchStatus(repo: BranchWorktreeRepo, branch: RepoBranchState | null): WorktreeStatus[] {
  return branch?.worktree ? repo.branchModel.status.filter((wt) => wt.path === branch.worktree?.path) : []
}

/**
 * Whether the branch's worktree currently has uncommitted changes
 * worth surfacing. Centralises the dirty-state derivation so the
 * status tab, keyboard shortcut, and toolbar all agree on the
 * answer — and stay in sync if the derivation precedence changes.
 */
export function branchWorktreeHasChanges(repo: BranchWorktreeRepo, branch: RepoBranchState): boolean {
  return (getBranchWorktreeState(repo, branch)?.changeCount ?? 0) > 0
}
