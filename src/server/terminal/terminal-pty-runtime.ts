import * as pty from 'node-pty'
import { resolveLocalShell, resolveLocalShellWithStartupShellCommand } from '#/server/terminal/terminal-local-shell.ts'

export interface TerminalPtyRuntime {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  processName(): string
}

export interface TerminalPtyRuntimeEventObserver {
  onData(data: string, processName: string): void
  onExit(): void
}

export interface TerminalPtyRuntimeEventOwnership {
  /** Stops output delivery while retaining the exit observer used by kill-and-wait. */
  disposeData(): void
  /** Releases every native observer. Used only after exit or supervisor shutdown. */
  dispose(): void
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

export type SpawnTerminalPtyRuntimeResult =
  { ok: true; runtime: TerminalPtyRuntime; events: TerminalPtyRuntimeEventOwnership } | { ok: false; message: string }

export function spawnTerminalPtyRuntime(
  input: SpawnTerminalPtyRuntimeInput,
  observer: TerminalPtyRuntimeEventObserver,
): SpawnTerminalPtyRuntimeResult {
  let term: pty.IPty | null = null
  let dataDisposable: { dispose(): void } | null = null
  let exitDisposable: { dispose(): void } | null = null
  let exited = false
  const disposeData = (): void => {
    dataDisposable?.dispose()
    dataDisposable = null
  }
  const dispose = (): void => {
    disposeData()
    exitDisposable?.dispose()
    exitDisposable = null
  }
  try {
    if (input.startupShellCommand && (input.command?.trim() || (input.args?.length ?? 0) > 0)) {
      return { ok: false, message: 'startupShellCommand cannot be combined with command or args' }
    }
    const shell = input.startupShellCommand
      ? resolveLocalShellWithStartupShellCommand(input.startupShellCommand)
      : resolveLocalShell(input)
    const env = userShellEnvironment(input.env)
    term = pty.spawn(shell.command, shell.args, {
      name: 'xterm-256color',
      cols: input.cols,
      rows: input.rows,
      cwd: input.cwd,
      env,
    })
    const runtime = new NodePtyTerminalRuntime(term)
    // Native event ownership is installed before the control capability can
    // cross a supervisor or process boundary.
    dataDisposable = term.onData((data) => {
      if (!exited) observer.onData(data, readTerminalProcessName(term!))
    })
    const nextExitDisposable = term.onExit(() => {
      if (exited) return
      exited = true
      dispose()
      observer.onExit()
    })
    if (exited) nextExitDisposable.dispose()
    else exitDisposable = nextExitDisposable
    return { ok: true, runtime, events: { disposeData, dispose } }
  } catch (error) {
    dispose()
    try {
      term?.kill()
    } catch {}
    return { ok: false, message: error instanceof Error ? error.message : 'error.unknown' }
  }
}

function userShellEnvironment(overrides: Record<string, string> | undefined): NodeJS.ProcessEnv {
  const environment = { ...process.env, ...overrides, TERM: 'xterm-256color' }
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => name !== 'ELECTRON_RUN_AS_NODE' && name !== 'ELECTRON_NO_ASAR'),
  )
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
