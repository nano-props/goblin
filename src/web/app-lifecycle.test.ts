// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'

describe('app lifecycle', () => {
  beforeEach(() => {
    vi.resetModules()
    Object.defineProperty(window, 'goblinNative', {
      configurable: true,
      value: {
        onIntent: vi.fn(),
      },
    })
  })

  test('marks the app as quitting from the low-level native intent subscription', async () => {
    const listeners: Array<(event: { type: string }) => void> = []
    ;(window.goblinNative.onIntent as ReturnType<typeof vi.fn>).mockImplementation(
      (cb: (event: { type: string }) => void) => {
        listeners.push(cb)
        return () => {}
      },
    )
    const { isAppQuitting, subscribeAppQuitting } = await import('#/web/app-lifecycle.ts')
    const onQuit = vi.fn()
    subscribeAppQuitting(onQuit)

    listeners[0]?.({ type: 'app-quitting' })

    expect(isAppQuitting()).toBe(true)
    expect(onQuit).toHaveBeenCalledTimes(1)
  })

  test('stays idle in pure web mode when no native bridge is present', async () => {
    Object.defineProperty(window, 'goblinNative', {
      configurable: true,
      value: undefined,
    })

    const { isAppQuitting, subscribeAppQuitting } = await import('#/web/app-lifecycle.ts')
    const onQuit = vi.fn()
    const dispose = subscribeAppQuitting(onQuit)

    expect(isAppQuitting()).toBe(false)
    expect(onQuit).not.toHaveBeenCalled()

    dispose()
  })
})
