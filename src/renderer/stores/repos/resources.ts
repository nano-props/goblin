import type { PullRequestFetchMode } from '#/renderer/types.ts'

export type RepoResourcePhase = 'idle' | 'loading' | 'refreshing'

export interface RepoResourceState {
  phase: RepoResourcePhase
  loadedAt: number | null
  error: string | null
  stale: boolean
}

export interface RepoPullRequestResourceState extends RepoResourceState {
  mode: PullRequestFetchMode | null
}

export interface RepoResourcesState {
  snapshot: RepoResourceState
  status: RepoResourceState
  fetch: RepoResourceState
  pullRequests: RepoPullRequestResourceState
  pullRequestsByBranch: Record<string, RepoPullRequestResourceState>
  logsByBranch: Record<string, RepoResourceState>
}

export function idleResource(loadedAt: number | null = null): RepoResourceState {
  return {
    phase: 'idle',
    loadedAt,
    error: null,
    stale: false,
  }
}

export function idlePullRequestResource(
  loadedAt: number | null = null,
  mode: PullRequestFetchMode | null = null,
): RepoPullRequestResourceState {
  return {
    ...idleResource(loadedAt),
    mode,
  }
}

export function emptyRepoResources(): RepoResourcesState {
  return {
    snapshot: idleResource(),
    status: idleResource(),
    fetch: idleResource(),
    pullRequests: idlePullRequestResource(),
    pullRequestsByBranch: {},
    logsByBranch: {},
  }
}

export function resourceBusy(resource: RepoResourceState): boolean {
  return resource.phase !== 'idle'
}

export function resourceInitialLoading(resource: RepoResourceState): boolean {
  return resource.phase === 'loading'
}

export function startResource(resource: RepoResourceState, options?: { hasData?: boolean }): void {
  resource.phase = resource.loadedAt !== null || options?.hasData ? 'refreshing' : 'loading'
  resource.error = null
}

export function finishResourceSuccess(resource: RepoResourceState, loadedAt: number = Date.now()): void {
  resource.phase = 'idle'
  resource.loadedAt = loadedAt
  resource.error = null
  resource.stale = false
}

export function finishResourceError(resource: RepoResourceState, error: string): void {
  const stale = resource.loadedAt !== null || resource.phase === 'refreshing'
  resource.phase = 'idle'
  resource.error = error
  resource.stale = stale
}

export function finishResourceUnavailable(resource: RepoResourceState): void {
  const stale = resource.loadedAt !== null || resource.phase === 'refreshing'
  resource.phase = 'idle'
  resource.error = null
  resource.stale = stale
}

export function cancelResource(resource: RepoResourceState): void {
  resource.phase = 'idle'
}

export function startPullRequestResource(
  resource: RepoPullRequestResourceState,
  mode: PullRequestFetchMode,
  options?: { hasData?: boolean },
): void {
  startResource(resource, options)
  resource.mode = mode
}

export function finishPullRequestResourceSuccess(
  resource: RepoPullRequestResourceState,
  mode: PullRequestFetchMode,
  loadedAt: number = Date.now(),
): void {
  finishResourceSuccess(resource, loadedAt)
  resource.mode = mode
}

export function finishPullRequestResourceUnavailable(
  resource: RepoPullRequestResourceState,
  mode: PullRequestFetchMode,
): void {
  finishResourceUnavailable(resource)
  resource.mode = mode
}

export function finishPullRequestResourceError(resource: RepoPullRequestResourceState, error: string): void {
  finishResourceError(resource, error)
  resource.mode = null
}
