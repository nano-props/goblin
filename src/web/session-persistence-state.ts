import type { DetailTab } from '#/shared/rpc.ts'

export function persistedActiveRepoIdForSession(activeId: string | null): string | null {
  return activeId
}

export function persistedDetailTabByRepoForSession(
  repos: Record<string, { ui: { detailTab: DetailTab } } | undefined>,
  order: string[],
): Record<string, DetailTab> {
  const tabs: Record<string, DetailTab> = {}
  for (const id of order) {
    const repo = repos[id]
    if (repo) tabs[id] = repo.ui.detailTab
  }
  return tabs
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
