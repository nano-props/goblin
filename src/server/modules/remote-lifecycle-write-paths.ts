import { publishUserRepoQueryInvalidation } from '#/server/modules/invalidation-broker.ts'
import { resolveServerRemoteRepoConnection } from '#/server/modules/remote.ts'
import { runRepoRemoteLifecycle } from '#/server/modules/repo-runtimes.ts'
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
  const result = await runRepoRemoteLifecycle(
    userId,
    repoId,
    repoRuntimeId,
    (signal) => resolveServerRemoteRepoConnection({ repoId }, signal),
    () => publishUserRepoQueryInvalidation(userId, { repoId, query: 'remote-lifecycle' }),
    mode,
  )
  if (result.kind !== 'settled') return { kind: result.kind, repoId }
  return { kind: 'settled', repoId, name: result.name, lifecycle: result.lifecycle }
}
