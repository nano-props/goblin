import crypto from 'node:crypto'
import { resolveLocalShell } from '#/server/terminal/terminal-local-shell.ts'
import { spawnTerminalPtyRuntime, type TerminalPtyRuntime } from '#/server/terminal/terminal-pty-runtime.ts'
import {
  createPtyHandle,
  type PtyHandle,
  type PtySpawnInput,
  type PtySpawnResult,
  type PtySupervisor,
} from '#/server/terminal/pty-supervisor.ts'
import { appendOutput, createEmptyTerminalRenderState } from '#/server/terminal/terminal-render-state.ts'

interface PtyEntry {
  runtime: TerminalPtyRuntime
  processName: string
  /** Until the first onData chunk arrives, term.process returns the
   *  comm of node-pty's spawn-helper binary (or kernel_task) on macOS,
   *  not the shell. Sample on the first chunk instead. */
  needsInitialSample: boolean
}

export function createInProcessPtySupervisor(): PtySupervisor {
  const entries = new Map<string, PtyEntry>()
  let shuttingDown = false

  return {
    mode: 'in-process',
    async spawn(input: PtySpawnInput): Promise<PtySpawnResult> {
      const result = spawnTerminalPtyRuntime(input)
      if (!result.ok) return { ok: false, message: result.message }
      const handle = createPtyHandle(createPtySessionId())
      const entry: PtyEntry = { runtime: result.runtime, processName: 'terminal', needsInitialSample: true }
      entries.set(handle.sessionId, entry)
      return { ok: true, handle, processName: entry.processName }
    },
    write(handle, data) {
      entries.get(handle.sessionId)?.runtime.write(data)
    },
    resize(handle, cols, rows) {
      entries.get(handle.sessionId)?.runtime.resize(cols, rows)
    },
    kill(handle) {
      entries.get(handle.sessionId)?.runtime.kill()
    },
    onData(handle, listener) {
      const entry = entries.get(handle.sessionId)
      if (!entry) return { dispose: () => {} }
      // Mirror the worker's title-OSC-driven sampling so the cached
      // processName stays accurate after every shell exec (e.g. zsh
      // -> bash -> vim). The first-chunk sample also closes the
      // macOS spawn-helper race: by then spawn-helper has exec'd the
      // shell and term.process returns the real name.
      const render = createEmptyTerminalRenderState()
      let lastTitle: string | null = render.title
      return entry.runtime.onData((data) => {
        if (entry.needsInitialSample) {
          entry.needsInitialSample = false
          const name = entry.runtime.processName()
          if (name && name !== entry.processName) entry.processName = name
        }
        appendOutput(render, data)
        if (render.title !== lastTitle) {
          lastTitle = render.title
          const name = entry.runtime.processName()
          if (name && name !== entry.processName) entry.processName = name
        }
        listener(data)
      })
    },
    onExit(handle, listener) {
      const entry = entries.get(handle.sessionId)
      if (!entry) return { dispose: () => {} }
      // node-pty's onExit only signals "exited" without (code, signal).
      // The supervisor contract carries both; we pass nulls because the
      // worker is the source of truth for exit metadata and the in-process
      // variant cannot recover it after the fact.
      return entry.runtime.onExit(() => listener(null, null))
    },
    processName(handle) {
      return entries.get(handle.sessionId)?.processName ?? 'terminal'
    },
    getDiagnostics() {
      return {
        mode: 'in-process',
        state: shuttingDown ? 'shutting-down' : entries.size > 0 ? 'running' : 'idle',
        workerRunning: false,
        workerPid: null,
        workerStartedAt: null,
        workerUptimeMs: null,
        pendingRequests: 0,
        restartAttempts: 0,
        restartScheduled: false,
        shuttingDown,
        lastSuccessfulResponseAt: null,
        lastExitCode: null,
        lastExitSignal: null,
        lastFailure: null,
      }
    },
    shutdown() {
      if (shuttingDown) return
      shuttingDown = true
      for (const entry of Array.from(entries.values())) {
        try {
          entry.runtime.kill()
        } catch {}
      }
      entries.clear()
    },
  }
}

function createPtySessionId(): string {
  return `pty_${crypto.randomUUID()}`
}
