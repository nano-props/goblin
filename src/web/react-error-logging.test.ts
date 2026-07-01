import { describe, expect, test } from 'vitest'
import { markReactRenderErrorLogged } from '#/web/react-error-logging.ts'

describe('markReactRenderErrorLogged', () => {
  test('dedupes object errors without mutating them', () => {
    const error = Object.freeze({ message: 'render failed' })

    expect(() => markReactRenderErrorLogged(error)).not.toThrow()
    expect(markReactRenderErrorLogged(error)).toBe(true)
  })

  test('dedupes repeated primitive errors', () => {
    const message = Symbol('render failed')

    expect(markReactRenderErrorLogged(message)).toBe(false)
    expect(markReactRenderErrorLogged(message)).toBe(true)
  })
})
