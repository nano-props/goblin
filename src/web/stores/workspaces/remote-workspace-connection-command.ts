import {
  isRemoteWorkspaceId,
  type RemoteWorkspaceFailureReason,
  type RemoteWorkspaceLifecycleCommandResult,
  type RemoteWorkspaceTarget,
} from '#/shared/remote-workspace.ts'
import { resolveRemoteWorkspaceConnection } from '#/web/remote-workspace-client.ts'
import { acceptRemoteWorkspaceLifecycleSnapshot } from '#/web/stores/workspaces/remote-workspace-lifecycle-projection.ts'
import { acceptWorkspaceProbeSnapshot } from '#/web/stores/workspaces/workspace-probe-projection.ts'
import { invalidateWorkspaceRuntimes } from '#/web/workspace-runtime-query.ts'
import { requestRepoProjectionReadModelRefresh } from '#/web/stores/workspaces/refresh.ts'
import type { WorkspacesGet, WorkspacesSet } from '#/web/stores/workspaces/types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export type RemoteWorkspaceConnectionOutcome =
  | { kind: 'ready'; workspaceId: WorkspaceId; name: string; target: RemoteWorkspaceTarget }
  | {
      kind: 'failed'
      workspaceId: WorkspaceId
      name: string
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
    return { kind: 'ready', workspaceId, name: result.name, target: lifecycle.target }
  }
  if (lifecycle.kind === 'failed') {
    return {
      kind: 'failed',
      workspaceId,
      name: result.name,
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
 * only applies the command's canonical terminal projection and refreshes the
 * shared read model. Realtime invalidation gives every other window the same
 * projection.
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
    let snapshot
    try {
      snapshot = await invalidateWorkspaceRuntimes()
    } catch {
      return { kind: 'transport-failed', workspaceId, reason: 'unknown' }
    }
    acceptRemoteWorkspaceLifecycleSnapshot(set, get, snapshot)
    acceptWorkspaceProbeSnapshot(set, get, snapshot)
    const runtime = snapshot.runtimes.find(
      (entry) => entry.workspaceId === workspaceId && entry.workspaceRuntimeId === workspaceRuntimeId,
    )
    if (!runtime || get().workspaces[workspaceId]?.workspaceRuntimeId !== workspaceRuntimeId) {
      return { kind: 'stale-runtime', workspaceId }
    }
    if (
      !runtime.remoteLifecycle ||
      runtime.remoteLifecycle.attemptId !== result.lifecycle.attemptId ||
      runtime.remoteLifecycle.kind !== result.lifecycle.kind
    ) {
      return { kind: 'superseded', workspaceId }
    }
    if (
      result.lifecycle.kind === 'ready' &&
      runtime.workspaceProbe.status === 'ready' &&
      runtime.workspaceProbe.capabilities.git.status === 'available'
    ) {
      void requestRepoProjectionReadModelRefresh({ get, set }, workspaceId, { workspaceRuntimeId })
    }
  }
  return commandOutcome(result, workspaceId)
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}
