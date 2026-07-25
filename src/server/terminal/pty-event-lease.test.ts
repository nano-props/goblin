import { describe, expect, test, vi } from 'vitest'
import { createPtyEventChannel } from '#/server/terminal/pty-event-lease.ts'

describe('PTY event lease', () => {
  test('replays startup events in source order only after activation', () => {
    const channel = createPtyEventChannel()
    const delivered: string[] = []
    channel.sink.data(ptyData('first', 'process-a'))
    channel.sink.data(ptyData('second', 'process-b'))
    channel.sink.exit(0, null)

    const claim = channel.lease.claim({
      onData: ({ data, processName }) => delivered.push(`data:${processName}:${data}`),
      onExit: (code) => delivered.push(`exit:${code}`),
    })
    expect(delivered).toEqual([])

    claim.activate()

    expect(delivered).toEqual(['data:process-a:first', 'data:process-b:second', 'exit:0'])
  })

  test('forwards live events after activation and discards after disposal', () => {
    const channel = createPtyEventChannel()
    const onData = vi.fn()
    const claim = channel.lease.claim({ onData, onExit: vi.fn() })
    claim.activate()

    channel.sink.data(ptyData('live'))
    claim.dispose()
    channel.sink.data(ptyData('late'))

    expect(onData).toHaveBeenCalledOnce()
    expect(onData).toHaveBeenCalledWith(ptyData('live'))
  })

  test('preserves order when delivery synchronously produces another event', () => {
    const channel = createPtyEventChannel()
    const delivered: string[] = []
    channel.sink.data(ptyData('first'))
    channel.sink.data(ptyData('second'))
    const claim = channel.lease.claim({
      onData: ({ data }) => {
        delivered.push(data)
        if (data === 'first') channel.sink.data(ptyData('third'))
      },
      onExit: vi.fn(),
    })

    claim.activate()

    expect(delivered).toEqual(['first', 'second', 'third'])
  })

  test('fails closed when an observer throws', () => {
    const channel = createPtyEventChannel()
    const exit = vi.fn()
    channel.sink.data(ptyData('first'))
    channel.sink.exit(0, null)
    const claim = channel.lease.claim({
      onData: () => {
        throw new Error('observer failed')
      },
      onExit: exit,
    })

    expect(() => claim.activate()).toThrow('observer failed')
    expect(exit).not.toHaveBeenCalled()
    expect(() => channel.lease.claim({ onData: vi.fn(), onExit: vi.fn() })).toThrow('PTY event lease is unavailable')
  })

  test('treats exit as terminal and ignores later source callbacks', () => {
    const channel = createPtyEventChannel()
    const delivered: string[] = []
    const claim = channel.lease.claim({
      onData: ({ data }) => delivered.push(`data:${data}`),
      onExit: () => delivered.push('exit'),
    })
    claim.activate()

    channel.sink.data(ptyData('before'))
    channel.sink.exit(null, null)
    channel.sink.data(ptyData('after'))
    channel.sink.exit(null, null)

    expect(delivered).toEqual(['data:before', 'exit'])
  })

  test('fails explicitly instead of retaining an unbounded pre-claim stream', () => {
    const channel = createPtyEventChannel(4)
    channel.sink.data(ptyData('12345'))

    expect(() => channel.lease.claim({ onData: vi.fn(), onExit: vi.fn() })).toThrow(
      'PTY event buffer exceeded its ownership-transfer limit',
    )
  })

  test('bounds pre-claim output by its UTF-8 byte size', () => {
    const channel = createPtyEventChannel(2)
    channel.sink.data(ptyData('界'))

    expect(() => channel.lease.claim({ onData: vi.fn(), onExit: vi.fn() })).toThrow(
      'PTY event buffer exceeded its ownership-transfer limit',
    )
  })

  test('does not apply the ownership-transfer limit to live output after activation', () => {
    const channel = createPtyEventChannel(4)
    const onData = vi.fn()
    const claim = channel.lease.claim({ onData, onExit: vi.fn() })
    claim.activate()

    channel.sink.data(ptyData('12345'))

    expect(onData).toHaveBeenCalledWith(ptyData('12345'))
  })

  test('bounds the number of pre-claim events independently of their character count', () => {
    const channel = createPtyEventChannel(1_000, 2)
    channel.sink.data(ptyData('a'))
    channel.sink.data(ptyData('b'))
    channel.sink.data(ptyData('c'))

    expect(() => channel.lease.claim({ onData: vi.fn(), onExit: vi.fn() })).toThrow(
      'PTY event buffer exceeded its ownership-transfer limit',
    )
  })

  test('counts empty pre-claim data events toward the event limit', () => {
    const channel = createPtyEventChannel(1_000, 1)
    channel.sink.data(ptyData(''))
    channel.sink.data(ptyData(''))

    expect(() => channel.lease.claim({ onData: vi.fn(), onExit: vi.fn() })).toThrow(
      'PTY event buffer exceeded its ownership-transfer limit',
    )
  })

  test('allows exactly one owner to claim the event stream', () => {
    const channel = createPtyEventChannel()
    channel.lease.claim({ onData: vi.fn(), onExit: vi.fn() })

    expect(() => channel.lease.claim({ onData: vi.fn(), onExit: vi.fn() })).toThrow('PTY event lease is unavailable')
  })
})

function ptyData(data: string, processName = 'zsh') {
  return { data, processName }
}
