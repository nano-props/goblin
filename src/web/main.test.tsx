// @vitest-environment jsdom
import { userEvent } from '@testing-library/user-event'
import { defineComponent, onMounted, onUnmounted } from 'vue'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { waitFor } from '@testing-library/vue'
import { useFakeTimers } from '#/test-utils/timers.ts'
import { currentNativeBridge } from '#/web/test-utils/current-native-bridge.ts'

let hydrateI18n: ReturnType<typeof vi.fn>
let hydrateHostInfo: ReturnType<typeof vi.fn>
let appMount: ReturnType<typeof vi.fn>
let appUnmount: ReturnType<typeof vi.fn>
let showBootstrapLoading: (() => void) | null
let hideBootstrapLoading: (() => void) | null
let routerRenderError: Error | null
let renderTestDialog: boolean
let disposeWebApp: (() => void) | null

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  document.body.innerHTML = '<div id="root"></div>'
  hydrateI18n = vi.fn().mockResolvedValue(undefined)
  hydrateHostInfo = vi.fn().mockResolvedValue(undefined)
  appMount = vi.fn()
  appUnmount = vi.fn()
  showBootstrapLoading = null
  hideBootstrapLoading = null
  routerRenderError = null
  renderTestDialog = false
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
    useT: () => (key: string) => key,
  }))
  vi.doMock('#/web/logger.ts', () => ({
    bootstrapLog: { error: vi.fn(), warn: vi.fn() },
    goblinLog: { error: vi.fn() },
  }))
  vi.doMock('#/web/app/navigation/router.tsx', async () => {
    const { useBootstrapLoadingPresentation } = await import('#/web/app/bootstrap/bootstrap-loading-presentation.ts')
    const { DialogDescription, DialogRoot, DialogTitle } = await import('reka-ui')
    const { DialogContent } = await import('#/web/components/ui/dialog.tsx')
    return {
      appRouter: { install: vi.fn() },
      AppRouterProvider: defineComponent({
        name: 'TestAppRouterProvider',
        setup() {
          const bootstrapLoading = useBootstrapLoadingPresentation()
          showBootstrapLoading = bootstrapLoading.show
          hideBootstrapLoading = bootstrapLoading.hide
          onMounted(appMount)
          onUnmounted(appUnmount)
          return () => {
            if (routerRenderError) throw routerRenderError
            return (
              <>
                <div>app mounted</div>
                {renderTestDialog ? (
                  <DialogRoot open>
                    <DialogContent>
                      <DialogTitle>Layer test dialog</DialogTitle>
                      <DialogDescription>Verifies the application overlay stacking contract.</DialogDescription>
                    </DialogContent>
                  </DialogRoot>
                ) : null}
              </>
            )
          }
        },
      }),
    }
  })
})

afterEach(() => {
  disposeWebApp?.()
  delete (window as Partial<Window>).goblinNative
  document.body.innerHTML = ''
})

async function loadMain(): Promise<void> {
  const main = await import('#/web/main.tsx')
  disposeWebApp = main.disposeWebApp
}

describe('client entrypoint', () => {
  test('registers native quit lifecycle before public bootstrap finishes', async () => {
    const hydration = Promise.withResolvers<void>()
    hydrateI18n.mockReturnValue(hydration.promise)
    let nativeQuit: (() => void) | undefined
    const notifyAppQuitDrained = vi.fn(async () => true)
    Object.defineProperty(window, 'goblinNative', {
      configurable: true,
      value: currentNativeBridge({
        notifyAppQuitDrained,
        onAppQuitting(listener) {
          nativeQuit = listener
          return () => {}
        },
      }),
    })

    await loadMain()
    nativeQuit?.()

    await waitFor(() => expect(notifyAppQuitDrained).toHaveBeenCalledWith({ ok: true }))
    expect(document.body.textContent).toContain('Loading')
    hydration.resolve()
  })

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

  test('keeps one loading status mounted until the app accepts the initial presentation', async () => {
    const hydration = Promise.withResolvers<void>()
    hydrateI18n.mockReturnValue(hydration.promise)

    await loadMain()

    const initialStatus = document.querySelector('[role="status"]')
    const initialSpinner = initialStatus?.querySelector('svg')
    expect(initialStatus).not.toBeNull()
    expect(initialSpinner).not.toBeNull()
    expect(initialStatus?.parentElement?.className).toContain('z-40')

    hydration.resolve()
    await hydration.promise
    await waitFor(() => expect(document.body.textContent).toContain('app mounted'))

    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(document.querySelector('[role="status"]')).toBe(initialStatus)
    expect(document.querySelector('[role="status"] svg')).toBe(initialSpinner)

    hideBootstrapLoading?.()
    await waitFor(() => expect(document.querySelector('[role="status"]')).toBeNull())
  })

  test('keeps a re-shown loading node mounted across repeated show requests', async () => {
    await loadMain()
    await waitFor(() => expect(document.body.textContent).toContain('app mounted'))

    const initialStatus = document.querySelector('[role="status"]')
    hideBootstrapLoading?.()
    await waitFor(() => expect(document.querySelector('[role="status"]')).toBeNull())

    showBootstrapLoading?.()
    await waitFor(() => expect(document.querySelector('[role="status"]')).not.toBeNull())
    const reenteredStatus = document.querySelector('[role="status"]')

    showBootstrapLoading?.()
    expect(document.querySelector('[role="status"]')).toBe(reenteredStatus)
    expect(reenteredStatus).not.toBe(initialStatus)
  })

  test('renders dialogs above an active bootstrap loading layer in the same document', async () => {
    renderTestDialog = true

    await loadMain()

    await waitFor(() => expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeNull())
    expect(document.querySelector('[role="status"]')?.parentElement?.className).toContain('z-40')
    expect(document.querySelector('[data-slot="dialog-overlay"]')?.className).toContain('z-50')
    expect(document.querySelector('[data-slot="dialog-content"]')?.className).toContain('z-50')
  })

  test('lets the root error boundary replace an active loading overlay', async () => {
    routerRenderError = new Error('router render failed')

    await loadMain()

    await waitFor(() => expect(document.body.textContent).toContain('router render failed'))
    expect(document.querySelector('[role="status"]')).toBeNull()
  })

  test('removes an active bootstrap loading presentation when the app unmounts', async () => {
    const hydration = Promise.withResolvers<void>()
    hydrateI18n.mockReturnValue(hydration.promise)

    await loadMain()

    expect(document.querySelector('[role="status"]')).not.toBeNull()
    disposeWebApp?.()
    disposeWebApp = null
    expect(document.getElementById('root')?.childElementCount).toBe(0)

    hydration.resolve()
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
