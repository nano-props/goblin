// Data-load state tracks UI-facing load phases (idle/loading/refreshing).
// Executability decisions use the operations system (operations.ts) instead;
// keeping the two separate eliminates the risk of drift.
type RepoDataLoadPhase = 'idle' | 'loading' | 'refreshing'

export interface RepoDataLoadState {
  phase: RepoDataLoadPhase
  loadedAt: number | null
  error: string | null
  stale: boolean
}

export interface RepoDataLoadBundle {
  repoReadModel: RepoDataLoadState
  visibleStatus: RepoDataLoadState
  fetch: RepoDataLoadState
}

export function idleDataLoad(loadedAt: number | null = null): RepoDataLoadState {
  return {
    phase: 'idle',
    loadedAt,
    error: null,
    stale: false,
  }
}

export function emptyRepoDataLoadBundle(): RepoDataLoadBundle {
  return {
    repoReadModel: idleDataLoad(),
    visibleStatus: idleDataLoad(),
    fetch: idleDataLoad(),
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

export function cancelDataLoad(dataLoad: RepoDataLoadState): void {
  dataLoad.phase = 'idle'
}
