import { terminalLog } from '#/web/logger.ts'
import { terminalClient } from '#/web/terminal.ts'
import { appendRepoEvent, errorEvent } from '#/web/stores/workspaces/workspace-state-factory.ts'
import { updateIfFresh } from '#/web/stores/workspaces/workspace-guards.ts'
import { persistRepoSnapshotCacheEntry } from '#/web/stores/workspaces/persistence.ts'
import { applyRepoSnapshotShellState } from '#/web/stores/workspaces/refresh-state.ts'
import { finishDataLoadError } from '#/web/stores/workspaces/repo-data-load-state.ts'
import type { WorkspaceRuntimeProjection } from '#/shared/api-types.ts'
import type { WorkspacesGet, WorkspacesSet } from '#/web/stores/workspaces/types.ts'
import { gitWorkspaceProjection, isGitWorkspace } from '#/web/stores/workspaces/git-workspace-projection.ts'

interface AcceptedRepoProjectionReadModel {
  repoRoot: string
  workspaceRuntimeId: string
  projection: WorkspaceRuntimeProjection | null
}

type AcceptRepoProjectionReadModelScope = 'query-cache' | 'repo-read-model'

interface AcceptRepoProjectionReadModelOptions {
  scope: AcceptRepoProjectionReadModelScope
}

interface CoreRepoProjectionAcceptanceSignature {
  readLoadedAt: number
  snapshot: WorkspaceRuntimeProjection['snapshot']
  pullRequests: WorkspaceRuntimeProjection['pullRequests']
}

const acceptedCoreRepoProjectionSignaturesByKey = new Map<string, CoreRepoProjectionAcceptanceSignature>()

function acceptedProjectionKey(
  input: AcceptedRepoProjectionReadModel & { projection: WorkspaceRuntimeProjection },
): string {
  return [
    input.repoRoot,
    input.workspaceRuntimeId,
    input.projection.requested.branch ?? '',
    input.projection.requested.pullRequestMode,
  ].join('\0')
}

function authoritativeProjection(projection: WorkspaceRuntimeProjection): boolean {
  // Warm-start placeholders are seeded with loadedAt=0. They can hydrate the
  // query cache, but they must not be treated as an authoritative server read.
  return projection.loadedAt > 0
}

function coreProjectionAcceptanceSignature(
  projection: WorkspaceRuntimeProjection,
): CoreRepoProjectionAcceptanceSignature {
  return {
    readLoadedAt: projection.loadedAt,
    snapshot: projection.snapshot,
    pullRequests: projection.pullRequests,
  }
}

function sameCoreProjectionAcceptanceSignature(
  left: CoreRepoProjectionAcceptanceSignature,
  right: CoreRepoProjectionAcceptanceSignature,
): boolean {
  return (
    left.readLoadedAt === right.readLoadedAt &&
    left.snapshot === right.snapshot &&
    left.pullRequests === right.pullRequests
  )
}

function markCoreProjectionAccepted(
  input: AcceptedRepoProjectionReadModel & { projection: WorkspaceRuntimeProjection },
): boolean {
  const key = acceptedProjectionKey(input)
  const signature = coreProjectionAcceptanceSignature(input.projection)
  const previous = acceptedCoreRepoProjectionSignaturesByKey.get(key)
  if (previous && sameCoreProjectionAcceptanceSignature(previous, signature)) return false
  acceptedCoreRepoProjectionSignaturesByKey.set(key, signature)
  return true
}

export function resetAcceptedRepoProjectionReadModelState(): void {
  acceptedCoreRepoProjectionSignaturesByKey.clear()
}

export function acceptRepoProjectionReadModel(
  set: WorkspacesSet,
  get: WorkspacesGet,
  input: AcceptedRepoProjectionReadModel,
  options: AcceptRepoProjectionReadModelOptions,
): void {
  const { repoRoot, workspaceRuntimeId, projection } = input
  // Stub leases (non-active repos at cold start) carry `null`. Nothing to
  // accept — the lazy restore will fill the projection on navigation.
  if (!projection) return
  if (!authoritativeProjection(projection)) return
  const coreProjection = projection.requested.branch === null && projection.requested.pullRequestMode === 'full'
  const acceptCoreReadModel = options.scope === 'repo-read-model' && coreProjection
  const repoBefore = get().workspaces[repoRoot]
  if (!repoBefore || repoBefore.workspaceRuntimeId !== workspaceRuntimeId) return
  if (!isGitWorkspace(repoBefore)) return
  if (!acceptCoreReadModel) return
  if (!markCoreProjectionAccepted({ repoRoot, workspaceRuntimeId, projection })) return

  if (!projection.snapshot) {
    updateIfFresh(set, repoRoot, workspaceRuntimeId, (repo) => {
      if (!isGitWorkspace(repo)) return
      const git = gitWorkspaceProjection(repo)
      finishDataLoadError(git.dataLoads.repoReadModel, 'error.failed-read-repo')
      git.events = appendRepoEvent(git.events, errorEvent('error.failed-read-repo'))
    })
    return
  }

  updateIfFresh(set, repoRoot, workspaceRuntimeId, (repo) => {
    applyRepoSnapshotShellState(repo, projection.snapshot!, projection.loadedAt)
  })

  persistRepoSnapshotCacheEntry(set, get().workspaces[repoRoot], workspaceRuntimeId)
  void terminalClient.pruneTerminals(repoRoot, workspaceRuntimeId).catch((err) => {
    terminalLog.warn('failed to prune repo sessions', { err })
  })
}
