import { isRemoteRepoId, type RemoteRepoFailureReason, type RemoteRepoLifecycleCommandResult, type RemoteRepoTarget } from '#/shared/remote-repo.ts'
import { resolveRemoteRepoConnection } from '#/web/remote-client.ts'
import { acceptRemoteLifecycleProjection } from '#/web/stores/repos/remote-lifecycle-projection.ts'
import { requestRepoProjectionReadModelRefresh } from '#/web/stores/repos/refresh.ts'
import type { ReposGet, ReposSet } from '#/web/stores/repos/types.ts'

interface RemoteRepoConnectionOutcome {
  kind: 'ready' | 'failed' | 'superseded' | 'stale-runtime'
  reason?: RemoteRepoFailureReason
  repoId: string
  name: string
  target?: RemoteRepoTarget
}

function commandOutcome(result: RemoteRepoLifecycleCommandResult): RemoteRepoConnectionOutcome {
  if (result.kind !== 'settled') return { kind: result.kind, repoId: result.repoId, name: result.repoId }
  const lifecycle = result.lifecycle
  if (lifecycle.kind === 'ready') {
    return { kind: 'ready', repoId: result.repoId, name: result.name, target: lifecycle.target }
  }
  if (lifecycle.kind === 'failed') {
    return {
      kind: 'failed',
      repoId: result.repoId,
      name: result.name,
      reason: lifecycle.reason,
      target: lifecycle.target,
    }
  }
  // The command settles server-side before responding. Keep this branch
  // defensive for a malformed/forward-compatible response.
  return { kind: 'failed', repoId: result.repoId, name: result.name, reason: 'unknown' }
}

/**
 * Submit a remote lifecycle command to the server-owned repo runtime.
 * The client does not schedule attempts or manufacture lifecycle state; it
 * only applies the command's canonical terminal projection and refreshes the
 * shared read model. Realtime invalidation gives every other window the same
 * projection.
 */
export async function runRemoteRepoConnection(
  set: ReposSet,
  get: ReposGet,
  repoId: string,
  options: { repoRuntimeId?: string; signal?: AbortSignal } = {},
): Promise<RemoteRepoConnectionOutcome | null> {
  if (!isRemoteRepoId(repoId)) return null
  const repoRuntimeId = options.repoRuntimeId ?? get().repos[repoId]?.repoRuntimeId
  if (!repoRuntimeId) return null

  const result = await resolveRemoteRepoConnection({ repoId, repoRuntimeId }, options.signal)
  const outcome = commandOutcome(result)
  if (result.kind === 'settled') {
    const accepted = acceptRemoteLifecycleProjection(
      set,
      get,
      { repoRoot: repoId, repoRuntimeId, remoteLifecycle: result.lifecycle },
      { name: result.name },
    )
    if (accepted && result.lifecycle.kind === 'ready') {
      void requestRepoProjectionReadModelRefresh({ get, set }, repoId, { repoRuntimeId })
    }
  }
  return outcome
}
