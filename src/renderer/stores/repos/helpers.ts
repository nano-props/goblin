import { produce, type Draft } from 'immer'
import type { RepoEvent, RepoState, ReposSet } from '#/renderer/stores/repos/types.ts'

let nextInstanceToken = 1
let nextEventId = 1

const MAX_REPO_EVENTS = 50

export const inFlightFetchById = new Map<string, Promise<void>>()

type RepoMutator = (repo: Draft<RepoState>) => void

export function emptyRepo(id: string, name: string): RepoState {
  return {
    id,
    name,
    instanceToken: nextInstanceToken++,
    data: {
      branches: [],
      currentBranch: '',
      logsByBranch: {},
      status: [],
      statusLoaded: false,
    },
    ui: {
      selectedBranch: null,
      branchViewMode: 'all',
      detailTab: 'status',
      openCommit: null,
      openingCommitHash: null,
    },
    async: {
      statusLoading: true,
      statusError: null,
      loading: true,
      syncing: false,
      lastFetchSettledAt: null,
      fetching: false,
      refreshing: false,
      pullRequestsLoading: false,
      pullRequestsRequestId: 0,
    },
    cache: {
      source: 'fresh',
      savedAt: null,
    },
    remote: {
      fetchFailed: false,
      fetchError: null,
    },
    events: [],
  }
}

export function resultEvent(result: { ok: boolean; message: string }): RepoEvent {
  return { id: nextEventId++, kind: 'result', result }
}

export function errorEvent(message: string): RepoEvent {
  return { id: nextEventId++, kind: 'error', message }
}

export function appendRepoEvent(events: RepoEvent[], event: RepoEvent): RepoEvent[] {
  return [...events, event].slice(-MAX_REPO_EVENTS)
}

/** Apply `mutator` to the repo at `id` only if its instanceToken still
 *  matches the captured one. The check runs inside the functional
 *  setter so it reads the freshest store state, not the caller's
 *  pre-await snapshot. */
export function updateIfFresh(set: ReposSet, id: string, token: number, mutator: RepoMutator): void {
  set((s) => {
    const repo = s.repos[id]
    if (!repo || repo.instanceToken !== token) return s
    const nextRepo = produce(repo, mutator)
    if (nextRepo === repo) return s
    return { repos: { ...s.repos, [id]: nextRepo } }
  })
}
