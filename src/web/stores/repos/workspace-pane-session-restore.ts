import { isWorkspacePaneSessionTabType, isWorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { replaceRepo } from '#/web/stores/repos/repo-state-factory.ts'
import {
  preferredWorkspacePaneTabForTarget,
  preferredWorkspacePaneTabByTargetRecordWith,
  workspacePaneTabsTargetForRepoTargetKey,
} from '#/web/stores/repos/workspace-pane-preferences.ts'
import type { RepoState, SessionWorkspacePaneRestoreState } from '#/web/stores/repos/types.ts'
import { workspacePaneStaticTabsFromEntries } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import { getRepoSnapshotQueryData } from '#/web/repo-data-query.ts'

export function restoreSessionWorkspacePaneStateInRepos(
  repos: Record<string, RepoState>,
  restoreState: SessionWorkspacePaneRestoreState | undefined,
): Record<string, RepoState> {
  if (!restoreState) return repos

  let nextRepos = repos
  const repoIds = new Set(Object.keys(restoreState.preferredWorkspacePaneTabByTargetByRepo))

  for (const id of repoIds) {
    const repo = nextRepos[id]
    if (!repo) continue

    const tabsByTarget = restoreState.workspacePaneTabsByTargetByRepo[id]
    const preferredTabByTarget = restoreState.preferredWorkspacePaneTabByTargetByRepo[id]

    const nextPreferredTabByTarget = preferredTabByTarget
      ? restoredPreferredWorkspacePaneTabs(repo, preferredTabByTarget, tabsByTarget ?? {})
      : repo.ui.preferredWorkspacePaneTabByTarget

    if (nextPreferredTabByTarget === repo.ui.preferredWorkspacePaneTabByTarget) continue
    if (nextRepos === repos) nextRepos = { ...repos }
    nextRepos[id] = replaceRepo(repo, (r) => {
      r.ui.preferredWorkspacePaneTabByTarget = nextPreferredTabByTarget
    })
  }

  return nextRepos
}

function restoredPreferredWorkspacePaneTabs(
  repo: RepoState,
  preferredTabByTarget: SessionWorkspacePaneRestoreState['preferredWorkspacePaneTabByTargetByRepo'][string],
  tabsByTarget: Record<string, readonly WorkspacePaneTabEntry[]>,
): RepoState['ui']['preferredWorkspacePaneTabByTarget'] {
  const snapshot = getRepoSnapshotQueryData(repo.id, repo.instanceId)
  if (!snapshot) return repo.ui.preferredWorkspacePaneTabByTarget
  let next = repo.ui.preferredWorkspacePaneTabByTarget
  for (const [targetKey, tab] of Object.entries(preferredTabByTarget)) {
    const target = workspacePaneTabsTargetForRepoTargetKey(
      { repoRoot: repo.id, branches: snapshot.branches },
      targetKey,
    )
    if (!target) continue
    if (!isWorkspacePaneSessionTabType(tab)) continue
    if (
      isWorkspacePaneStaticTabType(tab) &&
      !workspacePaneStaticTabsFromEntries(tabsByTarget[targetKey] ?? []).includes(tab)
    )
      continue
    const current =
      next === repo.ui.preferredWorkspacePaneTabByTarget
        ? preferredWorkspacePaneTabForTarget(repo.ui, target)
        : (next[targetKey] ?? 'status')
    if (current === tab) continue
    const source =
      next === repo.ui.preferredWorkspacePaneTabByTarget ? repo.ui : { preferredWorkspacePaneTabByTarget: next }
    next = preferredWorkspacePaneTabByTargetRecordWith(source, target, tab)
  }
  return next
}
