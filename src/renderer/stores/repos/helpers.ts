import type { RepoState, ReposSet } from '#/renderer/stores/repos/types.ts'

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
 *  matches the captured one. The check runs inside the functional
 *  setter so it reads the freshest store state, not the caller's
 *  pre-await snapshot. */
export function updateIfFresh(set: ReposSet, id: string, token: number, mutator: (repo: RepoState) => RepoState): void {
  set((s) => {
    const repo = s.repos[id]
    if (!repo || repo.instanceToken !== token) return s
    const nextRepo = mutator(repo)
    if (nextRepo === repo) return s
    return { repos: { ...s.repos, [id]: nextRepo } }
  })
}
