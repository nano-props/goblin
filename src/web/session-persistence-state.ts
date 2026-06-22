import type { WorkspacePaneView } from '#/shared/workspace-pane.ts'

export function persistedActiveRepoIdForSession(activeId: string | null): string | null {
  return activeId
}

export function persistedWorkspacePaneViewByBranchByRepoForSession(
  repos: Record<
    string,
    | {
        data?: { branches?: Array<{ name?: string }> }
        ui: { preferredWorkspacePaneViewByBranch: Record<string, WorkspacePaneView> }
      }
    | undefined
  >,
  order: string[],
): Record<string, Record<string, WorkspacePaneView>> {
  const byRepo: Record<string, Record<string, WorkspacePaneView>> = {}
  for (const id of order) {
    const repo = repos[id]
    if (!repo) continue
    const knownBranches = new Set((repo.data?.branches ?? []).map((branch) => branch.name).filter(Boolean))
    const byBranch: Record<string, WorkspacePaneView> = {}
    for (const [branchName, tab] of Object.entries(repo.ui.preferredWorkspacePaneViewByBranch)) {
      if (!branchName || branchName.includes('\0')) continue
      if (knownBranches.size > 0 && !knownBranches.has(branchName)) continue
      byBranch[branchName] = tab
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
