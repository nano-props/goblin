import { userInfo } from 'node:os'
import * as pty from 'node-pty'

export interface TerminalPtyRuntime {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(listener: (data: string) => void): { dispose(): void }
  onExit(listener: () => void): { dispose(): void }
  processName(): string
}

export interface SpawnTerminalPtyRuntimeInput {
  command?: string
  args?: string[]
  cwd: string
  cols: number
  rows: number
}

export type SpawnTerminalPtyRuntimeResult = { ok: true; runtime: TerminalPtyRuntime } | { ok: false; message: string }

export interface ResolvedLocalShell {
  command: string
  args: string[]
}

/**
 * Pick the right login shell for a local (non-SSH) terminal.
 *
 * Resolution order on Unix:
 *  1. Caller-supplied `input.command` wins (explicit override).
 *  2. `process.env.SHELL` — the user-facing Electron desktop launches inherit
 *     this from launchd / the user's login session, so it's correct on macOS
 *     and Linux desktops.
 *  3. `os.userInfo().shell` — Node reads `getpwuid_r(getuid())->pw_shell` for
 *     us. This catches CI, devcontainer, and other containerised contexts
 *     where the inherited `SHELL` points at the container base shell (often
 *     `/bin/sh`) rather than the user's actual login shell.
 *  4. `/bin/sh` — last-resort POSIX guarantee; `-l` keeps the shell in login
 *     mode so it sources the user's profile.
 *
 * On Windows there is no login-shell concept; fall back to `COMSPEC` (which
 * the Windows kernel always sets) or `cmd.exe`. No login-mode flag — cmd.exe
 * does not have an equivalent.
 */
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

function readUserLoginShell(): string | null {
  try {
    const shell = userInfo().shell
    const trimmed = typeof shell === 'string' ? shell.trim() : ''
    return trimmed || null
  } catch {
    return null
  }
}

export function spawnTerminalPtyRuntime(input: SpawnTerminalPtyRuntimeInput): SpawnTerminalPtyRuntimeResult {
  try {
    const shell = resolveLocalShell(input)
    const env = { ...process.env, TERM: 'xterm-256color' }
    const term = pty.spawn(shell.command, shell.args, {
      name: 'xterm-256color',
      cols: input.cols,
      rows: input.rows,
      cwd: input.cwd,
      env,
    })
    return { ok: true, runtime: new NodePtyTerminalRuntime(term) }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'error.unknown' }
  }
}

class NodePtyTerminalRuntime implements TerminalPtyRuntime {
  private readonly term: pty.IPty

  constructor(term: pty.IPty) {
    this.term = term
  }

  write(data: string): void {
    this.term.write(data)
  }

  resize(cols: number, rows: number): void {
    this.term.resize(cols, rows)
  }

  kill(): void {
    this.term.kill()
  }

  onData(listener: (data: string) => void): { dispose(): void } {
    return this.term.onData(listener)
  }

  onExit(listener: () => void): { dispose(): void } {
    return this.term.onExit(listener)
  }

  processName(): string {
    return readTerminalProcessName(this.term)
  }
}

function readTerminalProcessName(term: pty.IPty): string {
  try {
    const processName = term.process
    if (typeof processName !== 'string') return 'terminal'
    return processName.trim() || 'terminal'
  } catch {
    return 'terminal'
  }
}
