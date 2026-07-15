import { produce, type Draft } from 'immer'
import { isRemoteRepoId, localRepoSessionEntry } from '#/shared/remote-repo.ts'
import { emptyRepoOperations } from '#/web/stores/repos/operations.ts'
import { emptyRepoDataLoadBundle } from '#/web/stores/repos/repo-data-load-state.ts'
import type { ExecResult } from '#/web/types.ts'
import type { RepoEvent, RepoResultEventOptions, RepoState, ReposStore } from '#/web/stores/repos/types.ts'

let nextEventId = 1

const MAX_REPO_EVENTS = 50

type RepoMutator = (repo: Draft<RepoState>) => void
type ReposPatch = Pick<ReposStore, 'repos'>

export function emptyRepo(id: string, name: string, repoRuntimeId: string): RepoState {
  return {
    id,
    name,
    repoRuntimeId,
    dataLoads: emptyRepoDataLoadBundle(),
    operations: emptyRepoOperations(),
    ui: {
      branchViewMode: 'all',
      preferredWorkspacePaneTabByTarget: {},
    },
    projection: {
      source: 'fresh',
      savedAt: null,
    },
    session: {
      entry: isRemoteRepoId(id) ? null : localRepoSessionEntry(id),
      projectionState: 'projected',
    },
    remote: {
      // Local repos never have a remote lifecycle. Remote shells remain null
      // until a server runtime projection is accepted.
      lifecycle: null,
      lifecycleAttemptId: null,
      remotes: [],
      remoteDetails: [],
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

export function resultEvent(result: ExecResult, options?: RepoResultEventOptions): RepoEvent {
  return { id: nextEventId++, kind: 'result', result, action: options?.action }
}

export function errorEvent(message: string): RepoEvent {
  return { id: nextEventId++, kind: 'error', message }
}

export function appendRepoEvent(events: RepoEvent[], event: RepoEvent): RepoEvent[] {
  return [...events, event].slice(-MAX_REPO_EVENTS)
}

export function replaceRepo(repo: RepoState, mutator: RepoMutator): RepoState {
  return produce(repo, mutator)
}

export function replaceRepoState(state: ReposPatch, repo: RepoState, mutator: RepoMutator): ReposPatch {
  const nextRepo = replaceRepo(repo, mutator)
  return nextRepo === repo ? state : { repos: { ...state.repos, [repo.id]: nextRepo } }
}
