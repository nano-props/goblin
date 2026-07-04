import {
  isWorkspacePaneStaticTabType,
  isWorkspacePaneSessionTabType,
  type WorkspacePaneSessionTabType,
  type WorkspacePaneTabEntry,
  type WorkspacePaneTabType,
  workspacePaneTabRequiresWorktree,
} from '#/shared/workspace-pane.ts'
import { parseWorkspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import {
  defaultWorkspacePaneTabs,
  normalizeWorkspacePaneTabs,
  workspacePaneStaticTabsFromEntries,
} from '#/web/workspace-pane/workspace-pane-tabs.ts'

interface WorkspaceSessionBranchProjection {
  name: string
  worktree?: { path?: string } | undefined
}

interface WorkspaceSessionRepoProjection {
  branches: readonly WorkspaceSessionBranchProjection[]
  ui?: {
    preferredWorkspacePaneTabByTarget: Record<string, WorkspacePaneTabType>
  }
}

type WorkspaceSessionRepoProjectionWithUi = WorkspaceSessionRepoProjection &
  Required<Pick<WorkspaceSessionRepoProjection, 'ui'>>

export function persistedActiveRepoIdForSession(activeId: string | null): string | null {
  return activeId
}

export function persistedPreferredWorkspacePaneTabByTargetByRepoForSession(
  repos: Record<string, WorkspaceSessionRepoProjectionWithUi | undefined>,
  order: string[],
  workspacePaneTabsByTargetByRepo: Record<string, Record<string, WorkspacePaneTabEntry[]>>,
): Record<string, Record<string, WorkspacePaneSessionTabType>> {
  const byRepo: Record<string, Record<string, WorkspacePaneSessionTabType>> = {}
  for (const id of order) {
    const repo = repos[id]
    if (!repo) continue
    const byTarget: Record<string, WorkspacePaneSessionTabType> = {}
    for (const [targetKey, tab] of Object.entries(repo.ui.preferredWorkspacePaneTabByTarget)) {
      const target = workspacePaneTabsTargetKeyBelongsToRepo(targetKey, id, repo)
      if (!target) continue
      if (!isWorkspacePaneSessionTabType(tab)) continue
      if (target.kind === 'branch' && workspacePaneTabRequiresWorktree(tab)) continue
      const targetTabs = workspacePaneTabsByTargetByRepo[id]?.[targetKey] ?? defaultWorkspacePaneTabs()
      if (isWorkspacePaneStaticTabType(tab) && !workspacePaneStaticTabsFromEntries(targetTabs).includes(tab)) continue
      byTarget[targetKey] = tab
    }
    if (Object.keys(byTarget).length > 0) byRepo[id] = byTarget
  }
  return byRepo
}

export function persistedWorkspacePaneTabsByTargetByRepoForSession(
  repos: Record<string, WorkspaceSessionRepoProjection | undefined>,
  order: string[],
  workspacePaneTabsByTargetByRepo: Record<string, Record<string, WorkspacePaneTabEntry[]>>,
): Record<string, Record<string, WorkspacePaneTabEntry[]>> {
  const byRepo: Record<string, Record<string, WorkspacePaneTabEntry[]>> = {}
  for (const id of order) {
    const repo = repos[id]
    if (!repo) continue
    const byTarget: Record<string, WorkspacePaneTabEntry[]> = {}
    for (const [targetKey, tabs] of Object.entries(workspacePaneTabsByTargetByRepo[id] ?? {})) {
      const target = workspacePaneTabsTargetKeyBelongsToRepo(targetKey, id, repo)
      if (!target) continue
      byTarget[targetKey] = normalizeWorkspacePaneTabs(tabs, { hasWorktree: target.kind === 'worktree' })
    }
    if (Object.keys(byTarget).length > 0) byRepo[id] = byTarget
  }
  return byRepo
}

function workspacePaneTabsTargetKeyBelongsToRepo(
  targetKey: string,
  repoRoot: string,
  repo: WorkspaceSessionRepoProjection,
) {
  const target = parseWorkspacePaneTabsTargetIdentityKey(targetKey)
  if (!target || target.repoRoot !== repoRoot) return null
  if (target.kind === 'branch') {
    return repo.branches.some((branch) => branch.name === target.branchName) ? target : null
  }
  return repo.branches.some((branch) => branch.worktree?.path === target.worktreePath) ? target : null
}

export function persistedSelectedTerminalSessionIdByTerminalWorktreeForSession(
  selectedTerminalSessionIdByTerminalWorktree: Record<string, string>,
  repos: Record<string, WorkspaceSessionRepoProjection | undefined>,
): Record<string, string> {
  const persisted: Record<string, string> = {}
  for (const [terminalWorktreeKey, terminalSessionId] of Object.entries(selectedTerminalSessionIdByTerminalWorktree)) {
    const parts = terminalWorktreeKey.split('\0')
    if (parts.length !== 2) continue
    const [repoRoot, worktreePath] = parts
    if (!repoRoot || !worktreePath || !terminalSessionId) continue
    const repo = repos[repoRoot]
    if (!repo?.branches.some((branch) => branch.worktree?.path === worktreePath)) continue
    persisted[terminalWorktreeKey] = terminalSessionId
  }
  return persisted
}
