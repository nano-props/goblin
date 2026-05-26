import { appendRepoEvent, errorEvent, updateIfFresh } from '#/renderer/stores/repos/helpers.ts'
import { isRepoUnavailableReason } from '#/renderer/stores/repos/availability.ts'
import { persistRepoCache } from '#/renderer/stores/repos/persistence.ts'
import { terminalBridge } from '#/renderer/terminal.ts'
import type { DetailTab, ReposGet, ReposSet } from '#/renderer/stores/repos/types.ts'
import type { ExecResult } from '#/renderer/types.ts'

// Fire-and-forget refresh orchestration. Callers pass the repo token captured
// when the UI change happened; refresh methods still own final repo-exists and
// stale-token validation before writing results.
export function runInitialRepoLoad(get: ReposGet, refresh: { id: string; token: number }): void {
  void get().refreshSnapshot(refresh.id, { token: refresh.token })
  void get().refreshStatus(refresh.id, { token: refresh.token })
}

export function runBranchViewModeChangedWorkflow(
  get: ReposGet,
  options: {
    id: string
    token: number
    selectedForLog: string | null
    selectedForPullRequest: string | null
    shouldRefreshLog: boolean
  },
): void {
  if (options.shouldRefreshLog && options.selectedForLog) {
    void get().refreshBranchLog(options.id, options.selectedForLog, { token: options.token })
  }
  if (options.selectedForPullRequest) {
    void get().refreshPullRequests(options.id, [options.selectedForPullRequest], {
      token: options.token,
      mode: 'full',
    })
  }
}

export function runDetailTabChangedWorkflow(
  get: ReposGet,
  options: { id: string; token: number; tab: DetailTab | undefined; selectedBranch: string | null | undefined },
): void {
  if (options.tab === 'commits') void get().refreshBranchLog(options.id, undefined, { token: options.token })
  if (options.tab === 'changes') void get().refreshStatus(options.id, { token: options.token })
  if (options.tab === 'status' && options.selectedBranch) {
    void get().refreshPullRequests(options.id, [options.selectedBranch], { token: options.token, mode: 'full' })
  }
}

export function runSelectedBranchChangedWorkflow(
  get: ReposGet,
  options: { id: string; token: number; branch: string; tab: DetailTab | undefined },
): void {
  if (options.tab === 'commits') void get().refreshBranchLog(options.id, options.branch, { token: options.token })
  void get().refreshPullRequests(options.id, [options.branch], { token: options.token, mode: 'full' })
}

export function runSelectedBranchStatusWorkflow(
  get: ReposGet,
  options: { id: string; token: number; selectedBranch: string | null | undefined },
): void {
  if (options.selectedBranch) {
    void get().refreshPullRequests(options.id, [options.selectedBranch], { token: options.token, mode: 'full' })
  }
}

export async function runBranchActionRefreshWorkflow(
  get: ReposGet,
  options: { id: string; token: number },
): Promise<void> {
  await Promise.all([
    get().refreshSnapshot(options.id, { token: options.token }),
    get().refreshStatus(options.id, { token: options.token }),
  ])
}

function repoFresh(get: ReposGet, id: string, token: number): boolean {
  const repo = get().repos[id]
  return !!repo && repo.instanceToken === token
}

async function refreshSelectedPullRequest(get: ReposGet, id: string, token: number): Promise<void> {
  const repo = get().repos[id]
  if (!repo || repo.instanceToken !== token || !repo.ui.selectedBranch) return
  await get().refreshPullRequests(id, [repo.ui.selectedBranch], { token, mode: 'full' })
}

async function refreshPullRequestsAfterSnapshot(
  get: ReposGet,
  options: { id: string; token: number; branchNames: string[]; isSnapshotCurrent: () => boolean },
): Promise<void> {
  if (!options.isSnapshotCurrent() || !repoFresh(get, options.id, options.token)) return
  await get().refreshPullRequests(options.id, options.branchNames, { token: options.token, mode: 'summary' })
  if (!options.isSnapshotCurrent() || !repoFresh(get, options.id, options.token)) return
  await refreshSelectedPullRequest(get, options.id, options.token)
  if (!options.isSnapshotCurrent() || !repoFresh(get, options.id, options.token)) return
  await get().refreshPullRequests(options.id, options.branchNames, {
    token: options.token,
    mode: 'full',
  })
}

export function runSnapshotSuccessWorkflow(
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
): void {
  if (!options.isSnapshotCurrent()) return
  persistRepoCache(set, get().repos[options.id], options.token)
  void terminalBridge.pruneRepo({ repoRoot: options.id, worktreePaths: options.worktreePaths }).catch((err) => {
    console.warn('[terminal] failed to prune repo sessions', err)
  })
  void (async () => {
    try {
      if (options.isSnapshotCurrent()) await refreshPullRequestsAfterSnapshot(get, options)
    } catch (err) {
      console.warn('[refreshPullRequests] failed', err)
      const message = err instanceof Error ? err.message : String(err)
      updateIfFresh(set, options.id, options.token, (r) => {
        r.events = appendRepoEvent(r.events, errorEvent(message))
      })
    }
  })()
  runSnapshotVisibleDetailBackfill(get, options)
}

function runSnapshotVisibleDetailBackfill(
  get: ReposGet,
  options: { id: string; token: number; isSnapshotCurrent: () => boolean; skipLogBackfill?: boolean },
): void {
  // If the user opened Commits while the snapshot was in flight,
  // their setDetailTab fired a refreshBranchLog that bailed out because
  // selectedBranch was still null. Now that we have it, backfill
  // the data they're actually looking at.
  //
  const after = get().repos[options.id]
  if (
    after &&
    after.instanceToken === options.token &&
    options.isSnapshotCurrent() &&
    after.ui.detailTab === 'commits' &&
    after.ui.selectedBranch &&
    !options.skipLogBackfill
  ) {
    void get().refreshBranchLog(options.id, after.ui.selectedBranch, { token: options.token })
  }
}

export async function runRefreshAllWorkflow(get: ReposGet, options: { id: string; token: number }): Promise<void> {
  await get().refreshSnapshot(options.id, { skipLogBackfill: true, token: options.token })
  // Status is always refreshed (regardless of which detail tab is
  // active) because the selected-branch detail toolbar surfaces the
  // dirty file count on every view. Log only matters when it's
  // visible, so we keep its refresh tab-gated.
  const after = get().repos[options.id]
  if (!after || after.instanceToken !== options.token) return
  if (after.availability.phase === 'unavailable') return
  await get().refreshStatus(options.id, { token: options.token })
  const afterStatus = get().repos[options.id]
  if (!afterStatus || afterStatus.instanceToken !== options.token) return
  if (afterStatus.ui.detailTab === 'commits')
    await get().refreshBranchLog(options.id, undefined, { token: options.token })
}

export async function runManualSyncResultWorkflow(
  get: ReposGet,
  options: { id: string; token: number; result: ExecResult },
): Promise<void> {
  if (!options.result.ok && options.result.message === 'cancelled') return
  get().setLastResult(options.id, options.result, options.token)
  if (!options.result.ok && options.result.message === 'error.network-op-in-progress') return
  await get().refreshAll(options.id, { token: options.token })
  if (options.result.ok) get().clearFetchFailed(options.id, options.token)
}

export async function runBackgroundFetchResultWorkflow(
  set: ReposSet,
  get: ReposGet,
  options: { id: string; token: number; result: ExecResult },
): Promise<void> {
  if (!options.result.ok) {
    if (options.result.message === 'cancelled' || options.result.message === 'error.network-op-in-progress') return
    if (isRepoUnavailableReason(options.result.message)) {
      await get().refreshSnapshot(options.id, { token: options.token })
      return
    }
    console.warn('[backgroundFetch] git fetch failed:', options.result.message)
    updateIfFresh(set, options.id, options.token, (r) => {
      r.remote.fetchFailed = true
      r.remote.fetchError = options.result.message
    })
    await get().refreshStatus(options.id, { token: options.token })
    return
  }
  // Success — clear the fail flag and refresh the snapshot/status.
  updateIfFresh(set, options.id, options.token, (r) => {
    r.remote.fetchFailed = false
    r.remote.fetchError = null
  })
  await get().refreshSnapshot(options.id, { token: options.token })
  await get().refreshStatus(options.id, { token: options.token })
}

export function recordBackgroundFetchThrownError(
  set: ReposSet,
  options: { id: string; token: number; message: string; error: unknown },
): void {
  console.warn('[backgroundFetch] threw:', options.error)
  updateIfFresh(set, options.id, options.token, (r) => {
    r.remote.fetchFailed = true
    r.remote.fetchError = options.message
  })
}
