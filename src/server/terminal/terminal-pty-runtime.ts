import * as pty from 'node-pty'
import { ensureNodePtyDarwinSpawnHelperExecutable } from '#/server/terminal/node-pty-spawn-helper.ts'
import { resolveLocalShell, resolveLocalShellWithStartupShellCommand } from '#/server/terminal/terminal-local-shell.ts'

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
  startupShellCommand?: string
  cwd: string
  cols: number
  rows: number
  env?: Record<string, string>
}

export type SpawnTerminalPtyRuntimeResult = { ok: true; runtime: TerminalPtyRuntime } | { ok: false; message: string }

export function spawnTerminalPtyRuntime(input: SpawnTerminalPtyRuntimeInput): SpawnTerminalPtyRuntimeResult {
  try {
    if (input.startupShellCommand && (input.command?.trim() || (input.args?.length ?? 0) > 0)) {
      return { ok: false, message: 'startupShellCommand cannot be combined with command or args' }
    }
    const shell = input.startupShellCommand
      ? resolveLocalShellWithStartupShellCommand(input.startupShellCommand)
      : resolveLocalShell(input)
    const env = { ...process.env, ...input.env, TERM: 'xterm-256color' }
    ensureNodePtyDarwinSpawnHelperExecutable()
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
