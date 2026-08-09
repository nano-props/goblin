import { describe, expect, test } from 'vitest'
import { markRenderErrorLogged } from '#/web/render-error-logging.ts'

describe('markRenderErrorLogged', () => {
  test('dedupes object errors without mutating them', async () => {
    const error = Object.freeze({ message: 'render failed' })

    expect(() => markRenderErrorLogged(error)).not.toThrow()
    expect(markRenderErrorLogged(error)).toBe(true)
  })

  test('dedupes repeated primitive errors', async () => {
    const message = Symbol('render failed')

    expect(markRenderErrorLogged(message)).toBe(false)
    expect(markRenderErrorLogged(message)).toBe(true)
  })
})
