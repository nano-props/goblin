import { EventEmitter } from 'node:events'
import { describe, expect, test, vi } from 'vitest'
import { bootstrapPtyWorker } from '#/server/terminal/pty-worker-bootstrap.ts'
import type { PtyWorkerMessage } from '#/server/terminal/pty-worker-protocol.ts'

class FakeParentProcess extends EventEmitter {
  readonly sent: PtyWorkerMessage[] = []

  send(message: PtyWorkerMessage): boolean {
    this.sent.push(message)
    return true
  }
}

describe('bootstrapPtyWorker', () => {
  test('shuts down every worker-owned PTY when the parent IPC channel disconnects', () => {
    const parent = new FakeParentProcess()
    const runtime = bootstrapPtyWorker(parent)
    const shutdown = vi.spyOn(runtime, 'shutdown')

    parent.emit('disconnect')
    parent.emit('disconnect')

    expect(shutdown).toHaveBeenCalledOnce()
  })
})
