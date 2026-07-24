import { describe, expect, test, vi } from 'vitest'
import type { Terminal as XTermTerminal } from '@xterm/xterm'
import { TerminalRenderQueue, type RenderedOutputCheckpoint } from '#/web/components/terminal/terminal-render-queue.ts'

const BINDING = {
  terminalRuntimeSessionId: 'pty_render_queue_123456',
  terminalRuntimeGeneration: 1,
}

describe('TerminalRenderQueue', () => {
  test('waits for an active write callback before resetting the same xterm', async () => {
    const writeCallbacks: Array<() => void> = []
    const term = {
      reset: vi.fn(),
      write: vi.fn((_data: string, callback: () => void) => writeCallbacks.push(callback)),
    } as unknown as XTermTerminal
    const queue = new TerminalRenderQueue(term, {
      isCurrent: () => true,
      isCheckpointRendered: () => false,
      markOutputRendered: vi.fn(),
    })

    const append = queue.append('live output', checkpoint(1))
    const replace = queue.replace('recovery snapshot', checkpoint(2))
    await expect(append).resolves.toBe(false)
    expect(term.reset).not.toHaveBeenCalled()

    writeCallbacks.shift()?.()
    await vi.waitFor(() => expect(term.reset).toHaveBeenCalledOnce())
    expect(term.write).toHaveBeenLastCalledWith('recovery snapshot', expect.any(Function))

    writeCallbacks.shift()?.()
    await expect(replace).resolves.toBe(true)
  })

  test('reports an append write failure to its owner', async () => {
    const error = new Error('xterm write buffer overflow')
    const term = {
      reset: vi.fn(),
      write: vi.fn(() => {
        throw error
      }),
    } as unknown as XTermTerminal
    const queue = new TerminalRenderQueue(term, {
      isCurrent: () => true,
      isCheckpointRendered: () => false,
      markOutputRendered: vi.fn(),
    })

    await expect(queue.append('live output', checkpoint(1))).rejects.toBe(error)
  })
})

function checkpoint(seq: number): RenderedOutputCheckpoint {
  return { ...BINDING, seq }
}
