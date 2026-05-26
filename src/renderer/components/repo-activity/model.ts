import type { RepoState } from '#/renderer/stores/repos/types.ts'
import { canStartRemoteFetch } from '#/renderer/stores/repos/sync-state.ts'
import { resourceBusy } from '#/renderer/stores/repos/resources.ts'
import { repoBranchActionLoadingLabel, type RepoActionLabel } from '#/renderer/stores/repos/action-labels.ts'

export type RepoActivityKind =
  | 'cache-refresh'
  | 'branch-action'
  | 'snapshot-refresh'
  | 'status-refresh'
  | 'pull-request-refresh'
  | 'log-refresh'
  | 'remote-fetch'

export interface RepoActivity {
  kind: RepoActivityKind
  labelKey: string
  labelParams?: Record<string, string | number>
  blocksSync: boolean
}

export interface RepoActivityControlPresentation {
  syncBlocked: boolean
  visibleActivity: RepoActivity | null
  showingActivity: boolean
}

export interface RepoCompletion extends RepoActionLabel {
  id: number
}

export type RepoActivityControlView =
  | { kind: 'activity'; activity: RepoActivity }
  | { kind: 'completion'; completion: RepoCompletion }
  | { kind: 'refresh-button'; syncBlocked: boolean }

const REFRESH_ACTIVITY_LABEL_KEYS: Record<Exclude<RepoActivityKind, 'branch-action'>, string> = {
  'cache-refresh': 'tab.refreshing-cache',
  'snapshot-refresh': 'tab.refreshing-branches',
  'status-refresh': 'tab.refreshing-status',
  'pull-request-refresh': 'tab.refreshing-prs',
  'log-refresh': 'tab.refreshing-log',
  'remote-fetch': 'tab.refreshing-remote',
}

function refreshActivity(kind: Exclude<RepoActivityKind, 'branch-action'>, blocksSync: boolean): RepoActivity {
  return {
    kind,
    labelKey: REFRESH_ACTIVITY_LABEL_KEYS[kind],
    blocksSync,
  }
}

function branchActionActivity(repo: RepoState): RepoActivity | null {
  const action = repo.resources.branchAction
  if (!resourceBusy(action) || !action.kind) return null
  const label = repoBranchActionLoadingLabel(action.kind)
  return {
    kind: 'branch-action',
    labelKey: label.labelKey,
    labelParams: label.labelParams,
    blocksSync: true,
  }
}

export function getRepoActivity(repo: RepoState): RepoActivity | null {
  const resources = repo.resources
  const candidates: Array<RepoActivity | null> = [
    branchActionActivity(repo),
    repo.cache.source === 'cache' && resourceBusy(resources.snapshot) ? refreshActivity('cache-refresh', true) : null,
    resourceBusy(resources.snapshot) ? refreshActivity('snapshot-refresh', true) : null,
    resourceBusy(resources.status) ? refreshActivity('status-refresh', true) : null,
    resourceBusy(resources.pullRequests) ? refreshActivity('pull-request-refresh', false) : null,
    Object.values(resources.logsByBranch).some(resourceBusy) ? refreshActivity('log-refresh', false) : null,
    resourceBusy(resources.fetch) ? refreshActivity('remote-fetch', true) : null,
  ]

  return candidates.find((activity) => activity !== null) ?? null
}

export function isRepoSyncBlocked(repo: RepoState): boolean {
  return !canStartRemoteFetch(repo)
}

export function getRepoActivityControlPresentation(
  repo: RepoState,
  visibleActivity: RepoActivity | null,
): RepoActivityControlPresentation {
  return {
    syncBlocked: isRepoSyncBlocked(repo),
    visibleActivity,
    showingActivity: visibleActivity !== null,
  }
}

export function getRepoActivityControlView(input: {
  visibleActivity: RepoActivity | null
  completion: RepoCompletion | null
  syncBlocked: boolean
}): RepoActivityControlView {
  if (input.visibleActivity?.kind === 'branch-action') return { kind: 'activity', activity: input.visibleActivity }
  if (input.completion) return { kind: 'completion', completion: input.completion }
  if (input.visibleActivity) return { kind: 'activity', activity: input.visibleActivity }
  return { kind: 'refresh-button', syncBlocked: input.syncBlocked }
}
