import { isRemoteRepoId, type RemoteRepoRuntimeLifecycle } from '#/shared/remote-repo.ts'
import type { RepoRuntimeEntry, RepoRuntimesSnapshot } from '#/shared/api-types.ts'
import {
  markRemoteLifecycleConnecting,
  markRemoteLifecycleFailed,
  markRemoteLifecycleReady,
} from '#/web/stores/repos/availability.ts'
import { updateIfFresh } from '#/web/stores/repos/repo-guards.ts'
import type { ReposGet, ReposSet } from '#/web/stores/repos/types.ts'

const LIFECYCLE_PHASE_ORDER = { idle: 0, connecting: 1, ready: 2, failed: 2 } as const

export function acceptRemoteLifecycleProjection(
  set: ReposSet,
  get: ReposGet,
  entry: Pick<RepoRuntimeEntry, 'repoRoot' | 'repoRuntimeId' | 'remoteLifecycle'>,
  options: { name?: string } = {},
): boolean {
  const lifecycle = entry.remoteLifecycle
  if (!lifecycle || !isRemoteRepoId(entry.repoRoot)) return false
  const current = get().repos[entry.repoRoot]
  if (!current || current.repoRuntimeId !== entry.repoRuntimeId) return false
  if (!remoteLifecycleProjectionIsFresh(current.remote.lifecycleAttemptId, current.remote.lifecycle?.kind, lifecycle)) {
    return false
  }

  let accepted = false
  updateIfFresh(set, entry.repoRoot, entry.repoRuntimeId, (repo) => {
    if (!remoteLifecycleProjectionIsFresh(repo.remote.lifecycleAttemptId, repo.remote.lifecycle?.kind, lifecycle))
      return
    repo.remote.lifecycleAttemptId = lifecycle.attemptId
    if (lifecycle.kind === 'idle') repo.remote.lifecycle = null
    else if (lifecycle.kind === 'connecting') markRemoteLifecycleConnecting(repo)
    else if (lifecycle.kind === 'ready') {
      markRemoteLifecycleReady(repo, lifecycle.target)
      if (options.name) repo.name = options.name
    } else {
      markRemoteLifecycleFailed(repo, lifecycle.reason, lifecycle.target)
    }
    accepted = true
  })
  return accepted
}

export function acceptRemoteLifecycleSnapshot(set: ReposSet, get: ReposGet, snapshot: RepoRuntimesSnapshot): void {
  for (const entry of snapshot.runtimes) acceptRemoteLifecycleProjection(set, get, entry)
}

function remoteLifecycleProjectionIsFresh(
  acceptedAttemptId: number | null,
  acceptedKind: 'connecting' | 'ready' | 'failed' | undefined,
  incoming: RemoteRepoRuntimeLifecycle,
): boolean {
  if (acceptedAttemptId === null || incoming.attemptId > acceptedAttemptId) return true
  if (incoming.attemptId < acceptedAttemptId) return false
  const acceptedPhase = acceptedKind ? LIFECYCLE_PHASE_ORDER[acceptedKind] : LIFECYCLE_PHASE_ORDER.idle
  return LIFECYCLE_PHASE_ORDER[incoming.kind] >= acceptedPhase
}
