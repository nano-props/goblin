import { isRemoteWorkspaceId, type RemoteWorkspaceRuntimeLifecycle } from '#/shared/remote-workspace.ts'
import type { WorkspaceRuntimeEntry, WorkspaceRuntimesSnapshot } from '#/shared/api-types.ts'
import {
  markRemoteLifecycleConnecting,
  markRemoteLifecycleFailed,
  markRemoteLifecycleReady,
} from '#/web/stores/workspaces/remote-workspace-admission.ts'
import { acceptWorkspaceProbeState, updateIfFresh } from '#/web/stores/workspaces/workspace-guards.ts'
import type { WorkspaceState, WorkspacesGet, WorkspacesSet } from '#/web/stores/workspaces/types.ts'

const LIFECYCLE_PHASE_ORDER = { idle: 0, connecting: 1, ready: 2, failed: 2 } as const

export function acceptRemoteWorkspaceLifecycleProjection(
  set: WorkspacesSet,
  get: WorkspacesGet,
  entry: Pick<WorkspaceRuntimeEntry, 'workspaceId' | 'workspaceRuntimeId' | 'remoteLifecycle'>,
  options: { name?: string } = {},
): boolean {
  const lifecycle = entry.remoteLifecycle
  if (!lifecycle || !isRemoteWorkspaceId(entry.workspaceId)) return false
  const current = get().workspaces[entry.workspaceId]
  if (!current || current.workspaceRuntimeId !== entry.workspaceRuntimeId) return false
  if (current.admission.kind !== 'remote') return false
  if (
    !remoteWorkspaceLifecycleProjectionIsFresh(
      current.admission.lifecycleAttemptId,
      current.admission.lifecycle?.kind,
      lifecycle,
    )
  ) {
    return false
  }

  let accepted = false
  updateIfFresh(set, entry.workspaceId, entry.workspaceRuntimeId, (repo) => {
    if (repo.admission.kind !== 'remote') return
    if (
      !remoteWorkspaceLifecycleProjectionIsFresh(
        repo.admission.lifecycleAttemptId,
        repo.admission.lifecycle?.kind,
        lifecycle,
      )
    )
      return
    applyRemoteWorkspaceLifecycle(repo, lifecycle, options.name)
    accepted = true
  })
  return accepted
}

/** Accept the transport lifecycle and capability probe as one server-runtime projection. */
export function acceptRemoteWorkspaceRuntimeProjection(
  set: WorkspacesSet,
  get: WorkspacesGet,
  entry: Pick<
    WorkspaceRuntimeEntry,
    'workspaceId' | 'workspaceRuntimeId' | 'remoteLifecycle' | 'workspaceProbe'
  >,
  options: { name?: string } = {},
): boolean {
  const lifecycle = entry.remoteLifecycle
  if (!lifecycle || !isRemoteWorkspaceId(entry.workspaceId)) return false
  const current = get().workspaces[entry.workspaceId]
  if (!current || current.workspaceRuntimeId !== entry.workspaceRuntimeId) return false
  if (!remoteWorkspaceRuntimeProjectionIsFresh(current, lifecycle)) return false

  let accepted = false
  updateIfFresh(set, entry.workspaceId, entry.workspaceRuntimeId, (workspace) => {
    if (!remoteWorkspaceRuntimeProjectionIsFresh(workspace, lifecycle)) return
    applyRemoteWorkspaceLifecycle(workspace, lifecycle, options.name)
    acceptWorkspaceProbeState(workspace, entry.workspaceProbe)
    accepted = true
  })
  return accepted
}

export function acceptRemoteWorkspaceLifecycleSnapshot(
  set: WorkspacesSet,
  get: WorkspacesGet,
  snapshot: WorkspaceRuntimesSnapshot,
): void {
  for (const entry of snapshot.runtimes) acceptRemoteWorkspaceLifecycleProjection(set, get, entry)
}

function remoteWorkspaceLifecycleProjectionIsFresh(
  acceptedAttemptId: number | null,
  acceptedKind: 'connecting' | 'ready' | 'failed' | undefined,
  incoming: RemoteWorkspaceRuntimeLifecycle,
): boolean {
  if (acceptedAttemptId === null || incoming.attemptId > acceptedAttemptId) return true
  if (incoming.attemptId < acceptedAttemptId) return false
  const acceptedPhase = acceptedKind ? LIFECYCLE_PHASE_ORDER[acceptedKind] : LIFECYCLE_PHASE_ORDER.idle
  return LIFECYCLE_PHASE_ORDER[incoming.kind] >= acceptedPhase
}

function remoteWorkspaceRuntimeProjectionIsFresh(
  workspace: WorkspaceState,
  lifecycle: RemoteWorkspaceRuntimeLifecycle,
): boolean {
  return (
    workspace.admission.kind === 'remote' &&
    remoteWorkspaceLifecycleProjectionIsFresh(
      workspace.admission.lifecycleAttemptId,
      workspace.admission.lifecycle?.kind,
      lifecycle,
    )
  )
}

function applyRemoteWorkspaceLifecycle(
  workspace: WorkspaceState,
  lifecycle: RemoteWorkspaceRuntimeLifecycle,
  name?: string,
): void {
  if (workspace.admission.kind !== 'remote') return
  workspace.admission.lifecycleAttemptId = lifecycle.attemptId
  if (lifecycle.kind === 'idle') workspace.admission.lifecycle = null
  else if (lifecycle.kind === 'connecting') markRemoteLifecycleConnecting(workspace)
  else if (lifecycle.kind === 'ready') markRemoteLifecycleReady(workspace, lifecycle.target)
  else markRemoteLifecycleFailed(workspace, lifecycle.reason, lifecycle.target)
  if (lifecycle.kind === 'ready' && name) workspace.name = name
}
