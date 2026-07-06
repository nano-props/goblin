import { execa } from 'execa'

const USER_SHELL_COMMAND_TIMEOUT_MS = 5_000
const COMMAND_NAME_RE = /^[A-Za-z0-9._+-]+$/

export async function userShellCommandExists(commandName: string, cwd: string, signal?: AbortSignal): Promise<boolean> {
  if (!COMMAND_NAME_RE.test(commandName)) return false
  if (signal?.aborted) return false

  try {
    const invocation = userShellCommandExistsInvocation(commandName)
    const result = await execa(invocation.command, invocation.args, {
      cwd,
      reject: false,
      timeout: USER_SHELL_COMMAND_TIMEOUT_MS,
      cancelSignal: signal,
      forceKillAfterDelay: 500,
    })
    return result.exitCode === 0
  } catch {
    return false
  }
}

function userShellCommandExistsInvocation(commandName: string): { command: string; args: string[] } {
  if (process.platform === 'win32') return { command: 'where.exe', args: [commandName] }

  const shell = process.env.SHELL?.trim()
  const script = `command -v ${shellQuote(commandName)} >/dev/null 2>&1`
  // Match goblin.toml setup execution: an interactive login shell loads
  // the user's normal terminal environment before resolving commands.
  if (shell) return { command: shell, args: ['-il', '-c', script] }
  return { command: '/bin/sh', args: ['-c', script] }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
