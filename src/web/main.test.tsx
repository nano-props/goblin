// @vitest-environment jsdom
import { userEvent } from '@testing-library/user-event'
import { defineComponent, onMounted, onUnmounted } from 'vue'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { waitFor } from '@testing-library/vue'
import { useFakeTimers } from '#/test-utils/timers.ts'

let hydrateI18n: ReturnType<typeof vi.fn>
let hydrateHostInfo: ReturnType<typeof vi.fn>
let appMount: ReturnType<typeof vi.fn>
let appUnmount: ReturnType<typeof vi.fn>
let disposeWebApp: (() => void) | null

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  document.body.innerHTML = '<div id="root"></div>'
  hydrateI18n = vi.fn().mockResolvedValue(undefined)
  hydrateHostInfo = vi.fn().mockResolvedValue(undefined)
  appMount = vi.fn()
  appUnmount = vi.fn()
  disposeWebApp = null

  vi.doMock('#/web/stores/i18n.ts', () => ({
    i18nStore: {
      getState: () => ({ hydrate: hydrateI18n }),
    },
  }))
  vi.doMock('#/web/stores/host-info.ts', () => ({
    hostInfoStore: {
      getState: () => ({ hydrate: hydrateHostInfo }),
    },
  }))
  vi.doMock('#/web/stores/i18n-vue.ts', () => ({
    appI18n: { install: vi.fn() },
    startI18nProjection: () => vi.fn(),
  }))
  vi.doMock('#/web/logger.ts', () => ({
    bootstrapLog: { error: vi.fn(), warn: vi.fn() },
  }))
  vi.doMock('#/web/app-router.tsx', () => ({
    appRouter: { install: vi.fn() },
    AppRouterProvider: defineComponent({
      name: 'TestAppRouterProvider',
      setup() {
        onMounted(appMount)
        onUnmounted(appUnmount)
        return () => <div>app mounted</div>
      },
    }),
  }))
})

afterEach(() => {
  disposeWebApp?.()
  document.body.innerHTML = ''
})

async function loadMain(): Promise<void> {
  const main = await import('#/web/main.tsx')
  disposeWebApp = main.disposeWebApp
}

describe('client entrypoint', () => {
  test('mounts the app only after the initial hydration succeeds', async () => {
    let resolveHydrate!: () => void
    const hydratePromise = new Promise<void>((resolve) => {
      resolveHydrate = resolve
    })
    hydrateI18n.mockReturnValue(hydratePromise)

    await loadMain()

    expect(hydrateI18n).toHaveBeenCalledWith({ subscribe: false, signal: expect.any(AbortSignal) })
    expect(document.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite')
    expect(document.body.textContent).toContain('Loading')
    expect(document.body.textContent).not.toContain('app mounted')

    resolveHydrate()
    await hydratePromise

    await waitFor(() => expect(document.body.textContent).toContain('app mounted'))
    expect(appMount).toHaveBeenCalledTimes(1)
    expect(appUnmount).not.toHaveBeenCalled()
  })

  test('offers retry when the initial hydration fails', async () => {
    const user = userEvent.setup()
    hydrateI18n.mockRejectedValueOnce(new Error('i18n unavailable')).mockResolvedValueOnce(undefined)

    await loadMain()

    await waitFor(() => expect(document.body.textContent).toContain('Unable to load application resources.'))
    expect(document.body.textContent).not.toContain('app mounted')

    const retry = document.querySelector('button')
    if (!retry) throw new Error('retry button missing')
    await user.click(retry)

    await waitFor(() => {
      expect(hydrateI18n).toHaveBeenCalledTimes(2)
      expect(document.body.textContent).toContain('app mounted')
    })
  })

  test('aborts hydration and shows retry after the boot timeout', async () => {
    useFakeTimers()
    hydrateI18n.mockImplementation(({ signal }: { signal: AbortSignal }) => {
      return new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })

    await loadMain()

    expect(document.body.textContent).toContain('Loading')
    expect(hydrateI18n.mock.calls[0]?.[0].signal.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(15_000)

    expect(hydrateI18n.mock.calls[0]?.[0].signal.aborted).toBe(true)
    expect(document.body.textContent).toContain('Unable to load application resources.')
    expect(document.body.textContent).not.toContain('app mounted')
  })

  test('retries when host info hydration fails', async () => {
    const user = userEvent.setup()
    hydrateHostInfo.mockRejectedValueOnce(new Error('host unavailable')).mockResolvedValueOnce(undefined)

    await loadMain()

    await waitFor(() => expect(document.body.textContent).toContain('Unable to load application resources.'))
    expect(document.body.textContent).not.toContain('app mounted')

    const retry = document.querySelector('button')
    if (!retry) throw new Error('retry button missing')
    await user.click(retry)

    await waitFor(() => {
      expect(hydrateHostInfo).toHaveBeenCalledTimes(2)
      expect(document.body.textContent).toContain('app mounted')
    })
  })
})
