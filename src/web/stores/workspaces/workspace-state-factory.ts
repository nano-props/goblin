import { produce, type Draft } from 'immer'
import { isRemoteRepoId, localWorkspaceSessionEntry } from '#/shared/remote-repo.ts'
import { emptyWorkspaceOperations } from '#/web/stores/workspaces/operations.ts'
import { emptyWorkspaceDataLoadBundle } from '#/web/stores/workspaces/repo-data-load-state.ts'
import type { ExecResult } from '#/web/types.ts'
import type { RepoEvent, RepoResultEventOptions, WorkspaceState, WorkspacesStore } from '#/web/stores/workspaces/types.ts'

let nextEventId = 1

const MAX_REPO_EVENTS = 50

type RepoMutator = (repo: Draft<WorkspaceState>) => void
type ReposPatch = Pick<WorkspacesStore, 'workspaces'>

export function emptyWorkspace(id: string, name: string, workspaceRuntimeId: string): WorkspaceState {
  return {
    id,
    name,
    workspaceRuntimeId,
    dataLoads: emptyWorkspaceDataLoadBundle(),
    operations: emptyWorkspaceOperations(),
    ui: {
      branchViewMode: 'all',
      preferredWorkspacePaneTabByTarget: {},
    },
    projection: {
      source: 'fresh',
      savedAt: null,
    },
    session: {
      entry: isRemoteRepoId(id) ? null : localWorkspaceSessionEntry(id),
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
    workspaceProbe: { status: 'probing' },
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

export function replaceWorkspace(repo: WorkspaceState, mutator: RepoMutator): WorkspaceState {
  return produce(repo, mutator)
}

export function replaceWorkspaceState(state: ReposPatch, repo: WorkspaceState, mutator: RepoMutator): ReposPatch {
  const nextRepo = replaceWorkspace(repo, mutator)
  return nextRepo === repo ? state : { workspaces: { ...state.workspaces, [repo.id]: nextRepo } }
}
