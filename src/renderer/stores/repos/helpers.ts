import { produce, type Draft } from 'immer'
import { emptyRepoOperations } from '#/renderer/stores/repos/operations.ts'
import { emptyRepoResources } from '#/renderer/stores/repos/resources.ts'
import type {
  RepoEvent,
  RepoResultEventOptions,
  RepoState,
  ReposSet,
  ReposStore,
} from '#/renderer/stores/repos/types.ts'

let nextInstanceToken = 1
let nextEventId = 1

const MAX_REPO_EVENTS = 50

export const inFlightFetchById = new Map<string, Promise<void>>()

type RepoMutator = (repo: Draft<RepoState>) => void
type ReposPatch = Pick<ReposStore, 'repos'>

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
      worktreesByPath: {},
    },
    resources: emptyRepoResources(),
    operations: emptyRepoOperations(),
    ui: {
      selectedBranch: null,
      branchViewMode: 'all',
      detailTab: 'status',
      commitDetail: { phase: 'idle' },
    },
    cache: {
      source: 'fresh',
      savedAt: null,
    },
    remote: {
      remotes: [],
      hasRemotes: false,
      hasBrowserRemote: false,
      browserRemoteProvider: undefined,
      remoteProviders: {},
      hasGitHubRemote: false,
      fetchFailed: false,
      fetchError: null,
    },
    availability: { phase: 'available' },
    events: [],
  }
}

export function resultEvent(result: { ok: boolean; message: string }, options?: RepoResultEventOptions): RepoEvent {
  return { id: nextEventId++, kind: 'result', result, action: options?.action }
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
    return replaceRepoState(s, repo, mutator)
  })
}

export function replaceRepo(repo: RepoState, mutator: RepoMutator): RepoState {
  return produce(repo, mutator)
}

export function replaceRepoState(state: ReposPatch, repo: RepoState, mutator: RepoMutator): ReposPatch {
  const nextRepo = replaceRepo(repo, mutator)
  return nextRepo === repo ? state : { repos: { ...state.repos, [repo.id]: nextRepo } }
}
