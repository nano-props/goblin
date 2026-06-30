import {
  isWorkspacePaneSessionTabType,
  isWorkspacePaneStaticTabType,
  workspacePaneTabEntryIdentity,
} from '#/shared/workspace-pane.ts'
import type { WorkspacePaneStaticTabType, WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { replaceRepo } from '#/web/stores/repos/repo-state-factory.ts'
import { normalizeWorkspacePaneTabsRecord } from '#/web/stores/repos/workspace-pane-tabs.ts'
import {
  preferredWorkspacePaneTabForBranch,
  preferredWorkspacePaneTabByBranchRecordWith,
} from '#/web/stores/repos/workspace-pane-preferences.ts'
import type { RepoState, SessionWorkspacePaneRestoreState } from '#/web/stores/repos/types.ts'

export function restoreSessionWorkspacePaneStateInRepos(
  repos: Record<string, RepoState>,
  restoreState: SessionWorkspacePaneRestoreState | undefined,
): Record<string, RepoState> {
  if (!restoreState) return repos

  let nextRepos = repos
  const repoIds = new Set([
    ...Object.keys(restoreState.workspacePaneTabsByBranchByRepo),
    ...Object.keys(restoreState.preferredWorkspacePaneTabByBranchByRepo),
  ])

  for (const id of repoIds) {
    const repo = nextRepos[id]
    if (!repo) continue

    const tabsByBranch = restoreState.workspacePaneTabsByBranchByRepo[id]
    const preferredTabByBranch = restoreState.preferredWorkspacePaneTabByBranchByRepo[id]
    let repoChanged = false

    const nextTabsByBranch =
      tabsByBranch === undefined
        ? repo.ui.workspacePaneTabsByBranch
        : locallyRestorableWorkspacePaneTabsByBranch(repo, tabsByBranch)

    if (
      nextTabsByBranch !== repo.ui.workspacePaneTabsByBranch &&
      !workspacePaneTabRecordsEqual(repo.ui.workspacePaneTabsByBranch, nextTabsByBranch)
    ) {
      repoChanged = true
    }

    const nextPreferredTabByBranch = preferredTabByBranch
      ? restoredPreferredWorkspacePaneTabs(repo, preferredTabByBranch, nextTabsByBranch)
      : repo.ui.preferredWorkspacePaneTabByBranch

    if (nextPreferredTabByBranch !== repo.ui.preferredWorkspacePaneTabByBranch) {
      repoChanged = true
    }

    if (!repoChanged) continue
    if (nextRepos === repos) nextRepos = { ...repos }
    nextRepos[id] = replaceRepo(repo, (r) => {
      r.ui.workspacePaneTabsByBranch = nextTabsByBranch
      r.ui.preferredWorkspacePaneTabByBranch = nextPreferredTabByBranch
    })
  }

  return nextRepos
}

function locallyRestorableWorkspacePaneTabsByBranch(
  repo: RepoState,
  tabsByBranch: Record<string, readonly WorkspacePaneTabEntry[]>,
): Record<string, WorkspacePaneTabEntry[]> {
  const normalizedTabsByBranch = normalizeWorkspacePaneTabsRecord(
    tabsByBranch,
    sessionWorkspacePaneRestoreBranchNames(
      repo.data.branches.map((branch) => branch.name),
      tabsByBranch,
    ),
  )
  const nextTabsByBranch = { ...repo.ui.workspacePaneTabsByBranch }
  for (const [branchName, tabs] of Object.entries(normalizedTabsByBranch)) {
    const branch = repo.data.branches.find((candidate) => candidate.name === branchName)
    if (branch?.worktree?.path) continue
    nextTabsByBranch[branchName] = tabs
  }
  return nextTabsByBranch
}

function restoredPreferredWorkspacePaneTabs(
  repo: RepoState,
  preferredTabByBranch: SessionWorkspacePaneRestoreState['preferredWorkspacePaneTabByBranchByRepo'][string],
  tabsByBranch: Record<string, readonly WorkspacePaneTabEntry[]>,
): RepoState['ui']['preferredWorkspacePaneTabByBranch'] {
  let next = repo.ui.preferredWorkspacePaneTabByBranch
  for (const [branch, tab] of Object.entries(preferredTabByBranch)) {
    if (!isRestorableBranchName(branch)) continue
    if (!isWorkspacePaneSessionTabType(tab)) continue
    if (isWorkspacePaneStaticTabType(tab) && !workspacePaneStaticTabs(tabsByBranch[branch] ?? []).includes(tab))
      continue
    const current =
      next === repo.ui.preferredWorkspacePaneTabByBranch
        ? preferredWorkspacePaneTabForBranch(repo.ui, branch)
        : (next[branch] ?? 'status')
    if (current === tab) continue
    const source =
      next === repo.ui.preferredWorkspacePaneTabByBranch ? repo.ui : { preferredWorkspacePaneTabByBranch: next }
    next = preferredWorkspacePaneTabByBranchRecordWith(source, branch, tab)
  }
  return next
}

function sessionWorkspacePaneRestoreBranchNames(
  knownBranchNames: readonly string[],
  restoredByBranch: Record<string, readonly WorkspacePaneTabEntry[]>,
): string[] {
  const branchNames = new Set<string>()
  for (const branch of knownBranchNames) {
    if (isRestorableBranchName(branch)) branchNames.add(branch)
  }
  for (const branch of Object.keys(restoredByBranch)) {
    if (isRestorableBranchName(branch)) branchNames.add(branch)
  }
  return Array.from(branchNames)
}

function isRestorableBranchName(branch: string): boolean {
  return branch.length > 0 && !branch.includes('\0')
}

function workspacePaneTabRecordsEqual(
  a: Record<string, WorkspacePaneTabEntry[]>,
  b: Record<string, WorkspacePaneTabEntry[]>,
): boolean {
  const aEntries = Object.entries(a)
  const bEntries = Object.entries(b)
  if (aEntries.length !== bEntries.length) return false
  return bEntries.every(([branch, views]) => {
    const current = a[branch]
    return (
      !!current &&
      current.length === views.length &&
      views.every((view, index) => {
        const currentView = current[index]
        return (
          !!currentView && workspacePaneTabEntryIdentity(view) === workspacePaneTabEntryIdentity(currentView)
        )
      })
    )
  })
}

function workspacePaneStaticTabs(tabs: readonly WorkspacePaneTabEntry[]): WorkspacePaneStaticTabType[] {
  return tabs.flatMap((entry) => (entry.type === 'terminal' ? [] : [entry.type]))
}
