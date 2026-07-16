import { publishUserRepoQueryInvalidation } from '#/server/modules/invalidation-broker.ts'
import { resolveServerRemoteRepoConnection } from '#/server/modules/remote.ts'
import { commitWorkspaceProbeState, runRepoRemoteLifecycle } from '#/server/modules/repo-runtimes.ts'
import type { RemoteRepoLifecycleCommandResult } from '#/shared/remote-repo.ts'

export interface RunRemoteLifecycleInput {
  userId: string
  repoId: string
  repoRuntimeId: string
  mode: 'restart' | 'ensure'
}

export async function runRemoteLifecycleWrite(
  input: RunRemoteLifecycleInput,
): Promise<RemoteRepoLifecycleCommandResult> {
  const { userId, repoId, repoRuntimeId, mode } = input
  const observed: { gitCapability: { available: boolean; diagnostic?: string } | null } = { gitCapability: null }
  const result = await runRepoRemoteLifecycle(
    userId,
    repoId,
    repoRuntimeId,
    async (signal) => {
      const resolved = await resolveServerRemoteRepoConnection({ repoId }, signal)
      if (resolved.kind === 'ready') {
        observed.gitCapability = {
          available: resolved.gitAvailable,
          ...(resolved.gitDiagnostic ? { diagnostic: resolved.gitDiagnostic } : {}),
        }
      }
      return resolved
    },
    () => publishUserRepoQueryInvalidation(userId, { repoId, query: 'remote-lifecycle' }),
    mode,
  )
  if (result.kind !== 'settled') return { kind: result.kind, repoId }
  const gitCapability = observed.gitCapability
  if (result.lifecycle.kind === 'ready' && gitCapability) {
    commitWorkspaceProbeState({
      userId,
      repoRoot: repoId,
      repoRuntimeId,
      probe: {
        status: 'ready',
        name: result.name,
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: gitCapability.available
            ? { status: 'available', worktrees: true, pullRequests: { provider: 'none' } }
            : { status: 'unavailable' },
        },
        diagnostics: gitCapability.diagnostic ? [{ scope: 'git', message: gitCapability.diagnostic }] : [],
      },
    })
  }
  return { kind: 'settled', repoId, name: result.name, lifecycle: result.lifecycle }
}
