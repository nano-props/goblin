import {
  isWorkspacePaneBranchViewType,
  isWorkspacePaneSessionViewType,
  type WorkspacePaneBranchViewType,
  type WorkspacePaneSessionView,
  type WorkspacePaneView,
} from '#/shared/workspace-pane.ts'

export function persistedActiveRepoIdForSession(activeId: string | null): string | null {
  return activeId
}

export function persistedPreferredWorkspacePaneViewByBranchByRepoForSession(
  repos: Record<
    string,
    | {
        data?: { branches?: Array<{ name?: string }> }
        ui: {
          openBranchWorkspacePaneViewsByBranch: Record<string, WorkspacePaneBranchViewType[]>
          preferredWorkspacePaneViewByBranch: Record<string, WorkspacePaneView>
        }
      }
    | undefined
  >,
  order: string[],
): Record<string, Record<string, WorkspacePaneSessionView>> {
  const byRepo: Record<string, Record<string, WorkspacePaneSessionView>> = {}
  for (const id of order) {
    const repo = repos[id]
    if (!repo) continue
    const knownBranches = new Set((repo.data?.branches ?? []).map((branch) => branch.name).filter(Boolean))
    const byBranch: Record<string, WorkspacePaneSessionView> = {}
    for (const [branchName, tab] of Object.entries(repo.ui.preferredWorkspacePaneViewByBranch)) {
      if (!branchName || branchName.includes('\0')) continue
      if (knownBranches.size > 0 && !knownBranches.has(branchName)) continue
      if (!isWorkspacePaneSessionViewType(tab)) continue
      if (
        isWorkspacePaneBranchViewType(tab) &&
        !normalizedBranchWorkspacePaneViews(repo.ui.openBranchWorkspacePaneViewsByBranch[branchName] ?? []).includes(tab)
      )
        continue
      byBranch[branchName] = tab
    }
    if (Object.keys(byBranch).length > 0) byRepo[id] = byBranch
  }
  return byRepo
}

export function persistedOpenBranchWorkspacePaneViewsByBranchByRepoForSession(
  repos: Record<
    string,
    | {
        data?: { branches?: Array<{ name?: string }> }
        ui: { openBranchWorkspacePaneViewsByBranch: Record<string, WorkspacePaneBranchViewType[]> }
      }
    | undefined
  >,
  order: string[],
): Record<string, Record<string, WorkspacePaneBranchViewType[]>> {
  const byRepo: Record<string, Record<string, WorkspacePaneBranchViewType[]>> = {}
  for (const id of order) {
    const repo = repos[id]
    if (!repo) continue
    const knownBranches = new Set((repo.data?.branches ?? []).map((branch) => branch.name).filter(Boolean))
    const byBranch: Record<string, WorkspacePaneBranchViewType[]> = {}
    for (const [branchName, views] of Object.entries(repo.ui.openBranchWorkspacePaneViewsByBranch)) {
      if (!branchName || branchName.includes('\0')) continue
      if (knownBranches.size > 0 && !knownBranches.has(branchName)) continue
      byBranch[branchName] = normalizedBranchWorkspacePaneViews(views)
    }
    if (Object.keys(byBranch).length > 0) byRepo[id] = byBranch
  }
  return byRepo
}

export function persistedSelectedTerminalByWorktreeForSession(
  selectedTerminalByWorktree: Record<string, string>,
  repos: Record<string, { data?: { branches?: Array<{ worktree?: { path?: string } | undefined }> } } | undefined>,
): Record<string, string> {
  const persisted: Record<string, string> = {}
  for (const [worktreeKey, key] of Object.entries(selectedTerminalByWorktree)) {
    const parts = worktreeKey.split('\0')
    if (parts.length !== 2) continue
    const [repoRoot, worktreePath] = parts
    if (!repoRoot || !worktreePath || !key.startsWith(`${worktreeKey}\0`)) continue
    const repo = repos[repoRoot]
    if (!repo?.data?.branches?.some((branch) => branch.worktree?.path === worktreePath)) continue
    persisted[worktreeKey] = key
  }
  return persisted
}

function normalizedBranchWorkspacePaneViews(
  views: readonly WorkspacePaneBranchViewType[],
): WorkspacePaneBranchViewType[] {
  const next: WorkspacePaneBranchViewType[] = []
  for (const view of views) {
    if (!isWorkspacePaneBranchViewType(view)) continue
    if (!next.includes(view)) next.push(view)
  }
  return next
}
