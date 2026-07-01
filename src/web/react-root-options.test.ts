import { describe, expect, test, vi } from 'vitest'
import { reactRootOptions } from '#/web/react-root-options.ts'

describe('reactRootOptions', () => {
  test('does not register root caught-error logging', () => {
    const options = reactRootOptions({
      dev: false,
      log: { error: vi.fn(), warn: vi.fn() },
      markRenderErrorLogged: vi.fn(),
    })

    expect(options).toBeTruthy()
    expect(options).not.toHaveProperty('onCaughtError')
  })

  test('logs uncaught render errors once', () => {
    const error = new Error('boom')
    const log = { error: vi.fn(), warn: vi.fn() }
    const markRenderErrorLogged = vi.fn(() => false)
    const options = reactRootOptions({ dev: false, log, markRenderErrorLogged })

    options?.onUncaughtError?.(error, { componentStack: 'stack' })

    expect(markRenderErrorLogged).toHaveBeenCalledWith(error)
    expect(log.error).toHaveBeenCalledWith('uncaught render error', { error, componentStack: 'stack' })
  })

  test('suppresses duplicate uncaught render errors', () => {
    const log = { error: vi.fn(), warn: vi.fn() }
    const options = reactRootOptions({
      dev: false,
      log,
      markRenderErrorLogged: vi.fn(() => true),
    })

    options?.onUncaughtError?.(new Error('boom'), { componentStack: 'stack' })

    expect(log.error).not.toHaveBeenCalled()
  })
})
