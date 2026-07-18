import { produce, type Draft } from 'immer'
import { isRemoteWorkspaceId, localWorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import { emptyWorkspaceOperations } from '#/web/stores/workspaces/operations.ts'
import { emptyWorkspaceDataLoadBundle } from '#/web/stores/workspaces/repo-data-load-state.ts'
import type { ExecResult } from '#/web/types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import type {
  GitWorkspaceProjection,
  RepoEvent,
  RepoResultEventOptions,
  WorkspaceState,
  WorkspacesStore,
} from '#/web/stores/workspaces/types.ts'

let nextEventId = 1

const MAX_REPO_EVENTS = 50

type RepoMutator = (repo: Draft<WorkspaceState>) => void
type ReposPatch = Pick<WorkspacesStore, 'workspaces'>

export function emptyWorkspace(id: string, name: string, workspaceRuntimeId: string): WorkspaceState {
  const workspaceId: WorkspaceId | null = canonicalWorkspaceLocator(id)
  if (!workspaceId) throw new Error('Workspace state requires a canonical workspace ID')
  return {
    id: workspaceId,
    name,
    workspaceRuntimeId,
    ui: { preferredWorkspacePaneTabByTarget: {} },
    session: {
      entry: isRemoteWorkspaceId(workspaceId) ? null : localWorkspaceSessionEntry(workspaceId),
      projectionState: 'projected',
    },
    availability: { phase: 'available' },
    admission: isRemoteWorkspaceId(workspaceId)
      ? { kind: 'remote', lifecycle: null, lifecycleAttemptId: null }
      : { kind: 'local' },
    capability: { kind: 'probing', probe: { status: 'probing' } },
  }
}

export function emptyGitWorkspaceProjection(): GitWorkspaceProjection {
  return {
    dataLoads: emptyWorkspaceDataLoadBundle(),
    operations: emptyWorkspaceOperations(),
    ui: { branchViewMode: 'all' },
    projection: { source: 'fresh', savedAt: null },
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
