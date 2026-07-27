import { describe, expect, test, vi } from 'vitest'
import { BufferedAppRealtimeSocket } from '#/server/realtime/buffered-app-realtime-socket.ts'

describe('BufferedAppRealtimeSocket', () => {
  test('drops terminal output covered by a transition snapshot boundary', async () => {
    const rawSocket = { send: vi.fn(), close: vi.fn() }
    const socket = new BufferedAppRealtimeSocket(rawSocket)
    const transition = Promise.withResolvers<{
      terminalRuntimeSessionId: string
      terminalRuntimeGeneration: number
      seq: number
    }>()
    socket.enqueueTransition(() => transition.promise)

    socket.send(outputMessage('runtime_a', 1, 1, 'covered'))
    socket.send(outputMessage('runtime_a', 1, 2, 'after'))
    socket.send(outputMessage('runtime_a', 2, 1, 'other-generation'))
    socket.send(outputMessage('runtime_b', 1, 1, 'other-session'))

    transition.resolve({ terminalRuntimeSessionId: 'runtime_a', terminalRuntimeGeneration: 1, seq: 1 })

    await vi.waitFor(() => expect(rawSocket.send).toHaveBeenCalledTimes(3))
    expect(rawSocket.send.mock.calls.map(([payload]) => JSON.parse(payload).event.data)).toEqual([
      'after',
      'other-generation',
      'other-session',
    ])
  })
})

function outputMessage(
  terminalRuntimeSessionId: string,
  terminalRuntimeGeneration: number,
  seq: number,
  data: string,
): string {
  return JSON.stringify({
    type: 'output',
    event: { terminalRuntimeSessionId, terminalRuntimeGeneration, seq, data },
  })
}
