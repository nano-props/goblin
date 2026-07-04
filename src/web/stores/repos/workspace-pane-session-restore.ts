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

export type RestoreSessionWorkspacePaneStateResult =
  | { status: 'restored'; repos: Record<string, RepoState> }
  | {
      status: 'failed'
      repos: Record<string, RepoState>
      missingSnapshots: string[]
      unresolvedTargets: Array<{ repoId: string; targetKey: string; reason: 'target' | 'tab' }>
    }

export function restoreSessionWorkspacePaneStateInRepos(
  repos: Record<string, RepoState>,
  restoreState: SessionWorkspacePaneRestoreState | undefined,
): RestoreSessionWorkspacePaneStateResult {
  if (!restoreState) return { status: 'restored', repos }

  let nextRepos = repos
  const missingSnapshots: string[] = []
  const unresolvedTargets: Array<{ repoId: string; targetKey: string; reason: 'target' | 'tab' }> = []
  const repoIds = new Set(Object.keys(restoreState.preferredWorkspacePaneTabByTargetByRepo))

  for (const id of repoIds) {
    const repo = nextRepos[id]
    if (!repo) continue

    const tabsByTarget = restoreState.workspacePaneTabsByTargetByRepo[id]
    const preferredTabByTarget = restoreState.preferredWorkspacePaneTabByTargetByRepo[id]

    const restoredPreferred = preferredTabByTarget
      ? restoredPreferredWorkspacePaneTabs(repo, preferredTabByTarget, tabsByTarget ?? {})
      : { status: 'restored' as const, preferredWorkspacePaneTabByTarget: repo.ui.preferredWorkspacePaneTabByTarget }
    if (restoredPreferred.status === 'failed') {
      if (restoredPreferred.reason === 'snapshot') missingSnapshots.push(id)
      else unresolvedTargets.push({ repoId: id, targetKey: restoredPreferred.targetKey, reason: restoredPreferred.reason })
      continue
    }
    const nextPreferredTabByTarget = restoredPreferred.preferredWorkspacePaneTabByTarget

    if (nextPreferredTabByTarget === repo.ui.preferredWorkspacePaneTabByTarget) continue
    if (nextRepos === repos) nextRepos = { ...repos }
    nextRepos[id] = replaceRepo(repo, (r) => {
      r.ui.preferredWorkspacePaneTabByTarget = nextPreferredTabByTarget
    })
  }

  if (missingSnapshots.length > 0 || unresolvedTargets.length > 0) {
    return { status: 'failed', repos: nextRepos, missingSnapshots, unresolvedTargets }
  }
  return { status: 'restored', repos: nextRepos }
}

function restoredPreferredWorkspacePaneTabs(
  repo: RepoState,
  preferredTabByTarget: SessionWorkspacePaneRestoreState['preferredWorkspacePaneTabByTargetByRepo'][string],
  tabsByTarget: Record<string, readonly WorkspacePaneTabEntry[]>,
):
  | { status: 'restored'; preferredWorkspacePaneTabByTarget: RepoState['ui']['preferredWorkspacePaneTabByTarget'] }
  | { status: 'failed'; reason: 'snapshot' }
  | { status: 'failed'; reason: 'target' | 'tab'; targetKey: string } {
  const snapshot = getRepoSnapshotQueryData(repo.id, repo.instanceId)
  if (!snapshot) return { status: 'failed', reason: 'snapshot' }
  let next = repo.ui.preferredWorkspacePaneTabByTarget
  for (const [targetKey, tab] of Object.entries(preferredTabByTarget)) {
    const target = workspacePaneTabsTargetForRepoTargetKey(
      { repoRoot: repo.id, branches: snapshot.branches },
      targetKey,
    )
    if (!target) return { status: 'failed', reason: 'target', targetKey }
    if (!isWorkspacePaneSessionTabType(tab)) return { status: 'failed', reason: 'tab', targetKey }
    if (
      isWorkspacePaneStaticTabType(tab) &&
      tab !== 'status' &&
      !workspacePaneStaticTabsFromEntries(tabsByTarget[targetKey] ?? []).includes(tab)
    )
      return { status: 'failed', reason: 'tab', targetKey }
    const current =
      next === repo.ui.preferredWorkspacePaneTabByTarget
        ? preferredWorkspacePaneTabForTarget(repo.ui, target)
        : (next[targetKey] ?? 'status')
    if (current === tab) continue
    const source =
      next === repo.ui.preferredWorkspacePaneTabByTarget ? repo.ui : { preferredWorkspacePaneTabByTarget: next }
    next = preferredWorkspacePaneTabByTargetRecordWith(source, target, tab)
  }
  return { status: 'restored', preferredWorkspacePaneTabByTarget: next }
}
