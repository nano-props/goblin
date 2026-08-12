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

  test('marks the app as quitting and notifies listeners', async () => {
    const { isAppQuitting, markAppQuitting, subscribeAppQuitting } = await import('#/web/app-lifecycle.ts')
    const onQuit = vi.fn()
    subscribeAppQuitting(onQuit)

    await markAppQuitting()

    expect(isAppQuitting()).toBe(true)
    expect(onQuit).toHaveBeenCalledTimes(1)
  })

  test('receives native app quitting before authenticated UI mounts', async () => {
    let nativeQuit: (() => void) | undefined
    window.goblinNative.onAppQuitting = vi.fn((listener) => {
      nativeQuit = listener
      return () => {}
    })
    const { startNativeAppQuitIngress, subscribeAppQuitting } = await import('#/web/app-lifecycle.ts')
    const onQuit = vi.fn()
    subscribeAppQuitting(onQuit)
    startNativeAppQuitIngress()

    nativeQuit?.()
    await vi.waitFor(() => expect(window.goblinNative.notifyAppQuitDrained).toHaveBeenCalledWith({ ok: true }))

    expect(onQuit).toHaveBeenCalledOnce()
  })

  test('notifies native only after async quit listeners finish', async () => {
    const listenerStarted = Promise.withResolvers<void>()
    const drained = Promise.withResolvers<void>()
    const { markAppQuitting, subscribeAppQuitting } = await import('#/web/app-lifecycle.ts')
    subscribeAppQuitting(async () => {
      listenerStarted.resolve()
      await drained.promise
    })

    const quitting = markAppQuitting()
    await listenerStarted.promise
    expect(window.goblinNative.notifyAppQuitDrained).not.toHaveBeenCalled()

    drained.resolve()
    await quitting
    expect(window.goblinNative.notifyAppQuitDrained).toHaveBeenCalledWith({ ok: true })
  })

  test('notifies native with a failed result when a quit listener fails', async () => {
    const { markAppQuitting, subscribeAppQuitting } = await import('#/web/app-lifecycle.ts')
    subscribeAppQuitting(async () => {
      throw new Error('save failed')
    })

    await markAppQuitting()
    expect(window.goblinNative.notifyAppQuitDrained).toHaveBeenCalledWith({
      ok: false,
      error: { name: 'Error', message: 'save failed' },
    })
  })

  test('waits for all quit listeners to settle before reporting failure', async () => {
    const slowListenerStarted = Promise.withResolvers<void>()
    const slow = Promise.withResolvers<void>()
    const { markAppQuitting, subscribeAppQuitting } = await import('#/web/app-lifecycle.ts')
    subscribeAppQuitting(async () => {
      throw new Error('save failed')
    })
    subscribeAppQuitting(async () => {
      slowListenerStarted.resolve()
      await slow.promise
    })

    const quitting = markAppQuitting()
    await slowListenerStarted.promise
    expect(window.goblinNative.notifyAppQuitDrained).not.toHaveBeenCalled()

    slow.resolve()
    await quitting
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
