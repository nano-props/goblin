import type { TerminalWorkerMessage, TerminalWorkerRequest } from '#/server/terminal/terminal-worker-protocol.ts'
import { TerminalWorkerRuntime } from '#/server/terminal/terminal-worker-runtime.ts'
import { createTerminalFacade } from '#/server/terminal/terminal-facade.ts'

export function bootstrapTerminalWorker(): void {
  const runtime = new TerminalWorkerRuntime({
    service: createTerminalFacade(),
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
