// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest'
import { createWebBootstrapOwner, startWebBootstrap } from '#/web/web-bootstrap.ts'

describe('web bootstrap ownership', () => {
  test('an old successful bootstrap cannot replace a newer failed result', async () => {
    const oldHydration = Promise.withResolvers<void>()
    const newHydration = Promise.withResolvers<void>()
    const rendered: string[] = []
    const oldOwner = createWebBootstrapOwner(1)
    startWebBootstrap({
      owner: oldOwner,
      timeoutMs: 15_000,
      hydrate: async () => await oldHydration.promise,
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

    expect(oldOwner.signal.aborted).toBe(true)
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
})
