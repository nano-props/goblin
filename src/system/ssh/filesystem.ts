import type { ExecResult } from '#/shared/git-types.ts'
import type { RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import { runRemoteCommand, type RemoteCommandRunner } from '#/system/ssh/commands.ts'

/** Read children below an already-authorized remote filesystem root. */
export async function getRemoteDirectoryWalk(
  target: RemoteWorkspaceTarget,
  rootPath: string,
  options: { signal?: AbortSignal; prefix?: string; run?: RemoteCommandRunner } = {},
): Promise<ExecResult> {
  return await runRemoteDirectoryWalk('directoryChildren', target, rootPath, options)
}

export async function getRemoteGitDirectoryWalk(
  target: RemoteWorkspaceTarget,
  rootPath: string,
  options: { signal?: AbortSignal; prefix?: string; run?: RemoteCommandRunner } = {},
): Promise<ExecResult> {
  return await runRemoteDirectoryWalk('gitDirectoryChildren', target, rootPath, options)
}

async function runRemoteDirectoryWalk(
  type: 'directoryChildren' | 'gitDirectoryChildren',
  target: RemoteWorkspaceTarget,
  rootPath: string,
  options: { signal?: AbortSignal; prefix?: string; run?: RemoteCommandRunner },
): Promise<ExecResult> {
  const run: RemoteCommandRunner =
    options.run ?? ((command, remoteTarget, runOptions) => runRemoteCommand(remoteTarget, command, runOptions))
  const result = await run({ type, path: rootPath, prefix: options.prefix }, target, {
    signal: options.signal,
  })
  if (options.signal?.aborted) return { ok: false, message: 'cancelled' }
  if (!result.ok) return { ok: false, message: result.message || result.stderr || 'error.unknown' }
  return { ok: true, message: result.stdout }
}
