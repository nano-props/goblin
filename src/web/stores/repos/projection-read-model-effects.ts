import { terminalLog } from '#/web/logger.ts'
import { terminalClient } from '#/web/terminal.ts'
import { appendRepoEvent, errorEvent } from '#/web/stores/repos/repo-state-factory.ts'
import { updateIfFresh } from '#/web/stores/repos/repo-guards.ts'
import { persistRepoSnapshotCacheEntry } from '#/web/stores/repos/persistence.ts'
import { applyRepoSnapshotShellState } from '#/web/stores/repos/refresh-state.ts'
import { finishDataLoadError, finishDataLoadSuccess } from '#/web/stores/repos/repo-data-load-state.ts'
import type { RepoRuntimeProjection } from '#/shared/api-types.ts'
import type { ReposGet, ReposSet } from '#/web/stores/repos/types.ts'

interface AcceptedRepoProjectionReadModel {
  repoRoot: string
  repoRuntimeId: string
  projection: RepoRuntimeProjection | null
}

type AcceptRepoProjectionReadModelScope = 'query-cache' | 'repo-read-model' | 'visible-status'

interface AcceptRepoProjectionReadModelOptions {
  scope: AcceptRepoProjectionReadModelScope
  settleVisibleStatus?: boolean
}

interface CoreRepoProjectionAcceptanceSignature {
  readLoadedAt: number
  snapshot: RepoRuntimeProjection['snapshot']
  status: RepoRuntimeProjection['status']
  pullRequests: RepoRuntimeProjection['pullRequests']
}

const acceptedCoreRepoProjectionSignaturesByKey = new Map<string, CoreRepoProjectionAcceptanceSignature>()

function acceptedProjectionKey(input: AcceptedRepoProjectionReadModel & { projection: RepoRuntimeProjection }): string {
  return [
    input.repoRoot,
    input.repoRuntimeId,
    input.projection.requested.branch ?? '',
    input.projection.requested.pullRequestMode,
  ].join('\0')
}

function authoritativeProjection(projection: RepoRuntimeProjection): boolean {
  // Warm-start placeholders are seeded with loadedAt=0. They can hydrate the
  // query cache, but they must not be treated as an authoritative server read.
  return projection.loadedAt > 0
}

function coreProjectionAcceptanceSignature(projection: RepoRuntimeProjection): CoreRepoProjectionAcceptanceSignature {
  return {
    readLoadedAt: projection.loadedAt,
    snapshot: projection.snapshot,
    status: projection.status,
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
    left.status === right.status &&
    left.pullRequests === right.pullRequests
  )
}

function markCoreProjectionAccepted(input: AcceptedRepoProjectionReadModel & { projection: RepoRuntimeProjection }): boolean {
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
  set: ReposSet,
  get: ReposGet,
  input: AcceptedRepoProjectionReadModel,
  options: AcceptRepoProjectionReadModelOptions,
): void {
  const { repoRoot, repoRuntimeId, projection } = input
  // Stub leases (non-active repos at cold start) carry `null`. Nothing to
  // accept — the lazy restore will fill the projection on navigation.
  if (!projection) return
  if (!authoritativeProjection(projection)) return
  const coreProjection = projection.requested.branch === null && projection.requested.pullRequestMode === 'full'
  const acceptCoreReadModel = options.scope === 'repo-read-model' && coreProjection
  const settleVisibleStatus =
    options.settleVisibleStatus ?? (options.scope === 'visible-status' || acceptCoreReadModel)
  const repoBefore = get().repos[repoRoot]
  if (!repoBefore || repoBefore.repoRuntimeId !== repoRuntimeId) return
  if (settleVisibleStatus) {
    updateIfFresh(set, repoRoot, repoRuntimeId, (repo) => {
      if (projection.snapshot) finishDataLoadSuccess(repo.dataLoads.visibleStatus, projection.loadedAt)
      else finishDataLoadError(repo.dataLoads.visibleStatus, 'error.failed-read-repo')
    })
  }
  if (!acceptCoreReadModel) return
  if (!markCoreProjectionAccepted({ repoRoot, repoRuntimeId, projection })) return

  if (!projection.snapshot) {
    updateIfFresh(set, repoRoot, repoRuntimeId, (repo) => {
      finishDataLoadError(repo.dataLoads.repoReadModel, 'error.failed-read-repo')
      repo.events = appendRepoEvent(repo.events, errorEvent('error.failed-read-repo'))
    })
    return
  }

  updateIfFresh(set, repoRoot, repoRuntimeId, (repo) => {
    applyRepoSnapshotShellState(repo, projection.snapshot!, projection.loadedAt)
  })

  persistRepoSnapshotCacheEntry(set, get().repos[repoRoot], repoRuntimeId)
  void terminalClient.pruneTerminals(repoRoot, repoRuntimeId).catch((err) => {
    terminalLog.warn('failed to prune repo sessions', { err })
  })
}
