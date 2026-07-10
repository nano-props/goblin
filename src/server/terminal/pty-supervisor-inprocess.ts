import { spawnTerminalPtyRuntime, type TerminalPtyRuntime } from '#/server/terminal/terminal-pty-runtime.ts'
import {
  createPtyHandle,
  type PtySpawnInput,
  type PtySpawnResult,
  type PtySupervisor,
} from '#/server/terminal/pty-supervisor.ts'
import { createOpaqueId } from '#/shared/opaque-id.ts'

interface PtyEntry {
  runtime: TerminalPtyRuntime
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
      const entry: PtyEntry = { runtime: result.runtime }
      entries.set(handle.ptySessionId, entry)
      return { ok: true, handle, processName: entry.runtime.processName() || 'terminal' }
    },
    write(handle, data) {
      entries.get(handle.ptySessionId)?.runtime.write(data)
    },
    resize(handle, cols, rows) {
      entries.get(handle.ptySessionId)?.runtime.resize(cols, rows)
    },
    kill(handle) {
      const entry = entries.get(handle.ptySessionId)
      entries.delete(handle.ptySessionId)
      entry?.runtime.kill()
    },
    async killAndWait(handle) {
      const entry = entries.get(handle.ptySessionId)
      if (!entry) return
      await new Promise<void>((resolve, reject) => {
        let settled = false
        let timer: ReturnType<typeof setTimeout> | null = null
        const finish = () => {
          if (settled) return
          settled = true
          if (timer) clearTimeout(timer)
          entries.delete(handle.ptySessionId)
          resolve()
        }
        const disposable = entry.runtime.onExit(() => {
          disposable.dispose()
          finish()
        })
        timer = setTimeout(() => {
          if (settled) return
          settled = true
          disposable.dispose()
          reject(new Error('PTY close timed out'))
        }, 2_000)
        entry.runtime.kill()
      })
    },
    onData(handle, listener) {
      const entry = entries.get(handle.ptySessionId)
      if (!entry) return { dispose: () => {} }
      return entry.runtime.onData((data) => {
        listener(data)
      })
    },
    onExit(handle, listener) {
      const entry = entries.get(handle.ptySessionId)
      if (!entry) return { dispose: () => {} }
      // node-pty's onExit only signals "exited" without (code, signal).
      // The supervisor contract carries both; we pass nulls because the
      // worker is the source of truth for exit metadata and the in-process
      // variant cannot recover it after the fact.
      return entry.runtime.onExit(() => {
        entries.delete(handle.ptySessionId)
        listener(null, null)
      })
    },
    processName(handle) {
      const entry = entries.get(handle.ptySessionId)
      if (!entry) return 'terminal'
      try {
        return entry.runtime.processName() || 'terminal'
      } catch {
        return 'terminal'
      }
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
  return createOpaqueId('pty')
}
