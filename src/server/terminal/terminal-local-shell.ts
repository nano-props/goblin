import { userInfo } from 'node:os'

export interface ResolvedLocalShell {
  command: string
  args: string[]
}

/** Resolves an explicit command, the user login shell, or the platform fallback. */
export function resolveLocalShell(
  input: { command?: string; args?: string[] },
  env: NodeJS.ProcessEnv = process.env,
): ResolvedLocalShell {
  const explicit = input.command?.trim()
  if (explicit) return { command: explicit, args: input.args ?? [] }
  if (process.platform === 'win32') {
    return { command: env.COMSPEC?.trim() || 'cmd.exe', args: [] }
  }
  const fromEnv = env.SHELL?.trim()
  if (fromEnv) return { command: fromEnv, args: input.args ?? ['-l'] }
  const fromUserInfo = readUserLoginShell()
  if (fromUserInfo) return { command: fromUserInfo, args: input.args ?? ['-l'] }
  return { command: '/bin/sh', args: input.args ?? ['-l'] }
}

export function resolveLocalShellWithStartupShellCommand(
  startupShellCommand: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedLocalShell {
  const commandLine = normalizeStartupShellCommand(startupShellCommand)
  if (!commandLine) return resolveLocalShell({}, env)
  if (process.platform === 'win32') return { command: env.COMSPEC?.trim() || 'cmd.exe', args: ['/K', commandLine] }
  const shell = resolveLocalShell({}, env).command
  // The PTY is spawned only after the mounted client xterm has fitted its host,
  // so width-sensitive startup output begins at canonical geometry.
  return { command: shell, args: ['-ilc', `${commandLine}\nexec ${quotePosixShellArg(shell)} -l`] }
}

function normalizeStartupShellCommand(command: string | undefined): string {
  const withoutTrailingNewline = (command ?? '').replace(/[\r\n]+$/u, '')
  return withoutTrailingNewline.trim().length === 0 ? '' : withoutTrailingNewline
}

function quotePosixShellArg(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`
}

function readUserLoginShell(): string | null {
  try {
    const shell = userInfo().shell
    const trimmed = typeof shell === 'string' ? shell.trim() : ''
    return trimmed || null
  } catch {
    return null
  }
}
