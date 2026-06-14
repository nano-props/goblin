// Entry glue: connects `PtyWorkerRuntime` to the parent process via
// `process.send` and `process.on('message')`. This is the only file
// the worker entrypoint has to import.

import { PtyWorkerRuntime } from '#/server/terminal/pty-worker-runtime.ts'
import type { PtyWorkerMessage, PtyWorkerRequest } from '#/server/terminal/pty-worker-protocol.ts'

export function bootstrapPtyWorker(): void {
  const runtime = new PtyWorkerRuntime({
    emit(message: PtyWorkerMessage) {
      if (typeof process.send === 'function') {
        process.send(message)
      }
    },
  })

  process.on('message', (raw) => {
    runtime.handleMessage(raw as PtyWorkerRequest)
  })
}
