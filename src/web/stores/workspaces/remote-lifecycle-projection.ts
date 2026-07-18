import { isRemoteRepoId, type RemoteRepoRuntimeLifecycle } from '#/shared/remote-repo.ts'
import type { WorkspaceRuntimeEntry, WorkspaceRuntimesSnapshot } from '#/shared/api-types.ts'
import {
  markRemoteLifecycleConnecting,
  markRemoteLifecycleFailed,
  markRemoteLifecycleReady,
} from '#/web/stores/workspaces/availability.ts'
import { updateIfFresh } from '#/web/stores/workspaces/workspace-guards.ts'
import type { WorkspacesGet, WorkspacesSet } from '#/web/stores/workspaces/types.ts'

const LIFECYCLE_PHASE_ORDER = { idle: 0, connecting: 1, ready: 2, failed: 2 } as const

export function acceptRemoteLifecycleProjection(
  set: WorkspacesSet,
  get: WorkspacesGet,
  entry: Pick<WorkspaceRuntimeEntry, 'workspaceId' | 'workspaceRuntimeId' | 'remoteLifecycle'>,
  options: { name?: string } = {},
): boolean {
  const lifecycle = entry.remoteLifecycle
  if (!lifecycle || !isRemoteRepoId(entry.workspaceId)) return false
  const current = get().workspaces[entry.workspaceId]
  if (!current || current.workspaceRuntimeId !== entry.workspaceRuntimeId) return false
  if (current.admission.kind !== 'remote') return false
  if (!remoteLifecycleProjectionIsFresh(current.admission.lifecycleAttemptId, current.admission.lifecycle?.kind, lifecycle)) {
    return false
  }

  let accepted = false
  updateIfFresh(set, entry.workspaceId, entry.workspaceRuntimeId, (repo) => {
    if (repo.admission.kind !== 'remote') return
    if (!remoteLifecycleProjectionIsFresh(repo.admission.lifecycleAttemptId, repo.admission.lifecycle?.kind, lifecycle))
      return
    repo.admission.lifecycleAttemptId = lifecycle.attemptId
    if (lifecycle.kind === 'idle') {
      repo.admission.lifecycle = null
    }
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

export function acceptRemoteLifecycleSnapshot(set: WorkspacesSet, get: WorkspacesGet, snapshot: WorkspaceRuntimesSnapshot): void {
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
