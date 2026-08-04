// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest'
import { useFakeTimers } from '#/test-utils/timers.ts'
import { createWebBootstrapOwner, startWebBootstrap } from '#/web/web-bootstrap.ts'

describe('web bootstrap ownership', () => {
  test('an old successful bootstrap cannot replace a newer failed result', async () => {
    const oldHydration = Promise.withResolvers<void>()
    const newHydration = Promise.withResolvers<void>()
    const rendered: string[] = []
    const oldOwner = createWebBootstrapOwner(1)
    let oldSignal: AbortSignal | undefined
    startWebBootstrap({
      owner: oldOwner,
      timeoutMs: 15_000,
      hydrate: async (signal) => {
        oldSignal = signal
        await oldHydration.promise
      },
      renderLoading: () => rendered.push('old-loading'),
      renderError: () => rendered.push('old-error'),
      renderApp: () => rendered.push('old-app'),
      logFailure: vi.fn(),
    })

    oldOwner.dispose()
    const newOwner = createWebBootstrapOwner(2)
    startWebBootstrap({
      owner: newOwner,
      timeoutMs: 15_000,
      hydrate: async () => await newHydration.promise,
      renderLoading: () => rendered.push('new-loading'),
      renderError: () => rendered.push('new-error'),
      renderApp: () => rendered.push('new-app'),
      logFailure: vi.fn(),
    })
    newHydration.reject(new Error('new bootstrap failed'))
    await expect(newHydration.promise).rejects.toThrow('new bootstrap failed')
    oldHydration.resolve()
    await oldHydration.promise
    await vi.waitFor(() => expect(rendered.at(-1)).toBe('new-error'))

    expect(oldSignal?.aborted).toBe(true)
    expect(rendered).not.toContain('old-app')
  })

  test('an old failed bootstrap cannot replace a newer successful result', async () => {
    const oldHydration = Promise.withResolvers<void>()
    const newHydration = Promise.withResolvers<void>()
    const rendered: string[] = []
    const oldFailure = vi.fn()
    const oldOwner = createWebBootstrapOwner(1)
    startWebBootstrap({
      owner: oldOwner,
      timeoutMs: 15_000,
      hydrate: async () => await oldHydration.promise,
      renderLoading: () => rendered.push('old-loading'),
      renderError: () => rendered.push('old-error'),
      renderApp: () => rendered.push('old-app'),
      logFailure: oldFailure,
    })

    oldOwner.dispose()
    const newOwner = createWebBootstrapOwner(2)
    startWebBootstrap({
      owner: newOwner,
      timeoutMs: 15_000,
      hydrate: async () => await newHydration.promise,
      renderLoading: () => rendered.push('new-loading'),
      renderError: () => rendered.push('new-error'),
      renderApp: () => rendered.push('new-app'),
      logFailure: vi.fn(),
    })
    newHydration.resolve()
    await newHydration.promise
    oldHydration.reject(new Error('old bootstrap failed'))
    await expect(oldHydration.promise).rejects.toThrow('old bootstrap failed')
    await vi.waitFor(() => expect(rendered.at(-1)).toBe('new-app'))

    expect(oldFailure).not.toHaveBeenCalled()
    expect(rendered).not.toContain('old-error')
  })

  test('an older retry failure cannot replace a newer successful attempt', async () => {
    const initialHydration = Promise.withResolvers<void>()
    const olderRetry = Promise.withResolvers<void>()
    const newerRetry = Promise.withResolvers<void>()
    const hydrations = [initialHydration.promise, olderRetry.promise, newerRetry.promise]
    const rendered: string[] = []
    let retry: (() => void) | undefined
    const logFailure = vi.fn()
    const signals: AbortSignal[] = []
    startWebBootstrap({
      owner: createWebBootstrapOwner(1),
      timeoutMs: 15_000,
      hydrate: async (signal) => {
        signals.push(signal)
        await hydrations.shift()
      },
      renderLoading: () => rendered.push('loading'),
      renderError: (nextRetry) => {
        retry = nextRetry
        rendered.push('error')
      },
      renderApp: () => rendered.push('app'),
      logFailure,
    })
    initialHydration.reject(new Error('initial failed'))
    await expect(initialHydration.promise).rejects.toThrow('initial failed')
    await vi.waitFor(() => expect(retry).toBeTypeOf('function'))

    retry?.()
    retry?.()
    expect(signals[1]?.aborted).toBe(true)
    newerRetry.resolve()
    await newerRetry.promise
    await vi.waitFor(() => expect(rendered.at(-1)).toBe('app'))
    olderRetry.reject(new Error('older retry failed'))
    await expect(olderRetry.promise).rejects.toThrow('older retry failed')

    await vi.waitFor(() => expect(rendered.at(-1)).toBe('app'))
    expect(logFailure).toHaveBeenCalledTimes(1)
  })

  test('an older retry success cannot replace a newer failed attempt', async () => {
    const initialHydration = Promise.withResolvers<void>()
    const olderRetry = Promise.withResolvers<void>()
    const newerRetry = Promise.withResolvers<void>()
    const hydrations = [initialHydration.promise, olderRetry.promise, newerRetry.promise]
    const rendered: string[] = []
    let retry: (() => void) | undefined
    startWebBootstrap({
      owner: createWebBootstrapOwner(1),
      timeoutMs: 15_000,
      hydrate: async () => await hydrations.shift(),
      renderLoading: () => rendered.push('loading'),
      renderError: (nextRetry) => {
        retry = nextRetry
        rendered.push('error')
      },
      renderApp: () => rendered.push('app'),
      logFailure: vi.fn(),
    })
    initialHydration.reject(new Error('initial failed'))
    await expect(initialHydration.promise).rejects.toThrow('initial failed')
    await vi.waitFor(() => expect(retry).toBeTypeOf('function'))

    retry?.()
    retry?.()
    newerRetry.reject(new Error('newer retry failed'))
    await expect(newerRetry.promise).rejects.toThrow('newer retry failed')
    await vi.waitFor(() => expect(rendered.at(-1)).toBe('error'))
    olderRetry.resolve()
    await olderRetry.promise

    await vi.waitFor(() => expect(rendered.at(-1)).toBe('error'))
  })

  test('a hydration that completes after its deadline cannot mount the app', async () => {
    useFakeTimers()
    const hydration = Promise.withResolvers<void>()
    const rendered: string[] = []
    startWebBootstrap({
      owner: createWebBootstrapOwner(1),
      timeoutMs: 15_000,
      hydrate: async () => await hydration.promise,
      renderLoading: () => rendered.push('loading'),
      renderError: () => rendered.push('error'),
      renderApp: () => rendered.push('app'),
      logFailure: vi.fn(),
    })

    await vi.advanceTimersByTimeAsync(15_000)
    hydration.resolve()
    await hydration.promise

    await vi.waitFor(() => expect(rendered.at(-1)).toBe('error'))
    expect(rendered).not.toContain('app')
  })
})
