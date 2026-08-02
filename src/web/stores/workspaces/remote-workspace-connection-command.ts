import {
  isRemoteWorkspaceId,
  type RemoteWorkspaceFailureReason,
  type RemoteWorkspaceLifecycleCommandResult,
  type RemoteWorkspaceTarget,
} from '#/shared/remote-workspace.ts'
import { resolveRemoteWorkspaceConnection } from '#/web/remote-workspace-client.ts'
import { acceptRemoteWorkspaceRuntimeProjection } from '#/web/stores/workspaces/remote-workspace-lifecycle-projection.ts'
import { requestRepoSnapshotRefresh } from '#/web/stores/workspaces/refresh.ts'
import type { WorkspacesGet, WorkspacesSet } from '#/web/stores/workspaces/types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export type RemoteWorkspaceConnectionOutcome =
  | { kind: 'ready'; workspaceId: WorkspaceId; target: RemoteWorkspaceTarget }
  | {
      kind: 'failed'
      workspaceId: WorkspaceId
      reason: RemoteWorkspaceFailureReason
      target?: RemoteWorkspaceTarget
    }
  | { kind: 'superseded'; workspaceId: WorkspaceId }
  | { kind: 'stale-runtime'; workspaceId: WorkspaceId }
  | { kind: 'cancelled'; workspaceId: WorkspaceId }
  | { kind: 'transport-failed'; workspaceId: WorkspaceId; reason: 'unknown' }

function commandOutcome(
  result: RemoteWorkspaceLifecycleCommandResult,
  workspaceId: WorkspaceId,
): RemoteWorkspaceConnectionOutcome {
  if (result.workspaceId !== workspaceId) return { kind: 'stale-runtime', workspaceId }
  if (result.kind !== 'settled') return { kind: result.kind, workspaceId }
  const lifecycle = result.lifecycle
  if (lifecycle.kind === 'ready') {
    return { kind: 'ready', workspaceId, target: lifecycle.target }
  }
  if (lifecycle.kind === 'failed') {
    return {
      kind: 'failed',
      workspaceId,
      reason: lifecycle.reason,
      target: lifecycle.target,
    }
  }
  const exhaustiveLifecycle: never = lifecycle
  return exhaustiveLifecycle
}

/**
 * Submit a remote lifecycle command to the server-owned workspace runtime.
 * The client does not schedule attempts or manufacture lifecycle state; it
 * only applies the command's exact canonical terminal projection. Realtime
 * invalidation gives other windows a best-effort lifecycle projection.
 */
export async function runRemoteWorkspaceConnection(
  set: WorkspacesSet,
  get: WorkspacesGet,
  workspaceId: WorkspaceId,
  options: { workspaceRuntimeId?: string; signal?: AbortSignal; mode?: 'restart' | 'ensure' } = {},
): Promise<RemoteWorkspaceConnectionOutcome | null> {
  if (!isRemoteWorkspaceId(workspaceId)) return null
  const workspaceRuntimeId = options.workspaceRuntimeId ?? get().workspaces[workspaceId]?.workspaceRuntimeId
  if (!workspaceRuntimeId) return null

  let result: RemoteWorkspaceLifecycleCommandResult
  try {
    result = await resolveRemoteWorkspaceConnection(
      { workspaceId, workspaceRuntimeId, mode: options.mode },
      options.signal,
    )
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) return { kind: 'cancelled', workspaceId }
    return { kind: 'transport-failed', workspaceId, reason: 'unknown' }
  }
  if (result.workspaceId !== workspaceId) return { kind: 'stale-runtime', workspaceId }
  if (result.kind === 'settled') {
    const accepted = acceptRemoteWorkspaceRuntimeProjection(set, get, {
      workspaceId,
      workspaceRuntimeId,
      remoteLifecycle: result.lifecycle,
      workspaceProbe: result.workspaceProbe,
    })
    if (!accepted) {
      if (get().workspaces[workspaceId]?.workspaceRuntimeId !== workspaceRuntimeId) {
        return { kind: 'stale-runtime', workspaceId }
      }
      return { kind: 'superseded', workspaceId }
    }
    if (
      result.lifecycle.kind === 'ready' &&
      result.workspaceProbe.status === 'ready' &&
      result.workspaceProbe.capabilities.git.status === 'available'
    ) {
      void requestRepoSnapshotRefresh({ get, set }, workspaceId, { workspaceRuntimeId })
    }
  }
  return commandOutcome(result, workspaceId)
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}
