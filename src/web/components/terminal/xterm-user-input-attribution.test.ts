// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest'
import { Terminal, type Terminal as XTermTerminal } from '@xterm/xterm'
import { subscribeToXtermUserInput } from '#/web/components/terminal/xterm-user-input-attribution.ts'

describe('subscribeToXtermUserInput', () => {
  test('subscribes to the pinned xterm implementation', () => {
    const term = new Terminal()
    const subscription = subscribeToXtermUserInput(term, vi.fn())

    expect(() => subscription.dispose()).not.toThrow()
    term.dispose()
  })

  test('subscribes through the pinned xterm core service', () => {
    const dispose = vi.fn()
    const listener = vi.fn()
    const coreService = {
      onUserInput: vi.fn(function (this: unknown, received: () => void) {
        expect(this).toBe(coreService)
        expect(received).toBe(listener)
        return { dispose }
      }),
    }
    const term = { _core: { coreService } } as unknown as XTermTerminal

    const subscription = subscribeToXtermUserInput(term, listener)

    subscription.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  test('fails fast when the pinned private boundary is unavailable', () => {
    expect(() => subscribeToXtermUserInput({} as XTermTerminal, vi.fn())).toThrow(
      'xterm user-input attribution is unavailable',
    )
  })

  test('fails fast when xterm returns an invalid subscription', () => {
    const term = {
      _core: { coreService: { onUserInput: () => undefined } },
    } as unknown as XTermTerminal
    expect(() => subscribeToXtermUserInput(term, vi.fn())).toThrow(
      'xterm user-input attribution returned an invalid subscription',
    )
  })
})
