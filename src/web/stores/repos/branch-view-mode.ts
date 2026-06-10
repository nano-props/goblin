import type { BranchViewMode, RepoBranchState, RepoState } from '#/web/stores/repos/types.ts'
interface BranchSelectionInput {
  branches: RepoBranchState[]
  currentBranch: string
  selectedBranch: string | null
  viewMode: BranchViewMode
}

interface VisibleBranchesInput {
  branches: RepoBranchState[]
  viewMode: BranchViewMode
  searchQuery?: string
  worktreePathOrder?: string[]
}

export function branchMatchesViewMode(branch: RepoBranchState, viewMode: BranchViewMode): boolean {
  if (viewMode === 'worktrees') return !!branch.worktree?.path
  if (viewMode === 'no-worktree') return !branch.worktree?.path
  return true
}

export function branchMatchesSearchQuery(branch: RepoBranchState, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return needle.length === 0 || branch.name.toLowerCase().includes(needle)
}

export function normalizeWorktreePathOrder(order: string[] = [], currentPaths: string[]): string[] {
  const current = new Set(currentPaths)
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const path of order) {
    if (!current.has(path) || seen.has(path)) continue
    seen.add(path)
    normalized.push(path)
  }
  for (const path of currentPaths) {
    if (seen.has(path)) continue
    seen.add(path)
    normalized.push(path)
  }
  return normalized
}

function branchWorktreePath(branch: RepoBranchState): string | null {
  return branch.worktree?.path ?? null
}

function orderWorktreeBranches(branches: RepoBranchState[], order: string[] = []): RepoBranchState[] {
  const worktreePaths = branches.map(branchWorktreePath).filter((path): path is string => !!path)
  const normalized = normalizeWorktreePathOrder(order, worktreePaths)
  const indexByPath = new Map(normalized.map((path, index) => [path, index]))
  return [...branches].sort((a, b) => {
    const aPath = branchWorktreePath(a)
    const bPath = branchWorktreePath(b)
    const aIndex = aPath ? indexByPath.get(aPath) : undefined
    const bIndex = bPath ? indexByPath.get(bPath) : undefined
    if (aIndex === undefined && bIndex === undefined) return 0
    if (aIndex === undefined) return 1
    if (bIndex === undefined) return -1
    return aIndex - bIndex
  })
}

export function visibleBranches({
  branches,
  viewMode,
  searchQuery = '',
  worktreePathOrder = [],
}: VisibleBranchesInput): RepoBranchState[] {
  const filtered = branches.filter(
    (branch) => branchMatchesViewMode(branch, viewMode) && branchMatchesSearchQuery(branch, searchQuery),
  )
  if (viewMode === 'no-worktree') return filtered
  return orderWorktreeBranches(filtered, worktreePathOrder)
}

export function selectedBranchForBranchSet({
  branches,
  currentBranch,
  selectedBranch,
  viewMode,
}: BranchSelectionInput): string | null {
  const visible = branches.filter((branch) => branchMatchesViewMode(branch, viewMode))
  if (selectedBranch && visible.some((branch) => branch.name === selectedBranch)) return selectedBranch
  return visible.find((branch) => branch.name === currentBranch)?.name ?? visible[0]?.name ?? null
}

export function selectedBranchForViewMode(repo: RepoState, viewMode: BranchViewMode): string | null {
  return selectedBranchForBranchSet({
    branches: repo.data.branches,
    currentBranch: repo.data.currentBranch,
    selectedBranch: repo.ui.selectedBranch,
    viewMode,
  })
}

export function branchForVisibleLog(repo: RepoState): string | null {
  return repo.ui.selectedBranch ?? (repo.ui.branchViewMode === 'all' ? repo.data.currentBranch : null)
}
