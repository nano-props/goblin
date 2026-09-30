import path from 'node:path'
import { resolveLocalShell, resolveLocalShellWithStartupShellCommand } from '#/server/terminal/terminal-local-shell.ts'
import { readTerminalProcessName } from '#/system/terminal-process-name.ts'

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
  let child: ReturnType<typeof Bun.spawn> | null = null
  let dataOwned = true
  let exitOwned = true
  let processExited = false
  let terminalEnded = false
  let exitDelivered = false
  const decoder = new TextDecoder()
  const disposeData = () => {
    dataOwned = false
  }
  const dispose = () => {
    dataOwned = false
    exitOwned = false
  }
  try {
    if (input.startupShellCommand && (input.command?.trim() || (input.args?.length ?? 0) > 0))
      return { ok: false, message: 'startupShellCommand cannot be combined with command or args' }
    if (process.platform !== 'linux' && process.platform !== 'darwin')
      return { ok: false, message: 'Bun PTY requires Linux or macOS' }
    const shell = input.startupShellCommand
      ? resolveLocalShellWithStartupShellCommand(input.startupShellCommand)
      : resolveLocalShell(input)
    const launchName = path.basename(shell.command) || 'terminal'
    let label = launchName
    let lastLabelRead = -Infinity
    const processName = () => {
      // Foreground names are presentation only. Bound OS queries during large
      // output bursts, especially macOS where ps supplies this information.
      const now = performance.now()
      if (child && now - lastLabelRead >= 250) {
        lastLabelRead = now
        label = readTerminalProcessName(child.pid, launchName)
      }
      return label
    }
    const finish = () => {
      if (!processExited || !terminalEnded || exitDelivered) return
      exitDelivered = true
      const notify = exitOwned
      dispose()
      // EOF is a notification, not resource disposal. Release Bun’s PTY FDs
      // only after all final output has been delivered.
      child?.terminal?.close()
      if (notify) observer.onExit()
    }
    child = Bun.spawn([shell.command, ...shell.args], {
      cwd: input.cwd,
      env: { ...process.env, ...input.env, TERM: 'xterm-256color' },
      terminal: {
        name: 'xterm-256color',
        cols: input.cols,
        rows: input.rows,
        data(_terminal, bytes) {
          const data = decoder.decode(bytes, { stream: true })
          if (dataOwned && data) observer.onData(data, processName())
        },
        exit() {
          terminalEnded = true
          const data = decoder.decode()
          if (dataOwned && data) observer.onData(data, processName())
          finish()
        },
      },
    })
    const processHandle = child
    const terminal = processHandle.terminal
    if (!terminal) throw new Error('Bun did not create a PTY')
    // Process exit can precede the last data/EOF callback. Retire only after
    // both signals so fast commands cannot lose their final output.
    void processHandle.exited.then(() => {
      processExited = true
      finish()
    })
    const assertOpen = () => {
      if (terminalEnded || processExited || terminal.closed) throw new Error('Terminal has exited')
    }
    return {
      ok: true,
      runtime: {
        write(data) {
          assertOpen()
          terminal.write(data)
        },
        resize(cols, rows) {
          assertOpen()
          terminal.resize(cols, rows)
        },
        kill() {
          // Closing the master sends HUP to the foreground job as well as
          // releasing the PTY. Signal the tracked shell so exited can settle.
          try {
            processHandle.kill('SIGHUP')
          } finally {
            terminal.close()
          }
        },
        processName,
      },
      events: { disposeData, dispose },
    }
  } catch (error) {
    dispose()
    // A partially created candidate must not survive failed admission.
    try {
      child?.kill('SIGHUP')
    } catch {
      /* already exited */
    }
    try {
      child?.terminal?.close()
    } catch {
      /* already closed */
    }
    return { ok: false, message: error instanceof Error ? error.message : 'error.unknown' }
  }
}
