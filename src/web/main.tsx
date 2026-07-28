import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
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

const INITIAL_PUBLIC_BOOTSTRAP_TIMEOUT_MS = 15_000

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('root element missing')

const root = createRoot(rootEl, reactRootOptions())

void boot()

async function boot(): Promise<void> {
  root.render(<BootLoading />)
  const timeout = createTimeoutController(INITIAL_PUBLIC_BOOTSTRAP_TIMEOUT_MS)
  try {
    await Promise.all([
      useI18nStore.getState().hydrate({ subscribe: false, signal: timeout.signal }),
      useHostInfoStore.getState().hydrate({ signal: timeout.signal }),
    ])
  } catch (err) {
    timeout.abort(err)
    bootstrapLog.warn('initial public bootstrap failed', { err })
    root.render(<BootError onRetry={() => void boot()} />)
    return
  } finally {
    timeout.dispose()
  }
  root.render(
    <StrictMode>
      <AppRoot />
    </StrictMode>,
  )
}

function createTimeoutController(ms: number): {
  signal: AbortSignal
  abort: (reason: unknown) => void
  dispose: () => void
} {
  const controller = new AbortController()
  const id = window.setTimeout(() => {
    controller.abort(new Error(`initial public bootstrap timed out after ${ms}ms`))
  }, ms)
  return {
    signal: controller.signal,
    abort: (reason) => controller.abort(reason),
    dispose: () => window.clearTimeout(id),
  }
}

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
