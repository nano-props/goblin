// Entry glue: connects `PtyWorkerRuntime` to the parent process via
// `process.send` and `process.on('message')`. This is the only file
// the worker entrypoint has to import.

import { PtyWorkerRuntime } from '#/server/terminal/pty-worker-runtime.ts'
import type { PtyWorkerMessage, PtyWorkerRequest } from '#/server/terminal/pty-worker-protocol.ts'

export interface PtyWorkerParentProcess {
  send?(message: PtyWorkerMessage): boolean
  on(event: 'message', listener: (raw: unknown) => void): unknown
  once(event: 'disconnect', listener: () => void): unknown
}

export function bootstrapPtyWorker(parent: PtyWorkerParentProcess = process): PtyWorkerRuntime {
  const runtime = new PtyWorkerRuntime({
    emit(message: PtyWorkerMessage) {
      if (typeof parent.send === 'function') {
        // Known limitation: PTY output currently has no worker-to-parent IPC
        // backpressure policy. `send()` may return false while Node retains an
        // unsent backlog; do not mistake downstream realtime limits for a
        // bound on this upstream queue.
        parent.send(message)
      }
    },
  })

  parent.on('message', (raw) => {
    runtime.handleMessage(raw as PtyWorkerRequest)
  })
  parent.once('disconnect', () => {
    runtime.shutdown()
  })
  return runtime
}
