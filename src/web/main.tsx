import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { AuthProvider } from '#/web/auth/AuthProvider.tsx'
import { CenteredLoadingStatus } from '#/web/components/CenteredLoadingStatus.tsx'
import { ResponsiveUiProvider } from '#/web/hooks/useResponsiveUiMode.tsx'
import { AppRouterProvider } from '#/web/app-router.tsx'
import { appQueryClient } from '#/web/app-query-client.ts'
import { bootstrapLog } from '#/web/logger.ts'
import { reactRootOptions } from '#/web/react-root-options.ts'
import { useI18nStore } from '#/web/stores/i18n.ts'
import { useHostInfoStore } from '#/web/stores/host-info.ts'
import { createWebBootstrapOwner, startWebBootstrap } from '#/web/web-bootstrap.ts'

const INITIAL_PUBLIC_BOOTSTRAP_TIMEOUT_MS = 15_000

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('root element missing')

interface MainHotData {
  root?: Root
  nextBootstrapGeneration?: number
}

const hotData: MainHotData = import.meta.hot?.data ?? {}
const root = hotData.root ?? createRoot(rootEl, reactRootOptions())
const bootstrapOwner = createWebBootstrapOwner(hotData.nextBootstrapGeneration ?? 1)
import.meta.hot?.dispose((data: MainHotData) => {
  data.root = root
  data.nextBootstrapGeneration = bootstrapOwner.generation + 1
  bootstrapOwner.dispose()
})

startWebBootstrap({
  owner: bootstrapOwner,
  timeoutMs: INITIAL_PUBLIC_BOOTSTRAP_TIMEOUT_MS,
  hydrate: async (signal) => {
    await Promise.all([
      useI18nStore.getState().hydrate({ subscribe: false, signal }),
      useHostInfoStore.getState().hydrate({ signal }),
    ])
  },
  renderLoading: () => root.render(<BootLoading />),
  renderError: (retry) => root.render(<BootError onRetry={retry} />),
  renderApp: () =>
    root.render(
      <StrictMode>
        <AppRoot />
      </StrictMode>,
    ),
  logFailure: (err) => bootstrapLog.warn('initial public bootstrap failed', { err }),
})

function AppRoot() {
  return (
    <QueryClientProvider client={appQueryClient}>
      <ResponsiveUiProvider>
        <AuthProvider>
          <AppRouterProvider />
        </AuthProvider>
      </ResponsiveUiProvider>
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />}
    </QueryClientProvider>
  )
}

function BootLoading() {
  return <CenteredLoadingStatus label="Loading" />
}

function BootError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-full items-center justify-center bg-background p-4 text-foreground">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <div className="text-sm font-medium">Unable to load application resources.</div>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
        >
          Retry
        </button>
      </div>
    </div>
  )
}
