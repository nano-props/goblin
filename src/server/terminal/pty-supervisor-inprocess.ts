import {
  spawnTerminalPtyRuntime,
  type TerminalPtyRuntime,
  type TerminalPtyRuntimeEventOwnership,
} from '#/server/terminal/terminal-pty-runtime.ts'
import {
  createPtyHandle,
  type PtySpawnInput,
  type PtySpawnResult,
  type PtySupervisor,
} from '#/server/terminal/pty-supervisor.ts'
import { createPtyEventChannel, type PtyEventChannel } from '#/server/terminal/pty-event-lease.ts'
import { createOpaqueId } from '#/shared/opaque-id.ts'
import { StickyCompletion } from '#/server/terminal/sticky-completion.ts'

interface PtyEntry {
  runtime: TerminalPtyRuntime
  events: PtyEventChannel
  nativeEvents: TerminalPtyRuntimeEventOwnership
  exitCompletion: StickyCompletion
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
      if (shuttingDown) return { ok: false, message: 'PTY supervisor stopped' }
      const handle = createPtyHandle(createPtySessionId())
      const events = createPtyEventChannel()
      const exitCompletion = new StickyCompletion()
      let entry: PtyEntry | null = null
      const result = spawnTerminalPtyRuntime(input, {
        onData(data, processName) {
          events.sink.data({ data, processName })
        },
        onExit() {
          if (!exitCompletion.complete()) return
          if (entry && entries.get(handle.ptySessionId) === entry) entries.delete(handle.ptySessionId)
          events.sink.exit(null, null)
        },
      })
      if (!result.ok) {
        events.lease.dispose()
        exitCompletion.complete()
        return { ok: false, message: result.message }
      }
      entry = {
        runtime: result.runtime,
        events,
        nativeEvents: result.events,
        exitCompletion,
        killRequested: false,
        killOperation: null,
      }
      if (!exitCompletion.completed) entries.set(handle.ptySessionId, entry)
      return {
        ok: true,
        handle,
        processName: safeProcessName(entry.runtime),
        events: {
          claim(observer) {
            const claim = entry.events.lease.claim(observer)
            return {
              activate: () => claim.activate(),
              dispose: () => {
                claim.dispose()
                entry.nativeEvents.disposeData()
              },
            }
          },
          dispose() {
            entry.events.lease.dispose()
            entry.nativeEvents.disposeData()
          },
        },
      }
    },
    async write(handle, data) {
      const entry = entries.get(handle.ptySessionId)
      if (!entry) return { status: 'rejected' }
      try {
        entry.runtime.write(data)
        return { status: 'accepted' }
      } catch {
        return { status: 'indeterminate' }
      }
    },
    async resize(handle, cols, rows) {
      const entry = entries.get(handle.ptySessionId)
      if (!entry) return false
      try {
        entry.runtime.resize(cols, rows)
        return true
      } catch {
        return false
      }
    },
    kill(handle) {
      const entry = entries.get(handle.ptySessionId)
      if (entry) requestKill(entry)
    },
    async waitForExit(handle) {
      const entry = entries.get(handle.ptySessionId)
      if (!entry) return
      await entry.exitCompletion.waitUntilCompleted()
    },
    async killAndWait(handle) {
      const entry = entries.get(handle.ptySessionId)
      if (!entry) return
      await sharedKillOperation(entry)
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
        entry.events.lease.dispose()
        entry.nativeEvents.dispose()
        try {
          entry.runtime.kill()
        } catch {}
        entry.exitCompletion.complete()
      }
      entries.clear()
    },
  }
}

function createPtySessionId(): string {
  return createOpaqueId('pty')
}

function safeProcessName(runtime: TerminalPtyRuntime): string {
  try {
    return runtime.processName() || 'terminal'
  } catch {
    return 'terminal'
  }
}
