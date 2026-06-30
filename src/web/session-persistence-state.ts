import {
  isWorkspacePaneStaticTabType,
  isWorkspacePaneSessionTabType,
  type WorkspacePaneSessionTabType,
  type WorkspacePaneTabEntry,
  type WorkspacePaneTabType,
} from '#/shared/workspace-pane.ts'
import { normalizeWorkspacePaneTabs } from '#/web/stores/repos/workspace-pane-tabs.ts'

export function persistedActiveRepoIdForSession(activeId: string | null): string | null {
  return activeId
}

export function persistedPreferredWorkspacePaneTabByBranchByRepoForSession(
  repos: Record<
    string,
    | {
        data?: { branches?: Array<{ name?: string }> }
        ui: {
          workspacePaneTabsByBranch: Record<string, WorkspacePaneTabEntry[]>
          preferredWorkspacePaneTabByBranch: Record<string, WorkspacePaneTabType>
        }
      }
    | undefined
  >,
  order: string[],
): Record<string, Record<string, WorkspacePaneSessionTabType>> {
  const byRepo: Record<string, Record<string, WorkspacePaneSessionTabType>> = {}
  for (const id of order) {
    const repo = repos[id]
    if (!repo) continue
    const knownBranches = new Set((repo.data?.branches ?? []).map((branch) => branch.name).filter(Boolean))
    const byBranch: Record<string, WorkspacePaneSessionTabType> = {}
    for (const [branchName, tab] of Object.entries(repo.ui.preferredWorkspacePaneTabByBranch)) {
      if (!branchName || branchName.includes('\0')) continue
      if (knownBranches.size > 0 && !knownBranches.has(branchName)) continue
      if (!isWorkspacePaneSessionTabType(tab)) continue
      if (
        isWorkspacePaneStaticTabType(tab) &&
        !workspacePaneStaticTabsFromEntries(repo.ui.workspacePaneTabsByBranch[branchName] ?? []).includes(tab)
      )
        continue
      byBranch[branchName] = tab
    }
    if (Object.keys(byBranch).length > 0) byRepo[id] = byBranch
  }
  return byRepo
}

export function persistedWorkspacePaneTabsByBranchByRepoForSession(
  repos: Record<
    string,
    | {
        data?: { branches?: Array<{ name?: string }> }
        ui: { workspacePaneTabsByBranch: Record<string, WorkspacePaneTabEntry[]> }
      }
    | undefined
  >,
  order: string[],
): Record<string, Record<string, WorkspacePaneTabEntry[]>> {
  const byRepo: Record<string, Record<string, WorkspacePaneTabEntry[]>> = {}
  for (const id of order) {
    const repo = repos[id]
    if (!repo) continue
    const knownBranches = new Set((repo.data?.branches ?? []).map((branch) => branch.name).filter(Boolean))
    const byBranch: Record<string, WorkspacePaneTabEntry[]> = {}
    for (const [branchName, tabs] of Object.entries(repo.ui.workspacePaneTabsByBranch)) {
      if (!branchName || branchName.includes('\0')) continue
      if (knownBranches.size > 0 && !knownBranches.has(branchName)) continue
      byBranch[branchName] = normalizeWorkspacePaneTabs(tabs)
    }
    if (Object.keys(byBranch).length > 0) byRepo[id] = byBranch
  }
  return byRepo
}

export function persistedSelectedTerminalSessionIdByTerminalWorktreeForSession(
  selectedTerminalSessionIdByTerminalWorktree: Record<string, string>,
  repos: Record<string, { data?: { branches?: Array<{ worktree?: { path?: string } | undefined }> } } | undefined>,
): Record<string, string> {
  const persisted: Record<string, string> = {}
  for (const [terminalWorktreeKey, terminalSessionId] of Object.entries(selectedTerminalSessionIdByTerminalWorktree)) {
    const parts = terminalWorktreeKey.split('\0')
    if (parts.length !== 2) continue
    const [repoRoot, worktreePath] = parts
    if (!repoRoot || !worktreePath || !terminalSessionId) continue
    const repo = repos[repoRoot]
    if (!repo?.data?.branches?.some((branch) => branch.worktree?.path === worktreePath)) continue
    persisted[terminalWorktreeKey] = terminalSessionId
  }
  return persisted
}

function workspacePaneStaticTabsFromEntries(tabs: readonly WorkspacePaneTabEntry[]): WorkspacePaneSessionTabType[] {
  return normalizeWorkspacePaneTabs(tabs).flatMap((entry) => (entry.type === 'terminal' ? [] : [entry.type]))
}
