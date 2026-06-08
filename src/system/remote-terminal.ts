export interface RemoteTerminalInvocation {
  command: 'ssh'
  args: string[]
  shellCommand: string
}

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

function isSafeRemoteAlias(alias: string): boolean {
  return alias.length > 0 && alias.length <= 255 && !/[\s\0/?#\\]/.test(alias)
}

function isSafeRemoteAbsolutePath(remotePath: string): boolean {
  return (
    remotePath.length > 0 &&
    remotePath.length <= 4096 &&
    remotePath.startsWith('/') &&
    !/[\0-\x1f\x7f]/.test(remotePath)
  )
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
