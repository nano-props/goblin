// Data-load state tracks UI-facing load phases (idle/loading/refreshing).
// Executability decisions use the operations system (operations.ts) instead;
// keeping the two separate eliminates the risk of drift.
import type { PullRequestFetchMode } from '#/web/types.ts'
export type RepoDataLoadPhase = 'idle' | 'loading' | 'refreshing'

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

export function dataLoadBusy(resource: RepoDataLoadState): boolean {
  return resource.phase !== 'idle'
}

export function dataLoadInitialLoading(resource: RepoDataLoadState): boolean {
  return resource.phase === 'loading'
}

export function startDataLoad(resource: RepoDataLoadState, options?: { hasData?: boolean }): void {
  resource.phase = resource.loadedAt !== null || options?.hasData ? 'refreshing' : 'loading'
  resource.error = null
}

export function finishDataLoadSuccess(resource: RepoDataLoadState, loadedAt: number = Date.now()): void {
  resource.phase = 'idle'
  resource.loadedAt = loadedAt
  resource.error = null
  resource.stale = false
}

export function finishDataLoadError(resource: RepoDataLoadState, error: string): void {
  const stale = resource.loadedAt !== null || resource.phase === 'refreshing'
  resource.phase = 'idle'
  resource.error = error
  resource.stale = stale
}

export function finishDataLoadUnavailable(resource: RepoDataLoadState): void {
  const stale = resource.loadedAt !== null || resource.phase === 'refreshing'
  resource.phase = 'idle'
  resource.error = null
  resource.stale = stale
}

export function cancelDataLoad(resource: RepoDataLoadState): void {
  resource.phase = 'idle'
}

export function startPullRequestDataLoad(
  resource: RepoPullRequestDataLoadState,
  mode: PullRequestFetchMode,
  options?: { hasData?: boolean },
): void {
  startDataLoad(resource, options)
  resource.mode = mode
}

export function finishPullRequestDataLoadSuccess(
  resource: RepoPullRequestDataLoadState,
  mode: PullRequestFetchMode,
  loadedAt: number = Date.now(),
): void {
  finishDataLoadSuccess(resource, loadedAt)
  resource.mode = mode
}

export function finishPullRequestDataLoadUnavailable(
  resource: RepoPullRequestDataLoadState,
  mode: PullRequestFetchMode,
): void {
  finishDataLoadUnavailable(resource)
  resource.mode = mode
}

export function finishPullRequestDataLoadError(resource: RepoPullRequestDataLoadState, error: string): void {
  finishDataLoadError(resource, error)
  resource.mode = null
}
