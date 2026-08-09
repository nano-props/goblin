import { describe, expect, test, vi } from 'vitest'
import { vueAppErrorHandler } from '#/web/vue-app-error-handler.ts'

describe('vueAppErrorHandler', () => {
  test('lets Vue use its development error reporting', () => {
    expect(vueAppErrorHandler({ dev: true })).toBeUndefined()
  })

  test('logs an uncaught production render error once', () => {
    const error = new Error('boom')
    const log = { error: vi.fn() }
    const markErrorLogged = vi.fn(() => false)
    const handler = vueAppErrorHandler({ dev: false, log, markErrorLogged })

    handler?.(error, null, 'setup function')

    expect(markErrorLogged).toHaveBeenCalledWith(error)
    expect(log.error).toHaveBeenCalledWith('uncaught render error', {
      error,
      component: undefined,
      info: 'setup function',
    })
  })

  test('suppresses a render error already logged by a component boundary', () => {
    const log = { error: vi.fn() }
    const handler = vueAppErrorHandler({
      dev: false,
      log,
      markErrorLogged: vi.fn(() => true),
    })

    handler?.(new Error('boom'), null, 'render function')

    expect(log.error).not.toHaveBeenCalled()
  })
})
