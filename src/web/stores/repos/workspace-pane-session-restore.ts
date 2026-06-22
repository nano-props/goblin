import { isWorkspacePaneBranchViewType, isWorkspacePaneSessionViewType } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneBranchViewType } from '#/shared/workspace-pane.ts'
import { replaceRepo } from '#/web/stores/repos/helpers.ts'
import { normalizeBranchWorkspacePaneViewsRecord } from '#/web/stores/repos/branch-workspace-pane-views.ts'
import {
  preferredWorkspacePaneViewForBranch,
  preferredWorkspacePaneViewByBranchRecordWith,
} from '#/web/stores/repos/workspace-pane-preferences.ts'
import type { RepoState, SessionWorkspacePaneRestoreState } from '#/web/stores/repos/types.ts'

export function restoreSessionWorkspacePaneStateInRepos(
  repos: Record<string, RepoState>,
  restoreState: SessionWorkspacePaneRestoreState | undefined,
): Record<string, RepoState> {
  if (!restoreState) return repos

  let nextRepos = repos
  const repoIds = new Set([
    ...Object.keys(restoreState.openBranchWorkspacePaneViewsByBranchByRepo),
    ...Object.keys(restoreState.preferredWorkspacePaneViewByBranchByRepo),
  ])

  for (const id of repoIds) {
    const repo = nextRepos[id]
    if (!repo) continue

    const openViewsByBranch = restoreState.openBranchWorkspacePaneViewsByBranchByRepo[id]
    const preferredViewByBranch = restoreState.preferredWorkspacePaneViewByBranchByRepo[id]
    let repoChanged = false

    const nextOpenViewsByBranch =
      openViewsByBranch === undefined
        ? repo.ui.openBranchWorkspacePaneViewsByBranch
        : normalizeBranchWorkspacePaneViewsRecord(
            openViewsByBranch,
            sessionWorkspacePaneRestoreBranchNames(
              repo.data.branches.map((branch) => branch.name),
              openViewsByBranch,
            ),
          )

    if (
      nextOpenViewsByBranch !== repo.ui.openBranchWorkspacePaneViewsByBranch &&
      !branchWorkspacePaneViewRecordsEqual(repo.ui.openBranchWorkspacePaneViewsByBranch, nextOpenViewsByBranch)
    ) {
      repoChanged = true
    }

    const nextPreferredViewByBranch = preferredViewByBranch
      ? restoredPreferredWorkspacePaneViews(repo, preferredViewByBranch, nextOpenViewsByBranch)
      : repo.ui.preferredWorkspacePaneViewByBranch

    if (nextPreferredViewByBranch !== repo.ui.preferredWorkspacePaneViewByBranch) {
      repoChanged = true
    }

    if (!repoChanged) continue
    if (nextRepos === repos) nextRepos = { ...repos }
    nextRepos[id] = replaceRepo(repo, (r) => {
      r.ui.openBranchWorkspacePaneViewsByBranch = nextOpenViewsByBranch
      r.ui.preferredWorkspacePaneViewByBranch = nextPreferredViewByBranch
    })
  }

  return nextRepos
}

function restoredPreferredWorkspacePaneViews(
  repo: RepoState,
  preferredViewByBranch: SessionWorkspacePaneRestoreState['preferredWorkspacePaneViewByBranchByRepo'][string],
  openViewsByBranch: Record<string, readonly WorkspacePaneBranchViewType[]>,
): RepoState['ui']['preferredWorkspacePaneViewByBranch'] {
  let next = repo.ui.preferredWorkspacePaneViewByBranch
  for (const [branch, view] of Object.entries(preferredViewByBranch)) {
    if (!isRestorableBranchName(branch)) continue
    if (!isWorkspacePaneSessionViewType(view)) continue
    if (isWorkspacePaneBranchViewType(view) && !(openViewsByBranch[branch] ?? []).includes(view)) continue
    const current =
      next === repo.ui.preferredWorkspacePaneViewByBranch
        ? preferredWorkspacePaneViewForBranch(repo.ui, branch)
        : (next[branch] ?? 'status')
    if (current === view) continue
    const source =
      next === repo.ui.preferredWorkspacePaneViewByBranch ? repo.ui : { preferredWorkspacePaneViewByBranch: next }
    next = preferredWorkspacePaneViewByBranchRecordWith(source, branch, view)
  }
  return next
}

function sessionWorkspacePaneRestoreBranchNames(
  knownBranchNames: readonly string[],
  restoredByBranch: Record<string, readonly WorkspacePaneBranchViewType[]>,
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

function branchWorkspacePaneViewRecordsEqual(
  a: Record<string, WorkspacePaneBranchViewType[]>,
  b: Record<string, WorkspacePaneBranchViewType[]>,
): boolean {
  const aEntries = Object.entries(a)
  const bEntries = Object.entries(b)
  if (aEntries.length !== bEntries.length) return false
  return bEntries.every(([branch, views]) => {
    const current = a[branch]
    return !!current && current.length === views.length && views.every((view, index) => view === current[index])
  })
}
