// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { currentNativeBridge } from '#/web/test-utils/current-native-bridge.ts'

describe('app lifecycle', () => {
  beforeEach(() => {
    vi.resetModules()
    Object.defineProperty(window, 'goblinNative', {
      configurable: true,
      value: currentNativeBridge({
        onIntent: vi.fn(),
        notifyAppQuitDrained: vi.fn(async () => true),
      }),
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

  test('notifies native only after async quit listeners finish', async () => {
    const listeners: Array<(event: { type: string }) => void> = []
    ;(window.goblinNative.onIntent as ReturnType<typeof vi.fn>).mockImplementation(
      (cb: (event: { type: string }) => void) => {
        listeners.push(cb)
        return () => {}
      },
    )
    const drained = Promise.withResolvers<void>()
    const { subscribeAppQuitting } = await import('#/web/app-lifecycle.ts')
    subscribeAppQuitting(async () => await drained.promise)

    listeners[0]?.({ type: 'app-quitting' })
    await Promise.resolve()
    expect(window.goblinNative.notifyAppQuitDrained).not.toHaveBeenCalled()

    drained.resolve()
    await vi.waitFor(() => {
      expect(window.goblinNative.notifyAppQuitDrained).toHaveBeenCalledWith({ ok: true })
    })
  })

  test('notifies native with a failed result when a quit listener fails', async () => {
    const listeners: Array<(event: { type: string }) => void> = []
    ;(window.goblinNative.onIntent as ReturnType<typeof vi.fn>).mockImplementation(
      (cb: (event: { type: string }) => void) => {
        listeners.push(cb)
        return () => {}
      },
    )
    const { markAppQuitting, subscribeAppQuitting } = await import('#/web/app-lifecycle.ts')
    subscribeAppQuitting(async () => {
      throw new Error('save failed')
    })

    await expect(markAppQuitting()).rejects.toThrow('save failed')
    expect(window.goblinNative.notifyAppQuitDrained).toHaveBeenCalledWith({
      ok: false,
      error: { name: 'Error', message: 'save failed' },
    })
  })

  test('waits for all quit listeners to settle before reporting failure', async () => {
    const slow = Promise.withResolvers<void>()
    const { markAppQuitting, subscribeAppQuitting } = await import('#/web/app-lifecycle.ts')
    subscribeAppQuitting(async () => {
      throw new Error('save failed')
    })
    subscribeAppQuitting(async () => await slow.promise)

    const quitting = markAppQuitting()
    await Promise.resolve()
    expect(window.goblinNative.notifyAppQuitDrained).not.toHaveBeenCalled()

    slow.resolve()
    await expect(quitting).rejects.toThrow('save failed')
    expect(window.goblinNative.notifyAppQuitDrained).toHaveBeenCalledWith({
      ok: false,
      error: { name: 'Error', message: 'save failed' },
    })
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
