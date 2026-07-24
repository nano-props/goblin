// PTY-only worker runtime. Runs in a dedicated subprocess and owns a
// pool of `node-pty` instances. The worker knows nothing about
// sessions, sockets, or business state — it translates the wire
// protocol into node-pty calls and emits data/exit events.
//
// Process-name is sampled on every onData chunk (cheap property
// read from node-pty) so the native host always has a fresh view
// of the foreground process — even after a child exits without
// emitting a title-OSC.

import {
  spawnTerminalPtyRuntime,
  type SpawnTerminalPtyRuntimeResult,
  type TerminalPtyRuntime,
  type TerminalPtyRuntimeEventObserver,
  type TerminalPtyRuntimeEventOwnership,
} from '#/server/terminal/terminal-pty-runtime.ts'
import type { PtySpawnInput } from '#/server/terminal/pty-supervisor.ts'
import type {
  PtyWorkerMessage,
  PtyWorkerRequest,
  PtyWorkerSpawnFailureCode,
} from '#/server/terminal/pty-worker-protocol.ts'

/** The return shape from a PtySupervisor-style spawn call. The worker
 *  runtime's spawnPty fn returns this same shape so the failure path
 *  (a structured `{ ok: false, message }` instead of a throw) is
 *  expressible from the start. */
type PtySpawnOutcome = SpawnTerminalPtyRuntimeResult

export interface PtyWorkerRuntimeOptions {
  emit(message: PtyWorkerMessage): void
  /**
   * Injectable spawn implementation. Defaults to a real `pty.spawn`
   * call wrapped in a try/catch so the worker surfaces a structured
   * `pty-spawn-result { ok: false }` on every failure path rather
   * than dying. Tests pass a stub to exercise the failure path
   * without faking `node-pty` at the module level.
   */
  spawnPty?: (input: PtySpawnInput, observer: TerminalPtyRuntimeEventObserver) => PtySpawnOutcome
}

interface PtyEntry {
  runtime: TerminalPtyRuntime
  events: TerminalPtyRuntimeEventOwnership
}

export class PtyWorkerRuntime {
  private readonly options: PtyWorkerRuntimeOptions
  private readonly ptys = new Map<string, PtyEntry>()
  private readonly spawnPty: (input: PtySpawnInput, observer: TerminalPtyRuntimeEventObserver) => PtySpawnOutcome

  constructor(options: PtyWorkerRuntimeOptions) {
    this.options = options
    this.spawnPty = options.spawnPty ?? defaultSpawnPty
  }

  handleMessage(message: PtyWorkerRequest | null | undefined): void {
    if (!message || typeof message !== 'object') return
    switch (message.type) {
      case 'pty-spawn':
        this.handleSpawn(message.requestId, message.ptySessionId, message.input)
        return
      case 'pty-write':
        this.handleWrite(message.requestId, message.ptySessionId, message.data)
        return
      case 'pty-resize':
        this.handleResize(message.requestId, message.ptySessionId, message.cols, message.rows)
        return
      case 'pty-kill':
        try {
          this.ptys.get(message.ptySessionId)?.runtime.kill()
        } catch {}
        return
      case 'shutdown':
        this.shutdown()
        return
    }
  }

  private handleWrite(requestId: string, ptySessionId: string, data: string): void {
    const entry = this.ptys.get(ptySessionId)
    if (!entry) {
      this.options.emit({ type: 'pty-write-result', requestId, status: 'rejected' })
      return
    }
    try {
      entry.runtime.write(data)
      this.options.emit({ type: 'pty-write-result', requestId, status: 'accepted' })
    } catch {
      this.options.emit({ type: 'pty-write-result', requestId, status: 'indeterminate' })
    }
  }

  private handleResize(requestId: string, ptySessionId: string, cols: number, rows: number): void {
    const entry = this.ptys.get(ptySessionId)
    if (!entry) {
      this.options.emit({ type: 'pty-resize-result', requestId, accepted: false })
      return
    }
    try {
      entry.runtime.resize(cols, rows)
      this.options.emit({ type: 'pty-resize-result', requestId, accepted: true })
    } catch {
      this.options.emit({ type: 'pty-resize-result', requestId, accepted: false })
    }
  }

  private handleSpawn(requestId: string, ptySessionId: string, input: PtySpawnInput): void {
    let exited = false
    let processName = 'terminal'
    const result = this.spawnPty(input, {
      onData: (data, nextProcessName) => {
        if (exited) return
        if (nextProcessName && nextProcessName !== processName) {
          processName = nextProcessName
          this.options.emit({ type: 'pty-process-name-changed', ptySessionId, processName })
        }
        this.options.emit({ type: 'pty-data', ptySessionId, data })
      },
      onExit: () => {
        if (exited) return
        exited = true
        this.ptys.delete(ptySessionId)
        this.options.emit({ type: 'pty-exit', ptySessionId, code: null, signal: null })
      },
    })
    if (!result.ok) {
      this.options.emit({
        type: 'pty-spawn-result',
        requestId,
        ok: false,
        error: result.message,
        failure: classifyPtySpawnFailure(result.message),
      })
      return
    }
    // Defer the initial sample to the first onData chunk: node-pty's
    // macOS spawn-helper briefly holds the PTY before exec'ing the
    // shell, so term.process read in the same tick as pty.spawn returns
    // the helper's comm. By the time the shell has produced output,
    // the helper is gone and the comm is the real name.
    if (!exited) this.ptys.set(ptySessionId, { runtime: result.runtime, events: result.events })
    this.options.emit({
      type: 'pty-spawn-result',
      requestId,
      ok: true,
      ptySessionId,
      processName: 'terminal',
    })
  }

  shutdown(): void {
    for (const entry of Array.from(this.ptys.values())) {
      entry.events.dispose()
      try {
        entry.runtime.kill()
      } catch {}
    }
    this.ptys.clear()
  }
}

function defaultSpawnPty(input: PtySpawnInput, observer: TerminalPtyRuntimeEventObserver): PtySpawnOutcome {
  return spawnTerminalPtyRuntime(input, observer)
}

function classifyPtySpawnFailure(message: string): { code: PtyWorkerSpawnFailureCode; recoverable: boolean } {
  if (message.toLowerCase().includes('posix_spawnp failed')) {
    return { code: 'native-pty-spawn-failed', recoverable: true }
  }
  return { code: 'unknown', recoverable: false }
}
