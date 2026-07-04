import { EventEmitter } from 'node:events'
import { describe, expect, test, vi } from 'vitest'
import {
  attachRecoverableStdioErrorHandler,
  installStdioErrorGuard,
  isRecoverableStdioWriteError,
} from '#/node/stdio-error-guard.ts'

describe('stdio error guard', () => {
  test.each(['EIO', 'EBADF', 'EPIPE'])('treats %s as a recoverable closed-stdio write error', (code) => {
    expect(isRecoverableStdioWriteError(Object.assign(new Error('write failed'), { code }))).toBe(true)
  })

  test('does not treat unknown errors as recoverable', () => {
    expect(isRecoverableStdioWriteError(Object.assign(new Error('boom'), { code: 'EINVAL' }))).toBe(false)
  })

  test('swallows recoverable stream error events', () => {
    const stream = new EventEmitter()
    attachRecoverableStdioErrorHandler(stream as never)

    expect(() => {
      stream.emit('error', Object.assign(new Error('i/o error'), { code: 'EIO' }))
    }).not.toThrow()
  })

  test('rethrows non-stdio stream errors', () => {
    const stream = new EventEmitter()
    attachRecoverableStdioErrorHandler(stream as never)

    expect(() => {
      stream.emit('error', Object.assign(new Error('bad write'), { code: 'EINVAL' }))
    }).toThrow('bad write')
  })

  test('installs handlers only once per process object', () => {
    const stdout = { on: vi.fn() }
    const stderr = { on: vi.fn() }
    const processLike = { stdout, stderr } as never

    installStdioErrorGuard(processLike)
    installStdioErrorGuard(processLike)

    expect(stdout.on).toHaveBeenCalledTimes(1)
    expect(stderr.on).toHaveBeenCalledTimes(1)
  })
})
