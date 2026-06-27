import { isWorkspacePaneSessionTabType, isWorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneStaticTabType, WorkspacePaneTabOrderEntry } from '#/shared/workspace-pane.ts'
import { replaceRepo } from '#/web/stores/repos/repo-state-factory.ts'
import { normalizeWorkspacePaneTabOrderRecord } from '#/web/stores/repos/workspace-pane-tabs.ts'
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
    ...Object.keys(restoreState.workspacePaneTabOrderByBranchByRepo),
    ...Object.keys(restoreState.preferredWorkspacePaneTabByBranchByRepo),
  ])

  for (const id of repoIds) {
    const repo = nextRepos[id]
    if (!repo) continue

    const tabOrderByBranch = restoreState.workspacePaneTabOrderByBranchByRepo[id]
    const preferredTabByBranch = restoreState.preferredWorkspacePaneTabByBranchByRepo[id]
    let repoChanged = false

    const nextTabOrderByBranch =
      tabOrderByBranch === undefined
        ? repo.ui.workspacePaneTabOrderByBranch
        : normalizeWorkspacePaneTabOrderRecord(
            tabOrderByBranch,
            sessionWorkspacePaneRestoreBranchNames(
              repo.data.branches.map((branch) => branch.name),
              tabOrderByBranch,
            ),
          )

    if (
      nextTabOrderByBranch !== repo.ui.workspacePaneTabOrderByBranch &&
      !workspacePaneTabOrderRecordsEqual(repo.ui.workspacePaneTabOrderByBranch, nextTabOrderByBranch)
    ) {
      repoChanged = true
    }

    const nextPreferredTabByBranch = preferredTabByBranch
      ? restoredPreferredWorkspacePaneTabs(repo, preferredTabByBranch, nextTabOrderByBranch)
      : repo.ui.preferredWorkspacePaneTabByBranch

    if (nextPreferredTabByBranch !== repo.ui.preferredWorkspacePaneTabByBranch) {
      repoChanged = true
    }

    if (!repoChanged) continue
    if (nextRepos === repos) nextRepos = { ...repos }
    nextRepos[id] = replaceRepo(repo, (r) => {
      r.ui.workspacePaneTabOrderByBranch = nextTabOrderByBranch
      r.ui.preferredWorkspacePaneTabByBranch = nextPreferredTabByBranch
    })
  }

  return nextRepos
}

function restoredPreferredWorkspacePaneTabs(
  repo: RepoState,
  preferredTabByBranch: SessionWorkspacePaneRestoreState['preferredWorkspacePaneTabByBranchByRepo'][string],
  tabOrderByBranch: Record<string, readonly WorkspacePaneTabOrderEntry[]>,
): RepoState['ui']['preferredWorkspacePaneTabByBranch'] {
  let next = repo.ui.preferredWorkspacePaneTabByBranch
  for (const [branch, tab] of Object.entries(preferredTabByBranch)) {
    if (!isRestorableBranchName(branch)) continue
    if (!isWorkspacePaneSessionTabType(tab)) continue
    if (isWorkspacePaneStaticTabType(tab) && !workspacePaneStaticViews(tabOrderByBranch[branch] ?? []).includes(tab))
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
  restoredByBranch: Record<string, readonly WorkspacePaneTabOrderEntry[]>,
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

function workspacePaneTabOrderRecordsEqual(
  a: Record<string, WorkspacePaneTabOrderEntry[]>,
  b: Record<string, WorkspacePaneTabOrderEntry[]>,
): boolean {
  const aEntries = Object.entries(a)
  const bEntries = Object.entries(b)
  if (aEntries.length !== bEntries.length) return false
  return bEntries.every(([branch, views]) => {
    const current = a[branch]
    return (
      !!current &&
      current.length === views.length &&
      views.every((view, index) => view.type === current[index]?.type && view.id === current[index]?.id)
    )
  })
}

function workspacePaneStaticViews(order: readonly WorkspacePaneTabOrderEntry[]): WorkspacePaneStaticTabType[] {
  return order.flatMap((entry) => (entry.type === 'terminal' ? [] : [entry.type]))
}
