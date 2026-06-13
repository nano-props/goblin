import { isSafeRemoteAbsolutePath, isSafeRemoteAlias, shellQuote } from '#/system/remote-shell.ts'

export interface RemoteTerminalInvocation {
  command: 'ssh'
  args: string[]
  /** Fully shell-quoted command line, suitable for `osascript do script` or
   *  AppleScript windows. Don't parse — display only. */
  shellCommand: string
}

/** Build an `ssh -tt -- <alias> "sh -lc 'cd <path> && exec $SHELL -l'"`
 *  invocation. `cd` runs on the remote and only after the SSH session
 *  attaches a TTY, so the user's shell lands in the worktree directory. */
export function buildRemoteTerminalInvocation(alias: string, remotePath: string): RemoteTerminalInvocation | null {
  if (!isSafeRemoteAlias(alias) || !isSafeRemoteAbsolutePath(remotePath)) return null

  const script = `cd ${shellQuote(remotePath)} && exec "\${SHELL:-/bin/sh}" -l`
  const remoteCommand = `sh -lc ${shellQuote(script)}`
  const args = ['-tt', '--', alias, remoteCommand]
  return {
    command: 'ssh',
    args,
    shellCommand: ['ssh', ...args].map(shellQuote).join(' '),
  }
}
