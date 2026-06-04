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

export type SpawnTerminalPtyRuntimeResult =
  | { ok: true; runtime: TerminalPtyRuntime }
  | { ok: false; message: string }

export function spawnTerminalPtyRuntime(input: SpawnTerminalPtyRuntimeInput): SpawnTerminalPtyRuntimeResult {
  try {
    const shell = input.command || process.env.SHELL || (process.platform === 'win32' ? process.env.COMSPEC || 'cmd.exe' : '/bin/zsh')
    const args = input.args ?? (process.platform === 'win32' ? [] : ['-l'])
    const env = { ...process.env, TERM: 'xterm-256color' }
    const term = pty.spawn(shell, args, {
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
    const processName = typeof this.term.process === 'string' ? this.term.process.trim() : ''
    return processName || 'terminal'
  }
}
