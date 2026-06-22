import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { Loader2 } from 'lucide-react'
import { AuthProvider } from '#/web/auth/AuthProvider.tsx'
import { ResponsiveUiProvider } from '#/web/hooks/useResponsiveUiMode.tsx'
import { MainWindowRouterProvider } from '#/web/main-router.tsx'
import { mainWindowQueryClient } from '#/web/main-window-queries.ts'
import { bootstrapLog } from '#/web/logger.ts'
import { useI18nStore } from '#/web/stores/i18n.ts'

const INITIAL_I18N_HYDRATE_TIMEOUT_MS = 15_000

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('root element missing')

const root = createRoot(rootEl)

void boot()

async function boot(): Promise<void> {
  root.render(<BootLoading />)
  const timeout = createTimeoutController(INITIAL_I18N_HYDRATE_TIMEOUT_MS)
  try {
    await useI18nStore.getState().hydrate({ subscribe: false, signal: timeout.signal })
  } catch (err) {
    bootstrapLog.warn('initial i18n hydrate failed', { err })
    root.render(<BootError onRetry={() => void boot()} />)
    return
  } finally {
    timeout.dispose()
  }
  root.render(<AppRoot />)
}

function createTimeoutController(ms: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const id = window.setTimeout(() => {
    controller.abort(new Error(`initial i18n hydrate timed out after ${ms}ms`))
  }, ms)
  return {
    signal: controller.signal,
    dispose: () => window.clearTimeout(id),
  }
}

function AppRoot() {
  return (
    <StrictMode>
      <QueryClientProvider client={mainWindowQueryClient}>
        <ResponsiveUiProvider>
          <AuthProvider>
            <MainWindowRouterProvider />
          </AuthProvider>
        </ResponsiveUiProvider>
        {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />}
      </QueryClientProvider>
    </StrictMode>
  )
}

function BootLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex h-full items-center justify-center bg-background text-muted-foreground"
    >
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span className="sr-only">Loading</span>
    </div>
  )
}

function BootError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-full items-center justify-center bg-background p-4 text-foreground">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <div className="text-sm font-medium">Unable to load language resources.</div>
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
