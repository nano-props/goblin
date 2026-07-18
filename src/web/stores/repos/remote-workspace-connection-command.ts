import {
  isRemoteRepoId,
  type RemoteRepoFailureReason,
  type RemoteRepoLifecycleCommandResult,
  type RemoteRepoTarget,
} from '#/shared/remote-repo.ts'
import { resolveRemoteRepoConnection } from '#/web/remote-client.ts'
import { acceptRemoteLifecycleSnapshot } from '#/web/stores/repos/remote-lifecycle-projection.ts'
import { acceptWorkspaceProbeSnapshot } from '#/web/stores/repos/workspace-probe-projection.ts'
import { refreshWorkspaceRuntimes } from '#/web/workspace-runtime-query.ts'
import { requestRepoProjectionReadModelRefresh } from '#/web/stores/repos/refresh.ts'
import type { ReposGet, ReposSet } from '#/web/stores/repos/types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

export type RemoteWorkspaceConnectionOutcome =
  | { kind: 'ready'; repoRoot: WorkspaceId; name: string; target: RemoteRepoTarget }
  | { kind: 'failed'; repoRoot: WorkspaceId; name: string; reason: RemoteRepoFailureReason; target?: RemoteRepoTarget }
  | { kind: 'superseded'; repoRoot: WorkspaceId }
  | { kind: 'stale-runtime'; repoRoot: WorkspaceId }
  | { kind: 'cancelled'; repoRoot: WorkspaceId }
  | { kind: 'transport-failed'; repoRoot: WorkspaceId; reason: 'unknown' }

function commandOutcome(
  result: RemoteRepoLifecycleCommandResult,
  repoRoot: WorkspaceId,
): RemoteWorkspaceConnectionOutcome {
  if (result.repoId !== repoRoot) return { kind: 'stale-runtime', repoRoot }
  if (result.kind !== 'settled') return { kind: result.kind, repoRoot }
  const lifecycle = result.lifecycle
  if (lifecycle.kind === 'ready') {
    return { kind: 'ready', repoRoot, name: result.name, target: lifecycle.target }
  }
  if (lifecycle.kind === 'failed') {
    return {
      kind: 'failed',
      repoRoot,
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
  repoRoot: WorkspaceId,
  options: { workspaceRuntimeId?: string; signal?: AbortSignal; mode?: 'restart' | 'ensure' } = {},
): Promise<RemoteWorkspaceConnectionOutcome | null> {
  if (!isRemoteRepoId(repoRoot)) return null
  const workspaceRuntimeId = options.workspaceRuntimeId ?? get().repos[repoRoot]?.workspaceRuntimeId
  if (!workspaceRuntimeId) return null

  let result: RemoteRepoLifecycleCommandResult
  try {
    result = await resolveRemoteRepoConnection({ repoId: repoRoot, workspaceRuntimeId, mode: options.mode }, options.signal)
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) return { kind: 'cancelled', repoRoot }
    return { kind: 'transport-failed', repoRoot, reason: 'unknown' }
  }
  if (result.repoId !== repoRoot) return { kind: 'stale-runtime', repoRoot }
  if (result.kind === 'settled') {
    const snapshot = await refreshWorkspaceRuntimes()
    acceptRemoteLifecycleSnapshot(set, get, snapshot)
    acceptWorkspaceProbeSnapshot(set, get, snapshot)
    const runtime = snapshot.runtimes.find(
      (entry) => entry.workspaceId === repoRoot && entry.workspaceRuntimeId === workspaceRuntimeId,
    )
    if (!runtime || get().repos[repoRoot]?.workspaceRuntimeId !== workspaceRuntimeId) {
      return { kind: 'stale-runtime', repoRoot }
    }
    if (
      result.lifecycle.kind === 'ready' &&
      runtime.workspaceProbe.status === 'ready' &&
      runtime.workspaceProbe.capabilities.git.status === 'available'
    ) {
      void requestRepoProjectionReadModelRefresh({ get, set }, repoRoot, { workspaceRuntimeId })
    }
  }
  return commandOutcome(result, repoRoot)
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}
