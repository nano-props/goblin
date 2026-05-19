import type { RepoState, ReposSet, ReposStore } from '#/renderer/stores/repos/types.ts'

let nextInstanceToken = 1

export const inFlightFetchById = new Map<string, Promise<void>>()

export function emptyRepo(id: string, name: string): RepoState {
  return {
    id,
    name,
    instanceToken: nextInstanceToken++,
    branches: [],
    currentBranch: '',
    selectedBranch: null,
    log: [],
    selectedLogHash: null,
    status: [],
    rightTab: 'branches',
    openCommit: null,
    loading: false,
    fetching: false,
    fetchFailed: false,
    fetchError: null,
    error: null,
    lastResult: null,
  }
}

/** Apply `mutator` to the repo at `id` only if its instanceToken still
 *  matches the captured one. Returns true on success, false when the
 *  repo was closed/recreated since the caller captured the token. */
export function updateIfFresh(
  state: ReposStore,
  set: ReposSet,
  id: string,
  token: number,
  mutator: (repo: RepoState) => RepoState,
): boolean {
  const repo = state.repos[id]
  if (!repo || repo.instanceToken !== token) return false
  set({ repos: { ...state.repos, [id]: mutator(repo) } })
  return true
}
