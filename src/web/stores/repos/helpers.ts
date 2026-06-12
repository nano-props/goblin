import { produce, type Draft } from 'immer'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'
import { emptyRepoOperations } from '#/web/stores/repos/operations.ts'
import { emptyRepoResources } from '#/web/stores/repos/resources.ts'
import type {
  RepoEvent,
  RepoResultEventOptions,
  RepoState,
  ReposSet,
  ReposStore,
} from '#/web/stores/repos/types.ts'

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
    resources: emptyRepoResources(),
    operations: emptyRepoOperations(),
    ui: {
      selectedBranch: null,
      branchViewMode: 'all',
      detailTab: 'status',
    },
    projection: {
      source: 'fresh',
      savedAt: null,
    },
    remote: {
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

/**
 * Live SSH liveness state for remote repos. Derived — never stored —
 * from `isRemoteRepoId(id)` + `remote.target` presence + `availability.phase`,
 * so all three transitions (placeholder → connected / unreachable) fall
 * out of the existing state mutations without a separate write.
 *   - `connecting`:  remote repo whose concrete target hasn't been
 *     resolved yet (boot probe in flight)
 *   - `connected`:   remote repo with a resolved target that's still
 *     reachable; also the default for local repos
 *   - `unreachable`: remote repo whose last probe / check failed
 *
 * Co-located with `deriveConnectivity` (the only meaningful producer)
 * rather than the general `types.ts` to keep the connectivity domain
 * in one place.
 */
export type RepoConnectivity = 'connecting' | 'connected' | 'unreachable'

export function deriveConnectivity(repo: RepoState): RepoConnectivity {
  if (!isRemoteRepoId(repo.id)) return 'connected'
  if (repo.availability.phase === 'unavailable') return 'unreachable'
  if (!repo.remote.target) return 'connecting'
  return 'connected'
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
