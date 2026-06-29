// PTY-only worker runtime. Runs in a dedicated subprocess and owns a
// pool of `node-pty` instances. The worker knows nothing about
// sessions, sockets, or business state — it translates the wire
// protocol into node-pty calls and emits data/exit events.
//
// Process-name is sampled on every onData chunk (cheap property
// read from node-pty) so the native host always has a fresh view
// of the foreground process — even after a child exits without
// emitting a title-OSC.

import { spawnTerminalPtyRuntime, type TerminalPtyRuntime } from '#/server/terminal/terminal-pty-runtime.ts'
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
type PtySpawnOutcome = { ok: true; runtime: TerminalPtyRuntime } | { ok: false; message: string }

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
        this.ptys.get(message.ptySessionId)?.runtime.write(message.data)
        return
      case 'pty-resize':
        this.ptys.get(message.ptySessionId)?.runtime.resize(message.cols, message.rows)
        return
      case 'pty-kill':
        this.ptys.get(message.ptySessionId)?.runtime.kill()
        return
      case 'shutdown':
        this.shutdown()
        return
    }
  }

  private handleSpawn(requestId: string, input: PtySpawnInput): void {
    const result = this.spawnPty(input)
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
    const ptySessionId = createPtySessionId()
    // Defer the initial sample to the first onData chunk: node-pty's
    // macOS spawn-helper briefly holds the PTY before exec'ing the
    // shell, so term.process read in the same tick as pty.spawn returns
    // the helper's comm. By the time the shell has produced output,
    // the helper is gone and the comm is the real name.
    this.ptys.set(ptySessionId, { runtime: result.runtime, processName: 'terminal' })
    this.options.emit({
      type: 'pty-spawn-result',
      requestId,
      ok: true,
      ptySessionId,
      processName: 'terminal',
    })
    this.wireDataAndExitEvents(ptySessionId, result.runtime)
  }

  private wireDataAndExitEvents(ptySessionId: string, runtime: TerminalPtyRuntime): void {
    runtime.onData((data) => {
      // Always sample process name so the native host has a fresh view
      // of the foreground process, even after a child exits without
      // setting a title-OSC. Emit the name-change BEFORE pty-data so
      // the native host's cache is updated when it processes this chunk.
      const nextName = safeProcessName(runtime)
      const entry = this.ptys.get(ptySessionId)
      if (entry && nextName && nextName !== entry.processName) {
        entry.processName = nextName
        this.options.emit({ type: 'pty-process-name-changed', ptySessionId, processName: nextName })
      }
      this.options.emit({ type: 'pty-data', ptySessionId, data })
    })
    runtime.onExit(() => {
      this.options.emit({ type: 'pty-exit', ptySessionId, code: null, signal: null })
      this.ptys.delete(ptySessionId)
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

function createPtySessionId(): string {
  return `pty_${crypto.randomUUID()}`
}

function defaultSpawnPty(input: PtySpawnInput): PtySpawnOutcome {
  return spawnTerminalPtyRuntime(input)
}

function classifyPtySpawnFailure(message: string): { code: PtyWorkerSpawnFailureCode; recoverable: boolean } {
  if (message.toLowerCase().includes('posix_spawnp failed')) {
    return { code: 'native-pty-spawn-failed', recoverable: true }
  }
  return { code: 'unknown', recoverable: false }
}

function safeProcessName(runtime: TerminalPtyRuntime): string {
  try {
    return runtime.processName()
  } catch {
    return 'terminal'
  }
}
