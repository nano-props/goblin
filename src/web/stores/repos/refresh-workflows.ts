import { appendRepoEvent, errorEvent, updateIfFresh } from '#/web/stores/repos/helpers.ts'
import { persistRestorableRepoSnapshot } from '#/web/stores/repos/persistence.ts'
import { terminalBridge } from '#/web/terminal.ts'
import {
  PULL_REQUEST_UNKNOWN_RETRY_DELAY_MS,
  PULL_REQUEST_UNKNOWN_RETRY_LIMIT,
  pullRequestMergeStatusPending,
} from '#/shared/pull-request-state.ts'
import type { ReposGet, ReposSet } from '#/web/stores/repos/types.ts'

function repoFresh(get: ReposGet, id: string, token: number): boolean {
  const repo = get().repos[id]
  return !!repo && repo.instanceToken === token
}

function pullRequestRefreshFailed(get: ReposGet, id: string, token: number): boolean {
  const repo = get().repos[id]
  return !!repo && repo.instanceToken === token && repo.resources.pullRequests.error !== null
}

function visibleDetailPullRequestPending(get: ReposGet, id: string, token: number): boolean {
  const repo = get().repos[id]
  if (!repo || repo.instanceToken !== token || repo.ui.preferredDetailTab !== 'status' || !repo.ui.selectedBranch) return false
  const branch = repo.data.branches.find((entry) => entry.name === repo.ui.selectedBranch)
  return pullRequestMergeStatusPending(branch?.pullRequest)
}

async function refreshVisibleDetailPullRequest(get: ReposGet, id: string, token: number): Promise<void> {
  const repo = get().repos[id]
  if (!repo || repo.instanceToken !== token || repo.ui.preferredDetailTab !== 'status' || !repo.ui.selectedBranch) return
  await get().refreshPullRequests(id, [repo.ui.selectedBranch], { token, mode: 'full' })
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function retryVisibleDetailPullRequestUntilSettled(
  get: ReposGet,
  options: { id: string; token: number; isSnapshotCurrent: () => boolean },
): Promise<void> {
  for (let attempt = 0; attempt < PULL_REQUEST_UNKNOWN_RETRY_LIMIT; attempt += 1) {
    if (!options.isSnapshotCurrent() || !repoFresh(get, options.id, options.token)) return
    if (!visibleDetailPullRequestPending(get, options.id, options.token)) return
    await delay(PULL_REQUEST_UNKNOWN_RETRY_DELAY_MS)
    if (!options.isSnapshotCurrent() || !repoFresh(get, options.id, options.token)) return
    if (!visibleDetailPullRequestPending(get, options.id, options.token)) return
    await refreshVisibleDetailPullRequest(get, options.id, options.token)
    if (pullRequestRefreshFailed(get, options.id, options.token)) return
  }
}

async function refreshPullRequestSummaryAfterSnapshot(
  get: ReposGet,
  options: { id: string; token: number; branchNames: string[]; isSnapshotCurrent: () => boolean },
): Promise<void> {
  if (!options.isSnapshotCurrent() || !repoFresh(get, options.id, options.token)) return
  await get().refreshPullRequests(options.id, options.branchNames, {
    token: options.token,
    mode: 'summary',
    clearMissing: true,
  })
}

export async function runSnapshotSuccessWorkflow(
  set: ReposSet,
  get: ReposGet,
  options: {
    id: string
    token: number
    branchNames: string[]
    worktreePaths: string[]
    isSnapshotCurrent: () => boolean
    skipLogBackfill?: boolean
  },
): Promise<void> {
  if (!options.isSnapshotCurrent()) return
  persistRestorableRepoSnapshot(set, get().repos[options.id], options.token)
  void terminalBridge.pruneTerminals(options.id).catch((err) => {
    console.warn('[terminal] failed to prune repo sessions', err)
  })
  void (async () => {
    try {
      if (options.isSnapshotCurrent()) await refreshPullRequestSummaryAfterSnapshot(get, options)
      if (pullRequestRefreshFailed(get, options.id, options.token)) return
      if (options.isSnapshotCurrent()) await runSnapshotVisibleDetailBackfill(get, options)
    } catch (err) {
      console.warn('[refreshPullRequests] failed', err)
      const message = err instanceof Error ? err.message : String(err)
      updateIfFresh(set, options.id, options.token, (r) => {
        r.events = appendRepoEvent(r.events, errorEvent(message))
      })
    }
  })()
}

async function runSnapshotVisibleDetailBackfill(
  get: ReposGet,
  options: { id: string; token: number; isSnapshotCurrent: () => boolean; skipLogBackfill?: boolean },
): Promise<void> {
  void options.skipLogBackfill
  if (!options.isSnapshotCurrent() || !repoFresh(get, options.id, options.token)) return
  await refreshVisibleDetailPullRequest(get, options.id, options.token)
  if (pullRequestRefreshFailed(get, options.id, options.token)) return
  await retryVisibleDetailPullRequestUntilSettled(get, options)
}

export async function runCoreDataRefreshWorkflow(get: ReposGet, options: { id: string; token: number }): Promise<void> {
  await get().refreshSnapshotAndStatus(options.id, { skipLogBackfill: true, token: options.token })
  const after = get().repos[options.id]
  if (!after || after.instanceToken !== options.token) return
  if (after.availability.phase === 'unavailable') return
}
