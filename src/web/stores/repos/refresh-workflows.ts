import { appendRepoEvent, errorEvent } from '#/web/stores/repos/repo-state-factory.ts'
import { isRepoUnavailable, updateIfFresh } from '#/web/stores/repos/repo-guards.ts'
import { persistRepoSnapshotCacheEntry } from '#/web/stores/repos/persistence.ts'
import { refreshPullRequestsLog, terminalLog } from '#/web/logger.ts'
import { terminalClient } from '#/web/terminal.ts'
import { workspacePaneStaticTabsFromEntries } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import {
  preferredWorkspacePaneTabForTarget,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/repos/workspace-pane-preferences.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { getRepoPullRequestsQueryData } from '#/web/repo-data-query.ts'
import {
  PULL_REQUEST_UNKNOWN_RETRY_DELAY_MS,
  PULL_REQUEST_UNKNOWN_RETRY_LIMIT,
  pullRequestMergeStatusPending,
} from '#/shared/pull-request-state.ts'
import type { ReposGet, ReposSet } from '#/web/stores/repos/types.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'

function repoFresh(get: ReposGet, id: string, repoInstanceId: string): boolean {
  const repo = get().repos[id]
  return !!repo && repo.instanceId === repoInstanceId
}

function pullRequestRefreshFailed(get: ReposGet, id: string, repoInstanceId: string): boolean {
  const repo = get().repos[id]
  return !!repo && repo.instanceId === repoInstanceId && repo.dataLoads.pullRequests.error !== null
}

function visibleDetailPullRequestPending(get: ReposGet, id: string, repoInstanceId: string): boolean {
  const repo = get().repos[id]
  if (!repo) return false
  const branchModel = readRepoBranchQueryProjection(repo)
  if (!branchModel) return false
  const target = workspacePaneTabsTargetForSelectedBranch(repo, branchModel)
  const openStaticTabs = workspacePaneStaticTabsFromEntries(readWorkspacePaneTabsForSelectedBranch(repo, branchModel))
  if (
    repo.instanceId !== repoInstanceId ||
    preferredWorkspacePaneTabForTarget(repo.ui, target) !== 'status' ||
    !openStaticTabs.includes('status') ||
    !repo.ui.selectedBranch
  )
    return false
  const pullRequest = readVisibleFullPullRequest(repo.id, repo.instanceId, repo.ui.selectedBranch)
  return pullRequestMergeStatusPending(pullRequest)
}

function readVisibleFullPullRequest(repoRoot: string, repoInstanceId: string, branchName: string) {
  return getRepoPullRequestsQueryData(repoRoot, repoInstanceId, [branchName], 'full')?.find(
    (entry) => entry.branch === branchName,
  )?.pullRequest
}

async function refreshVisibleDetailPullRequest(get: ReposGet, id: string, repoInstanceId: string): Promise<void> {
  const repo = get().repos[id]
  if (!repo) return
  const branchModel = readRepoBranchQueryProjection(repo)
  if (!branchModel) return
  const target = workspacePaneTabsTargetForSelectedBranch(repo, branchModel)
  const openStaticTabs = workspacePaneStaticTabsFromEntries(readWorkspacePaneTabsForSelectedBranch(repo, branchModel))
  if (
    repo.instanceId !== repoInstanceId ||
    preferredWorkspacePaneTabForTarget(repo.ui, target) !== 'status' ||
    !openStaticTabs.includes('status') ||
    !repo.ui.selectedBranch
  )
    return
  await get().refreshPullRequests(id, [repo.ui.selectedBranch], { repoInstanceId, mode: 'full' })
}

function readWorkspacePaneTabsForSelectedBranch(
  repo: NonNullable<ReturnType<ReposGet>['repos'][string]>,
  branchModel: ReturnType<typeof readRepoBranchQueryProjection>,
) {
  const target = workspacePaneTabsTargetForSelectedBranch(repo, branchModel)
  return readWorkspacePaneTabsForTarget({
    repoRoot: repo.id,
    repoInstanceId: repo.instanceId,
    branchName: target?.branchName ?? null,
    worktreePath: target?.worktreePath ?? null,
  })
}

function workspacePaneTabsTargetForSelectedBranch(
  repo: NonNullable<ReturnType<ReposGet>['repos'][string]>,
  branchModel: ReturnType<typeof readRepoBranchQueryProjection>,
) {
  return branchModel
    ? workspacePaneTabsTargetForRepoBranch(
        { repoRoot: repo.id, branches: branchModel.branches },
        repo.ui.selectedBranch,
      )
    : null
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function retryVisibleDetailPullRequestUntilSettled(
  get: ReposGet,
  options: { id: string; repoInstanceId: string; isSnapshotCurrent: () => boolean },
): Promise<void> {
  for (let attempt = 0; attempt < PULL_REQUEST_UNKNOWN_RETRY_LIMIT; attempt += 1) {
    if (!options.isSnapshotCurrent() || !repoFresh(get, options.id, options.repoInstanceId)) return
    if (!visibleDetailPullRequestPending(get, options.id, options.repoInstanceId)) return
    await delay(PULL_REQUEST_UNKNOWN_RETRY_DELAY_MS)
    if (!options.isSnapshotCurrent() || !repoFresh(get, options.id, options.repoInstanceId)) return
    if (!visibleDetailPullRequestPending(get, options.id, options.repoInstanceId)) return
    await refreshVisibleDetailPullRequest(get, options.id, options.repoInstanceId)
    if (pullRequestRefreshFailed(get, options.id, options.repoInstanceId)) return
  }
}

async function refreshPullRequestSummaryAfterSnapshot(
  get: ReposGet,
  options: { id: string; repoInstanceId: string; branchNames: string[]; isSnapshotCurrent: () => boolean },
): Promise<void> {
  if (!options.isSnapshotCurrent() || !repoFresh(get, options.id, options.repoInstanceId)) return
  await get().refreshPullRequests(options.id, options.branchNames, {
    repoInstanceId: options.repoInstanceId,
    mode: 'summary',
  })
}

export async function runSnapshotSuccessWorkflow(
  set: ReposSet,
  get: ReposGet,
  options: {
    id: string
    repoInstanceId: string
    branchNames: string[]
    worktreePaths: string[]
    isSnapshotCurrent: () => boolean
    skipLogBackfill?: boolean
  },
): Promise<void> {
  if (!options.isSnapshotCurrent()) return
  persistRepoSnapshotCacheEntry(set, get().repos[options.id], options.repoInstanceId)
  void terminalClient.pruneTerminals(options.id, options.repoInstanceId).catch((err) => {
    terminalLog.warn('failed to prune repo sessions', { err })
  })
  void (async () => {
    try {
      if (options.isSnapshotCurrent()) await refreshPullRequestSummaryAfterSnapshot(get, options)
      if (pullRequestRefreshFailed(get, options.id, options.repoInstanceId)) return
      if (options.isSnapshotCurrent()) await runSnapshotVisibleDetailBackfill(get, options)
    } catch (err) {
      refreshPullRequestsLog.warn('failed', { err })
      const message = err instanceof Error ? err.message : String(err)
      updateIfFresh(set, options.id, options.repoInstanceId, (r) => {
        r.events = appendRepoEvent(r.events, errorEvent(message))
      })
    }
  })()
}

async function runSnapshotVisibleDetailBackfill(
  get: ReposGet,
  options: { id: string; repoInstanceId: string; isSnapshotCurrent: () => boolean; skipLogBackfill?: boolean },
): Promise<void> {
  void options.skipLogBackfill
  if (!options.isSnapshotCurrent() || !repoFresh(get, options.id, options.repoInstanceId)) return
  await refreshVisibleDetailPullRequest(get, options.id, options.repoInstanceId)
  if (pullRequestRefreshFailed(get, options.id, options.repoInstanceId)) return
  await retryVisibleDetailPullRequestUntilSettled(get, options)
}

export async function runCoreDataRefreshWorkflow(
  get: ReposGet,
  options: { id: string; repoInstanceId: string },
): Promise<void> {
  await get().refreshSnapshotAndStatus(options.id, { skipLogBackfill: true, repoInstanceId: options.repoInstanceId })
  const after = get().repos[options.id]
  if (!after || after.instanceId !== options.repoInstanceId) return
  if (isRepoUnavailable(after)) return
}
