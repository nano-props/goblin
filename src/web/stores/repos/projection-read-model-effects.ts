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
  projection: RepoRuntimeProjection
}

interface AcceptRepoProjectionReadModelOptions {
  settleVisibleStatus?: boolean
}

interface AcceptedProjectionSignature {
  loadedAt: number
  snapshot: RepoRuntimeProjection['snapshot']
  status: RepoRuntimeProjection['status']
  pullRequests: RepoRuntimeProjection['pullRequests']
}

const acceptedRepoProjectionSignatureByKey = new Map<string, AcceptedProjectionSignature>()

function acceptedProjectionKey(input: AcceptedRepoProjectionReadModel): string {
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

function markProjectionAccepted(input: AcceptedRepoProjectionReadModel): boolean {
  const key = acceptedProjectionKey(input)
  const previous = acceptedRepoProjectionSignatureByKey.get(key)
  if (
    previous &&
    previous.loadedAt === input.projection.loadedAt &&
    previous.snapshot === input.projection.snapshot &&
    previous.status === input.projection.status &&
    previous.pullRequests === input.projection.pullRequests
  ) {
    return false
  }
  acceptedRepoProjectionSignatureByKey.set(key, {
    loadedAt: input.projection.loadedAt,
    snapshot: input.projection.snapshot,
    status: input.projection.status,
    pullRequests: input.projection.pullRequests,
  })
  return true
}

export function resetAcceptedRepoProjectionReadModelState(): void {
  acceptedRepoProjectionSignatureByKey.clear()
}

export function acceptRepoProjectionReadModel(
  set: ReposSet,
  get: ReposGet,
  input: AcceptedRepoProjectionReadModel,
  options: AcceptRepoProjectionReadModelOptions = {},
): void {
  const { repoRoot, repoRuntimeId, projection } = input
  if (!authoritativeProjection(projection)) return
  const coreReadModel = projection.requested.branch === null && projection.requested.pullRequestMode === 'full'
  const repoBefore = get().repos[repoRoot]
  if (!repoBefore || repoBefore.repoRuntimeId !== repoRuntimeId) return
  const explicitVisibleStatusSettle = options.settleVisibleStatus === true
  const settleVisibleStatus =
    explicitVisibleStatusSettle || (options.settleVisibleStatus === undefined && coreReadModel)
  if (!projection.snapshot && !coreReadModel && !settleVisibleStatus) return
  const accepted = markProjectionAccepted(input)
  if (!accepted && !explicitVisibleStatusSettle) return
  if (settleVisibleStatus) {
    updateIfFresh(set, repoRoot, repoRuntimeId, (repo) => {
      if (projection.snapshot) finishDataLoadSuccess(repo.dataLoads.visibleStatus, projection.loadedAt)
      else finishDataLoadError(repo.dataLoads.visibleStatus, 'error.failed-read-repo')
    })
  }
  if (!accepted) return

  if (!projection.snapshot) {
    updateIfFresh(set, repoRoot, repoRuntimeId, (repo) => {
      if (coreReadModel) finishDataLoadError(repo.dataLoads.repoReadModel, 'error.failed-read-repo')
      repo.events = appendRepoEvent(repo.events, errorEvent('error.failed-read-repo'))
    })
    return
  }

  updateIfFresh(set, repoRoot, repoRuntimeId, (repo) => {
    if (coreReadModel) {
      applyRepoSnapshotShellState(repo, projection.snapshot!, projection.loadedAt)
    }
  })

  if (!coreReadModel) return
  persistRepoSnapshotCacheEntry(set, get().repos[repoRoot], repoRuntimeId)
  void terminalClient.pruneTerminals(repoRoot, repoRuntimeId).catch((err) => {
    terminalLog.warn('failed to prune repo sessions', { err })
  })
}
