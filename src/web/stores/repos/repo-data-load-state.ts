// Data-load state tracks UI-facing load phases (idle/loading/refreshing).
// Executability decisions use the operations system (operations.ts) instead;
// keeping the two separate eliminates the risk of drift.
import type { PullRequestFetchMode } from '#/web/types.ts'
type RepoDataLoadPhase = 'idle' | 'loading' | 'refreshing'

export interface RepoDataLoadState {
  phase: RepoDataLoadPhase
  loadedAt: number | null
  error: string | null
  stale: boolean
}

export interface RepoPullRequestDataLoadState extends RepoDataLoadState {
  mode: PullRequestFetchMode | null
}

export interface RepoDataLoadBundle {
  snapshot: RepoDataLoadState
  status: RepoDataLoadState
  fetch: RepoDataLoadState
  pullRequests: RepoPullRequestDataLoadState
  pullRequestsByBranch: Record<string, RepoPullRequestDataLoadState>
}

export function idleDataLoad(loadedAt: number | null = null): RepoDataLoadState {
  return {
    phase: 'idle',
    loadedAt,
    error: null,
    stale: false,
  }
}

export function idlePullRequestDataLoad(
  loadedAt: number | null = null,
  mode: PullRequestFetchMode | null = null,
): RepoPullRequestDataLoadState {
  return {
    ...idleDataLoad(loadedAt),
    mode,
  }
}

export function emptyRepoDataLoadBundle(): RepoDataLoadBundle {
  return {
    snapshot: idleDataLoad(),
    status: idleDataLoad(),
    fetch: idleDataLoad(),
    pullRequests: idlePullRequestDataLoad(),
    pullRequestsByBranch: {},
  }
}

export function dataLoadBusy(dataLoad: RepoDataLoadState): boolean {
  return dataLoad.phase !== 'idle'
}

export function dataLoadInitialLoading(dataLoad: RepoDataLoadState): boolean {
  return dataLoad.phase === 'loading'
}

export function startDataLoad(dataLoad: RepoDataLoadState, options?: { hasData?: boolean }): void {
  dataLoad.phase = dataLoad.loadedAt !== null || options?.hasData ? 'refreshing' : 'loading'
  dataLoad.error = null
}

export function finishDataLoadSuccess(dataLoad: RepoDataLoadState, loadedAt: number = Date.now()): void {
  dataLoad.phase = 'idle'
  dataLoad.loadedAt = loadedAt
  dataLoad.error = null
  dataLoad.stale = false
}

export function finishDataLoadError(dataLoad: RepoDataLoadState, error: string): void {
  const stale = dataLoad.loadedAt !== null || dataLoad.phase === 'refreshing'
  dataLoad.phase = 'idle'
  dataLoad.error = error
  dataLoad.stale = stale
}

function finishDataLoadUnavailable(dataLoad: RepoDataLoadState): void {
  const stale = dataLoad.loadedAt !== null || dataLoad.phase === 'refreshing'
  dataLoad.phase = 'idle'
  dataLoad.error = null
  dataLoad.stale = stale
}

export function cancelDataLoad(dataLoad: RepoDataLoadState): void {
  dataLoad.phase = 'idle'
}

export function startPullRequestDataLoad(
  dataLoad: RepoPullRequestDataLoadState,
  mode: PullRequestFetchMode,
  options?: { hasData?: boolean },
): void {
  startDataLoad(dataLoad, options)
  dataLoad.mode = mode
}

export function finishPullRequestDataLoadSuccess(
  dataLoad: RepoPullRequestDataLoadState,
  mode: PullRequestFetchMode,
  loadedAt: number = Date.now(),
): void {
  finishDataLoadSuccess(dataLoad, loadedAt)
  dataLoad.mode = mode
}

export function finishPullRequestDataLoadUnavailable(
  dataLoad: RepoPullRequestDataLoadState,
  mode: PullRequestFetchMode,
): void {
  finishDataLoadUnavailable(dataLoad)
  dataLoad.mode = mode
}

export function finishPullRequestDataLoadError(dataLoad: RepoPullRequestDataLoadState, error: string): void {
  finishDataLoadError(dataLoad, error)
  dataLoad.mode = null
}
