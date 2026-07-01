import {
  isWorkspacePaneSessionTabType,
  isWorkspacePaneStaticTabType,
} from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { replaceRepo } from '#/web/stores/repos/repo-state-factory.ts'
import {
  preferredWorkspacePaneTabForBranch,
  preferredWorkspacePaneTabByBranchRecordWith,
} from '#/web/stores/repos/workspace-pane-preferences.ts'
import type { RepoState, SessionWorkspacePaneRestoreState } from '#/web/stores/repos/types.ts'
import { workspacePaneStaticTabsFromEntries } from '#/web/workspace-pane/workspace-pane-tabs.ts'

export function restoreSessionWorkspacePaneStateInRepos(
  repos: Record<string, RepoState>,
  restoreState: SessionWorkspacePaneRestoreState | undefined,
): Record<string, RepoState> {
  if (!restoreState) return repos

  let nextRepos = repos
  const repoIds = new Set(Object.keys(restoreState.preferredWorkspacePaneTabByBranchByRepo))

  for (const id of repoIds) {
    const repo = nextRepos[id]
    if (!repo) continue

    const tabsByBranch = restoreState.workspacePaneTabsByBranchByRepo[id]
    const preferredTabByBranch = restoreState.preferredWorkspacePaneTabByBranchByRepo[id]

    const nextPreferredTabByBranch = preferredTabByBranch
      ? restoredPreferredWorkspacePaneTabs(repo, preferredTabByBranch, tabsByBranch ?? {})
      : repo.ui.preferredWorkspacePaneTabByBranch

    if (nextPreferredTabByBranch === repo.ui.preferredWorkspacePaneTabByBranch) continue
    if (nextRepos === repos) nextRepos = { ...repos }
    nextRepos[id] = replaceRepo(repo, (r) => {
      r.ui.preferredWorkspacePaneTabByBranch = nextPreferredTabByBranch
    })
  }

  return nextRepos
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
    if (isWorkspacePaneStaticTabType(tab) && !workspacePaneStaticTabsFromEntries(tabsByBranch[branch] ?? []).includes(tab))
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

function isRestorableBranchName(branch: string): boolean {
  return branch.length > 0 && !branch.includes('\0')
}
