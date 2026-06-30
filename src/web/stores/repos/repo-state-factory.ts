import { produce, type Draft } from 'immer'
import { emptyRepoOperations } from '#/web/stores/repos/operations.ts'
import { emptyRepoDataLoadBundle } from '#/web/stores/repos/repo-data-load-state.ts'
import type { ExecResult } from '#/web/types.ts'
import type { RepoEvent, RepoResultEventOptions, RepoState, ReposStore } from '#/web/stores/repos/types.ts'

let nextInstanceToken = 1
let nextEventId = 1

const MAX_REPO_EVENTS = 50

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
      status: [],
      statusLoaded: false,
      worktreesByPath: {},
    },
    dataLoads: emptyRepoDataLoadBundle(),
    operations: emptyRepoOperations(),
    ui: {
      selectedBranch: null,
      branchViewMode: 'all',
      workspacePaneTabsByBranch: {},
      preferredWorkspacePaneTabByBranch: {},
    },
    projection: {
      source: 'fresh',
      savedAt: null,
    },
    remote: {
      // Local repos never have a remote lifecycle. Remote repos set this
      // through addResolvedRepo / addUnavailableRepo / insertPlaceholderRepo.
      lifecycle: null,
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
