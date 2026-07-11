import { spawnTerminalPtyRuntime, type TerminalPtyRuntime } from '#/server/terminal/terminal-pty-runtime.ts'
import {
  createPtyHandle,
  type PtySpawnInput,
  type PtySpawnResult,
  type PtySupervisor,
} from '#/server/terminal/pty-supervisor.ts'
import { createOpaqueId } from '#/shared/opaque-id.ts'
import { StickyCompletion } from '#/server/terminal/sticky-completion.ts'

interface PtyEntry {
  runtime: TerminalPtyRuntime
  exitCompletion: StickyCompletion
  exitDisposable: { dispose(): void } | null
  killRequested: boolean
  killOperation: Promise<void> | null
}

export function createInProcessPtySupervisor(): PtySupervisor {
  const entries = new Map<string, PtyEntry>()
  let shuttingDown = false

  const requestKill = (entry: PtyEntry): void => {
    if (entry.killRequested) return
    entry.killRequested = true
    try {
      entry.runtime.kill()
    } catch (error) {
      entry.killRequested = false
      throw error
    }
  }

  const sharedKillOperation = (entry: PtyEntry): Promise<void> => {
    if (entry.exitCompletion.completed) return Promise.resolve()
    if (entry.killOperation) return entry.killOperation
    try {
      requestKill(entry)
    } catch (error) {
      return Promise.reject(error)
    }
    const operation = entry.exitCompletion.wait(2_000, 'PTY close timed out').finally(() => {
      if (!entry.exitCompletion.completed) entry.killRequested = false
      if (entry.killOperation === operation) entry.killOperation = null
    })
    entry.killOperation = operation
    return operation
  }

  return {
    mode: 'in-process',
    async spawn(input: PtySpawnInput): Promise<PtySpawnResult> {
      const result = spawnTerminalPtyRuntime(input)
      if (!result.ok) return { ok: false, message: result.message }
      const handle = createPtyHandle(createPtySessionId())
      const entry: PtyEntry = {
        runtime: result.runtime,
        exitCompletion: new StickyCompletion(),
        exitDisposable: null,
        killRequested: false,
        killOperation: null,
      }
      entries.set(handle.ptySessionId, entry)
      try {
        const exitDisposable = entry.runtime.onExit(() => {
          if (entry.exitCompletion.completed) return
          entry.exitDisposable?.dispose()
          entry.exitDisposable = null
          if (entries.get(handle.ptySessionId) === entry) entries.delete(handle.ptySessionId)
          entry.exitCompletion.complete()
        })
        if (entry.exitCompletion.completed) exitDisposable.dispose()
        else entry.exitDisposable = exitDisposable
      } catch (error) {
        entries.delete(handle.ptySessionId)
        try {
          entry.runtime.kill()
        } catch {}
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
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
      if (entry) requestKill(entry)
    },
    async killAndWait(handle) {
      const entry = entries.get(handle.ptySessionId)
      if (!entry) return
      await sharedKillOperation(entry)
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
      let disposed = false
      if (!entry) {
        queueMicrotask(() => {
          if (!disposed) listener(null, null)
        })
        return {
          dispose: () => {
            disposed = true
          },
        }
      }
      // node-pty's onExit only signals "exited" without (code, signal).
      // The supervisor contract carries both; we pass nulls because the
      // worker is the source of truth for exit metadata and the in-process
      // variant cannot recover it after the fact.
      return entry.exitCompletion.subscribe(() => {
        if (!disposed) listener(null, null)
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
