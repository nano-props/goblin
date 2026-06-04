import type { TerminalWorkerMessage, TerminalWorkerRequest } from '#/server/terminal/terminal-worker-protocol.ts'
import { TerminalWorkerRuntime } from '#/server/terminal/terminal-worker-runtime.ts'
import { createTerminalService } from '#/server/terminal/terminal-service.ts'

export function bootstrapTerminalWorker(): void {
  const runtime = new TerminalWorkerRuntime({
    service: createTerminalService(),
    emit(message: TerminalWorkerMessage) {
      if (typeof process.send !== 'function') return
      process.send(message)
    },
    exit(code) {
      process.exit(code)
    },
  })

  process.on('message', (raw) => {
    void runtime.handleMessage(raw as TerminalWorkerRequest)
  })
}
