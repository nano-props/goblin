import { createApp, defineComponent, shallowRef } from 'vue'
import type { FunctionalComponent } from 'vue'
import { VueQueryPlugin } from '@tanstack/vue-query'
import { VueQueryDevtools } from '@tanstack/vue-query-devtools'
import { AppRouterProvider, appRouter } from '#/web/app-router.tsx'
import { appQueryClient } from '#/web/app-query-client.ts'
import { AuthProvider } from '#/web/auth/AuthProvider.tsx'
import { ResponsiveUiProvider } from '#/web/hooks/useResponsiveUiMode.tsx'
import { bootstrapLog } from '#/web/logger.ts'
import { i18nStore } from '#/web/stores/i18n.ts'
import { appI18n, startI18nProjection } from '#/web/stores/i18n-vue.ts'
import { hostInfoStore } from '#/web/stores/host-info.ts'
import { createWebBootstrapOwner, startWebBootstrap } from '#/web/web-bootstrap.ts'
import { CenteredLoadingStatus } from '#/web/components/CenteredLoadingStatus.tsx'
import { vueAppErrorHandler } from '#/web/vue-app-error-handler.ts'
import { startNativeAppQuitIngress } from '#/web/app-lifecycle.ts'

const INITIAL_PUBLIC_BOOTSTRAP_TIMEOUT_MS = 15_000

type BootstrapPhase = { kind: 'loading' } | { kind: 'error'; retry: () => void } | { kind: 'ready' }

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('root element missing')
const stopNativeAppQuitIngress = startNativeAppQuitIngress()

interface MainHotData {
  nextBootstrapGeneration?: number
}

const hotData: MainHotData = import.meta.hot?.data ?? {}
const bootstrapOwner = createWebBootstrapOwner(hotData.nextBootstrapGeneration ?? 1)
const phase = shallowRef<BootstrapPhase>({ kind: 'loading' })
const Root = defineComponent({
  name: 'Root',
  setup() {
    return () => {
      if (phase.value.kind === 'loading') return <BootLoading />
      if (phase.value.kind === 'error') return <BootError onRetry={phase.value.retry} />
      return (
        <>
          <ResponsiveUiProvider>
            <AuthProvider>
              <AppRouterProvider />
            </AuthProvider>
          </ResponsiveUiProvider>
          {import.meta.env.DEV ? <VueQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" /> : null}
        </>
      )
    }
  },
})
const app = createApp(Root)
const errorHandler = vueAppErrorHandler()
if (errorHandler) app.config.errorHandler = errorHandler
app.use(appRouter)
app.use(VueQueryPlugin, { queryClient: appQueryClient })
app.use(appI18n)
const stopI18nProjection = startI18nProjection()
app.mount(rootElement)

import.meta.hot?.dispose((data: MainHotData) => {
  data.nextBootstrapGeneration = bootstrapOwner.generation + 1
  disposeWebApp()
})

startWebBootstrap({
  owner: bootstrapOwner,
  timeoutMs: INITIAL_PUBLIC_BOOTSTRAP_TIMEOUT_MS,
  hydrate: async (signal) => {
    await Promise.all([
      i18nStore.getState().hydrate({ subscribe: false, signal }),
      hostInfoStore.getState().hydrate({ signal }),
    ])
  },
  renderLoading: () => {
    phase.value = { kind: 'loading' }
  },
  renderError: (retry) => {
    phase.value = { kind: 'error', retry }
  },
  renderApp: () => {
    phase.value = { kind: 'ready' }
  },
  logFailure: (error) => bootstrapLog.warn('initial public bootstrap failed', { error }),
})

function BootLoading() {
  return <CenteredLoadingStatus label="Loading" />
}

const BootError: FunctionalComponent<{ onRetry: () => void }> = ({ onRetry }) => {
  return (
    <div class="flex h-full items-center justify-center bg-background p-4 text-foreground">
      <div class="flex max-w-sm flex-col items-center gap-3 text-center">
        <div class="text-sm font-medium">Unable to load application resources.</div>
        <button
          type="button"
          onClick={onRetry}
          class="rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
        >
          Retry
        </button>
      </div>
    </div>
  )
}
BootError.props = ['onRetry']
BootError.inheritAttrs = false

let disposed = false

export function disposeWebApp(): void {
  if (disposed) return
  disposed = true
  bootstrapOwner.dispose()
  stopNativeAppQuitIngress()
  stopI18nProjection()
  app.unmount()
}
