import type { RepoState } from '#/renderer/stores/repos/types.ts'
import { branchForVisibleLog } from '#/renderer/stores/repos/branch-view-mode.ts'
import { canStartRemoteFetch } from '#/renderer/stores/repos/sync-state.ts'

export type RepoSyncStage = 'cache' | 'branches' | 'status' | 'prs' | 'log' | 'remote'

export interface RepoSyncActivity {
  stage: RepoSyncStage
  labelKey: string
}

const STAGE_LABEL_KEYS: Record<RepoSyncStage, string> = {
  cache: 'tab.refreshing-cache',
  branches: 'tab.refreshing-branches',
  status: 'tab.refreshing-status',
  prs: 'tab.refreshing-prs',
  log: 'tab.refreshing-log',
  remote: 'tab.refreshing-remote',
}

export function getRepoSyncActivity(repo: RepoState): RepoSyncActivity | null {
  const branchForLog = branchForVisibleLog(repo)
  const logLoading = branchForLog ? (repo.data.logsByBranch[branchForLog]?.loading ?? false) : false
  const stage =
    repo.cache.source === 'cache' && repo.async.refreshing
      ? 'cache'
      : repo.async.loading
        ? 'branches'
        : repo.async.statusLoading
          ? 'status'
          : repo.async.pullRequestsLoading
            ? 'prs'
            : logLoading
              ? 'log'
              : repo.async.fetching || repo.async.syncing
                ? 'remote'
                : null

  return stage ? { stage, labelKey: STAGE_LABEL_KEYS[stage] } : null
}

export function isRepoSyncBlocked(repo: RepoState): boolean {
  return !canStartRemoteFetch(repo)
}
