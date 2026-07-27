// @vitest-environment jsdom

import { act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useFakeTimers } from '#/test-utils/timers.ts'

let hydrate: ReturnType<typeof vi.fn>
let hydrateHostInfo: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  document.body.innerHTML = '<div id="root"></div>'
  hydrate = vi.fn()
  hydrateHostInfo = vi.fn().mockResolvedValue(undefined)
  vi.doMock('#/web/stores/i18n.ts', () => ({
    useI18nStore: {
      getState: () => ({ hydrate }),
    },
  }))
  vi.doMock('#/web/stores/host-info.ts', () => ({
    useHostInfoStore: {
      getState: () => ({ hydrate: hydrateHostInfo }),
    },
  }))
  vi.doMock('#/web/logger.ts', () => ({
    bootstrapLog: { warn: vi.fn() },
  }))
  vi.doMock('#/web/primary-window-queries.ts', () => ({
    primaryWindowQueryClient: {},
  }))
  vi.doMock('@tanstack/react-query', async () => {
    const React = await import('react')
    return {
      QueryClientProvider: ({ children }: { children: React.ReactNode }) =>
        React.createElement(React.Fragment, null, children),
    }
  })
  vi.doMock('@tanstack/react-query-devtools', () => ({
    ReactQueryDevtools: () => null,
  }))
  vi.doMock('#/web/auth/AuthProvider.tsx', async () => {
    const React = await import('react')
    return {
      AuthProvider: ({ children }: { children: React.ReactNode }) =>
        React.createElement(React.Fragment, null, children),
    }
  })
  vi.doMock('#/web/hooks/useResponsiveUiMode.tsx', async () => {
    const React = await import('react')
    return {
      ResponsiveUiProvider: ({ children }: { children: React.ReactNode }) =>
        React.createElement(React.Fragment, null, children),
    }
  })
  vi.doMock('#/web/primary-window-router.tsx', async () => {
    const React = await import('react')
    return {
      PrimaryWindowRouterProvider: () => React.createElement('div', null, 'app mounted'),
    }
  })
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('client entrypoint', () => {
  test('mounts the app only after the initial i18n hydrate succeeds', async () => {
    let resolveHydrate!: () => void
    const hydratePromise = new Promise<void>((resolve) => {
      resolveHydrate = resolve
    })
    hydrate.mockReturnValue(hydratePromise)

    await act(async () => {
      await import('#/web/main.tsx')
    })

    expect(hydrate).toHaveBeenCalledWith({ subscribe: false, signal: expect.any(AbortSignal) })
    expect(document.body.textContent).toContain('Loading')
    expect(document.body.textContent).not.toContain('app mounted')

    await act(async () => {
      resolveHydrate()
      await hydratePromise
    })

    expect(document.body.textContent).toContain('app mounted')
  })

  test('keeps the app unmounted and offers retry when the initial i18n hydrate fails', async () => {
    hydrate.mockRejectedValueOnce(new Error('i18n unavailable')).mockResolvedValueOnce(undefined)

    await act(async () => {
      await import('#/web/main.tsx')
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Unable to load application resources.')
    })
    expect(document.body.textContent).not.toContain('app mounted')

    act(() => {
      document.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await waitFor(() => {
      expect(hydrate).toHaveBeenCalledTimes(2)
      expect(document.body.textContent).toContain('app mounted')
    })
  })

  test('aborts the initial i18n hydrate and shows retry after the boot timeout', async () => {
    useFakeTimers()
    hydrate.mockImplementation(({ signal }: { signal: AbortSignal }) => {
      return new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })

    await act(async () => {
      await import('#/web/main.tsx')
    })

    expect(document.body.textContent).toContain('Loading')
    expect(hydrate.mock.calls[0]?.[0].signal.aborted).toBe(false)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })

    expect(hydrate.mock.calls[0]?.[0].signal.aborted).toBe(true)
    expect(document.body.textContent).toContain('Unable to load application resources.')
    expect(document.body.textContent).not.toContain('app mounted')
  })

  test('keeps the app unmounted and retries when host info hydration fails', async () => {
    hydrate.mockResolvedValue(undefined)
    hydrateHostInfo.mockRejectedValueOnce(new Error('host unavailable')).mockResolvedValueOnce(undefined)

    await act(async () => {
      await import('#/web/main.tsx')
    })

    await waitFor(() => {
      expect(document.body.textContent).toContain('Unable to load application resources.')
    })
    expect(document.body.textContent).not.toContain('app mounted')

    act(() => {
      document.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await waitFor(() => {
      expect(hydrateHostInfo).toHaveBeenCalledTimes(2)
      expect(document.body.textContent).toContain('app mounted')
    })
  })
})
