import type { RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import { runRemoteCommand } from '#/system/ssh/commands.ts'
import type { RemoteCommandRunner } from '#/system/ssh/commands.ts'

const REMOTE_COMMAND_NAME_RE = /^[A-Za-z0-9._+-]+$/

export function isRemoteCommandName(commandName: string): boolean {
  return REMOTE_COMMAND_NAME_RE.test(commandName)
}

/** Probe a command at a path already authorized by the workspace boundary. */
export async function remoteCommandExistsAtPath(
  target: RemoteWorkspaceTarget,
  remotePath: string,
  commandName: string,
  options: { signal?: AbortSignal; run?: RemoteCommandRunner } = {},
): Promise<boolean> {
  if (!isRemoteCommandName(commandName) || !remotePath.startsWith('/')) return false
  const run: RemoteCommandRunner =
    options.run ?? ((command, remoteTarget, runOptions) => runRemoteCommand(remoteTarget, command, runOptions))
  const result = await run({ type: 'commandExists', path: remotePath, commandName }, target, {
    signal: options.signal,
  })
  return !options.signal?.aborted && result.ok
}
