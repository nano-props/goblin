import type { RepoState } from '#/renderer/stores/repos/types.ts'
import { branchForVisibleLog } from '#/renderer/stores/repos/branch-view-mode.ts'
import { canStartRemoteFetch } from '#/renderer/stores/repos/sync-state.ts'

export type RepoSyncStage = 'branches' | 'status' | 'prs' | 'log' | 'remote'

export interface RepoSyncActivity {
  stage: RepoSyncStage
  labelKey: string
}

const STAGE_LABEL_KEYS: Record<RepoSyncStage, string> = {
  branches: 'tab.refreshing-branches',
  status: 'tab.refreshing-status',
  prs: 'tab.refreshing-prs',
  log: 'tab.refreshing-log',
  remote: 'tab.refreshing-remote',
}

export function getRepoSyncActivity(repo: RepoState): RepoSyncActivity | null {
  const branchForLog = branchForVisibleLog(repo)
  const logLoading = branchForLog ? (repo.logsByBranch[branchForLog]?.loading ?? false) : false
  const stage = repo.loading
    ? 'branches'
    : repo.statusLoading
      ? 'status'
      : repo.pullRequestsLoading
        ? 'prs'
        : logLoading
          ? 'log'
          : repo.fetching || repo.syncing
            ? 'remote'
            : null

  return stage ? { stage, labelKey: STAGE_LABEL_KEYS[stage] } : null
}

export function isRepoSyncBlocked(repo: RepoState): boolean {
  return !canStartRemoteFetch(repo)
}
