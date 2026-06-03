import { appendRepoEvent, errorEvent, updateIfFresh } from '#/web/stores/repos/helpers.ts'
import { persistRepoCache } from '#/web/stores/repos/persistence.ts'
import { runRepoRefreshIntent } from '#/web/stores/repos/refresh-coordinator.ts'
import { terminalBridge } from '#/web/terminal.ts'
import type { DetailTab, ReposGet, ReposSet } from '#/web/stores/repos/types.ts'
import type { ExecResult } from '#/web/types.ts'

// Fire-and-forget refresh orchestration. Callers pass the repo token captured
// when the UI change happened; refresh methods still own final repo-exists and
// stale-token validation before writing results.
export function runInitialRepoLoad(get: ReposGet, refresh: { id: string; token: number }): void {
  void runRepoRefreshIntent(get, { kind: 'initial-load', id: refresh.id, token: refresh.token })
}

export function runBranchViewModeChangedWorkflow(
  get: ReposGet,
  options: {
    id: string
    token: number
    selectedForPullRequest: string | null
  },
): void {
  void runRepoRefreshIntent(get, { kind: 'branch-view-mode-changed', ...options })
}

export function runDetailTabChangedWorkflow(
  get: ReposGet,
  options: { id: string; token: number; tab: DetailTab | undefined; selectedBranch: string | null | undefined },
): void {
  void runRepoRefreshIntent(get, { kind: 'detail-tab-changed', ...options })
}

export function runSelectedBranchChangedWorkflow(
  get: ReposGet,
  options: { id: string; token: number; branch: string; tab: DetailTab | undefined },
): void {
  void runRepoRefreshIntent(get, { kind: 'selected-branch-changed', ...options })
}

export function runSelectedBranchStatusWorkflow(
  get: ReposGet,
  options: { id: string; token: number; selectedBranch: string | null | undefined },
): void {
  void runRepoRefreshIntent(get, { kind: 'selected-branch-status', ...options })
}

export async function runBranchActionRefreshWorkflow(
  get: ReposGet,
  options: { id: string; token: number },
): Promise<void> {
  await runRepoRefreshIntent(get, { kind: 'branch-action-settled', ...options })
}

function repoFresh(get: ReposGet, id: string, token: number): boolean {
  const repo = get().repos[id]
  return !!repo && repo.instanceToken === token
}

function pullRequestRefreshFailed(get: ReposGet, id: string, token: number): boolean {
  const repo = get().repos[id]
  return !!repo && repo.instanceToken === token && repo.resources.pullRequests.error !== null
}

async function refreshVisibleDetailPullRequest(get: ReposGet, id: string, token: number): Promise<void> {
  const repo = get().repos[id]
  if (!repo || repo.instanceToken !== token || repo.ui.detailTab !== 'status' || !repo.ui.selectedBranch) return
  await get().refreshPullRequests(id, [repo.ui.selectedBranch], { token, mode: 'full' })
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
}

export async function runRefreshAllWorkflow(get: ReposGet, options: { id: string; token: number }): Promise<void> {
  await get().refreshSnapshot(options.id, { skipLogBackfill: true, token: options.token })
  const after = get().repos[options.id]
  if (!after || after.instanceToken !== options.token) return
  if (after.availability.phase === 'unavailable') return
  await get().refreshStatus(options.id, { token: options.token })
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
