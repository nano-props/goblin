// PTY-only worker runtime. Runs in a dedicated subprocess and owns a
// pool of `node-pty` instances. The worker knows nothing about
// sessions, sockets, or business state — it translates the wire
// protocol into node-pty calls and emits data/exit events.
//
// Title-OSC-driven process-name updates: when the worker sees a
// title OSC (or the equivalent exec event) it samples the pty's
// `process` name and pushes a `pty-process-name-changed` event so
// the main process can refresh its cache without making a roundtrip
// per chunk.

import * as pty from 'node-pty'
import { resolveLocalShell } from '#/server/terminal/terminal-local-shell.ts'
import { type TerminalPtyRuntime } from '#/server/terminal/terminal-pty-runtime.ts'
import { appendOutput, createEmptyTerminalRenderState } from '#/server/terminal/terminal-render-state.ts'
import type { PtySpawnInput } from '#/server/terminal/pty-supervisor.ts'
import type { PtyWorkerMessage, PtyWorkerRequest } from '#/server/terminal/pty-worker-protocol.ts'

/** The return shape from a PtySupervisor-style spawn call. The worker
 *  runtime's spawnPty fn returns this same shape so the failure path
 *  (a structured `{ ok: false, message }` instead of a throw) is
 *  expressible from the start. */
type PtySpawnOutcome =
  | { ok: true; runtime: TerminalPtyRuntime }
  | { ok: false; message: string }

export interface PtyWorkerRuntimeOptions {
  emit(message: PtyWorkerMessage): void
  /**
   * Injectable spawn implementation. Defaults to a real `pty.spawn`
   * call wrapped in a try/catch so the worker surfaces a structured
   * `pty-spawn-result { ok: false }` on every failure path rather
   * than dying. Tests pass a stub to exercise the failure path
   * without faking `node-pty` at the module level.
   */
  spawnPty?: (input: PtySpawnInput) => PtySpawnOutcome
}

interface PtyEntry {
  runtime: TerminalPtyRuntime
  processName: string
}

export class PtyWorkerRuntime {
  private readonly options: PtyWorkerRuntimeOptions
  private readonly ptys = new Map<string, PtyEntry>()
  private readonly spawnPty: (input: PtySpawnInput) => PtySpawnOutcome

  constructor(options: PtyWorkerRuntimeOptions) {
    this.options = options
    this.spawnPty = options.spawnPty ?? defaultSpawnPty
  }

  handleMessage(message: PtyWorkerRequest | null | undefined): void {
    if (!message || typeof message !== 'object') return
    switch (message.type) {
      case 'pty-spawn':
        this.handleSpawn(message.requestId, message.input)
        return
      case 'pty-write':
        this.ptys.get(message.sessionId)?.runtime.write(message.data)
        return
      case 'pty-resize':
        this.ptys.get(message.sessionId)?.runtime.resize(message.cols, message.rows)
        return
      case 'pty-kill':
        this.ptys.get(message.sessionId)?.runtime.kill()
        return
      case 'shutdown':
        this.shutdown()
        return
    }
  }

  private handleSpawn(requestId: string, input: PtySpawnInput): void {
    const result = this.spawnPty(input)
    if (!result.ok) {
      this.options.emit({ type: 'pty-spawn-result', requestId, ok: false, error: result.message })
      return
    }
    const sessionId = createSessionId()
    const initialProcessName = safeProcessName(result.runtime)
    this.ptys.set(sessionId, { runtime: result.runtime, processName: initialProcessName })
    this.options.emit({
      type: 'pty-spawn-result',
      requestId,
      ok: true,
      sessionId,
      processName: initialProcessName,
    })
    this.wireDataAndExitEvents(sessionId, result.runtime, initialProcessName)
  }

  private wireDataAndExitEvents(sessionId: string, runtime: TerminalPtyRuntime, initialProcessName: string): void {
    const render = createEmptyTerminalRenderState()
    let lastBroadcastTitle: string | null = render.title
    let lastProcessName = initialProcessName
    runtime.onData((data) => {
      this.options.emit({ type: 'pty-data', sessionId, data })
      appendOutput(render, data)
      // Sample the child process name on title-change boundaries only.
      // Reading pty.process on every chunk is a syscall on Unix, and
      // shell title-OSC and exec events travel together (zsh -> bash
      // -> vim etc.) so the cheapest reliable signal is a title diff.
      if (render.title !== lastBroadcastTitle) {
        lastBroadcastTitle = render.title
        const nextName = safeProcessName(runtime)
        if (nextName && nextName !== lastProcessName) {
          lastProcessName = nextName
          const entry = this.ptys.get(sessionId)
          if (entry) entry.processName = nextName
          this.options.emit({ type: 'pty-process-name-changed', sessionId, processName: nextName })
        }
      }
    })
    runtime.onExit(() => {
      this.options.emit({ type: 'pty-exit', sessionId, code: null, signal: null })
      this.ptys.delete(sessionId)
    })
  }

  shutdown(): void {
    for (const entry of Array.from(this.ptys.values())) {
      try {
        entry.runtime.kill()
      } catch {}
    }
    this.ptys.clear()
  }
}

function createSessionId(): string {
  return `ptyw_${crypto.randomUUID()}`
}

function defaultSpawnPty(input: PtySpawnInput): PtySpawnOutcome {
  try {
    const shell = resolveLocalShell(input)
    const env = { ...process.env, TERM: 'xterm-256color' }
    // node-pty's own spawn handles failures synchronously by throwing;
    // resolveLocalShell does too. The try/catch here means the worker
    // surfaces a structured pty-spawn-result on every failure path
    // rather than dying.
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

function safeProcessName(runtime: TerminalPtyRuntime): string {
  try {
    const value = (runtime as unknown as { process?: unknown }).process
    if (typeof value !== 'string') return 'terminal'
    return value.trim() || 'terminal'
  } catch {
    return 'terminal'
  }
}

class NodePtyTerminalRuntime implements TerminalPtyRuntime {
  private readonly term: pty.IPty

  constructor(term: import('node-pty').IPty) {
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
    return safeProcessName(this)
  }
  // Used by safeProcessName above.
  get process(): string {
    return this.term.process
  }
}
