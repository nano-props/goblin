import {
  isRemoteWorkspaceId,
  type RemoteWorkspaceFailureReason,
  type RemoteWorkspaceLifecycleCommandResult,
  type RemoteWorkspaceTarget,
} from '#/shared/remote-workspace.ts'
import { resolveRemoteWorkspaceConnection } from '#/web/workspaces/remote-client.ts'
import { acceptRemoteWorkspaceRuntimeProjection } from '#/web/stores/workspaces/remote-workspace-lifecycle-projection.ts'
import { requestRepoSnapshotRefresh } from '#/web/stores/workspaces/refresh.ts'
import type { WorkspacesGet, WorkspacesSet } from '#/web/stores/workspaces/types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { hasErrorCode } from '#/shared/error-code.ts'

export type RemoteWorkspaceConnectionOutcome =
  | { kind: 'ready'; target: RemoteWorkspaceTarget }
  | { kind: 'failed'; reason: RemoteWorkspaceFailureReason }
  | { kind: 'superseded' }
  | { kind: 'stale-runtime' }
  | { kind: 'cancelled' }
  | { kind: 'outcome-uncertain' }
  | { kind: 'transport-failed'; reason: 'unknown' }

type RemoteWorkspaceConnectionTransportOutcome = Extract<
  RemoteWorkspaceConnectionOutcome,
  { kind: 'outcome-uncertain' | 'cancelled' | 'transport-failed' }
>

function commandOutcome(result: RemoteWorkspaceLifecycleCommandResult): RemoteWorkspaceConnectionOutcome {
  if (result.kind !== 'settled') return { kind: result.kind }
  const lifecycle = result.lifecycle
  if (lifecycle.kind === 'ready') {
    return { kind: 'ready', target: lifecycle.target }
  }
  if (lifecycle.kind === 'failed') {
    return { kind: 'failed', reason: lifecycle.reason }
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

  const result = await resolveRemoteWorkspaceConnection(
    { workspaceId, workspaceRuntimeId, mode: options.mode },
    options.signal,
  ).catch((error: unknown): RemoteWorkspaceLifecycleCommandResult | RemoteWorkspaceConnectionTransportOutcome => {
    if (hasErrorCode(error, 'OUTCOME_UNCERTAIN')) return { kind: 'outcome-uncertain' }
    if (options.signal?.aborted || isAbortError(error)) return { kind: 'cancelled' }
    return { kind: 'transport-failed', reason: 'unknown' }
  })
  if (result.kind === 'outcome-uncertain' || result.kind === 'cancelled' || result.kind === 'transport-failed') {
    return result
  }
  if (result.workspaceId !== workspaceId) return { kind: 'stale-runtime' }
  if (result.kind === 'settled') {
    const accepted = acceptRemoteWorkspaceRuntimeProjection(set, get, {
      workspaceId,
      workspaceRuntimeId,
      remoteLifecycle: result.lifecycle,
      workspaceProbe: result.workspaceProbe,
    })
    if (!accepted) {
      if (get().workspaces[workspaceId]?.workspaceRuntimeId !== workspaceRuntimeId) {
        return { kind: 'stale-runtime' }
      }
      return { kind: 'superseded' }
    }
    if (
      result.lifecycle.kind === 'ready' &&
      result.workspaceProbe.status === 'ready' &&
      result.workspaceProbe.capabilities.git.status === 'available'
    ) {
      void requestRepoSnapshotRefresh({ get, set }, workspaceId, { workspaceRuntimeId })
    }
  }
  return commandOutcome(result)
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}
