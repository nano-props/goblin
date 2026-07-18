import {
  isRemoteRepoId,
  type RemoteRepoFailureReason,
  type RemoteRepoLifecycleCommandResult,
  type RemoteRepoTarget,
} from '#/shared/remote-repo.ts'
import { resolveRemoteRepoConnection } from '#/web/remote-client.ts'
import { acceptRemoteLifecycleSnapshot } from '#/web/stores/repos/remote-lifecycle-projection.ts'
import { acceptWorkspaceProbeSnapshot } from '#/web/stores/repos/workspace-probe-projection.ts'
import { refreshRepoRuntimes } from '#/web/repo-runtime-query.ts'
import { requestRepoProjectionReadModelRefresh } from '#/web/stores/repos/refresh.ts'
import type { ReposGet, ReposSet } from '#/web/stores/repos/types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export type RemoteWorkspaceConnectionOutcome =
  | { kind: 'ready'; workspaceId: WorkspaceId; name: string; target: RemoteRepoTarget }
  | { kind: 'failed'; workspaceId: WorkspaceId; name: string; reason: RemoteRepoFailureReason; target?: RemoteRepoTarget }
  | { kind: 'superseded'; workspaceId: WorkspaceId }
  | { kind: 'stale-runtime'; workspaceId: WorkspaceId }
  | { kind: 'cancelled'; workspaceId: WorkspaceId }
  | { kind: 'transport-failed'; workspaceId: WorkspaceId; reason: 'unknown' }

function commandOutcome(
  result: RemoteRepoLifecycleCommandResult,
  workspaceId: WorkspaceId,
): RemoteWorkspaceConnectionOutcome {
  if (result.repoId !== workspaceId) return { kind: 'stale-runtime', workspaceId }
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
  set: ReposSet,
  get: ReposGet,
  workspaceId: WorkspaceId,
  options: { repoRuntimeId?: string; signal?: AbortSignal; mode?: 'restart' | 'ensure' } = {},
): Promise<RemoteWorkspaceConnectionOutcome | null> {
  if (!isRemoteRepoId(workspaceId)) return null
  const repoRuntimeId = options.repoRuntimeId ?? get().repos[workspaceId]?.repoRuntimeId
  if (!repoRuntimeId) return null

  let result: RemoteRepoLifecycleCommandResult
  try {
    result = await resolveRemoteRepoConnection({ repoId: workspaceId, repoRuntimeId, mode: options.mode }, options.signal)
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) return { kind: 'cancelled', workspaceId }
    return { kind: 'transport-failed', workspaceId, reason: 'unknown' }
  }
  if (result.repoId !== workspaceId) return { kind: 'stale-runtime', workspaceId }
  if (result.kind === 'settled') {
    const snapshot = await refreshRepoRuntimes()
    acceptRemoteLifecycleSnapshot(set, get, snapshot)
    acceptWorkspaceProbeSnapshot(set, get, snapshot)
    const runtime = snapshot.runtimes.find(
      (entry) => entry.repoRoot === workspaceId && entry.repoRuntimeId === repoRuntimeId,
    )
    if (!runtime || get().repos[workspaceId]?.repoRuntimeId !== repoRuntimeId) {
      return { kind: 'stale-runtime', workspaceId }
    }
    if (
      result.lifecycle.kind === 'ready' &&
      runtime.workspaceProbe.status === 'ready' &&
      runtime.workspaceProbe.capabilities.git.status === 'available'
    ) {
      void requestRepoProjectionReadModelRefresh({ get, set }, workspaceId, { repoRuntimeId })
    }
  }
  return commandOutcome(result, workspaceId)
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}
