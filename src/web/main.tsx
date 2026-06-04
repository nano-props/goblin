import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { ResponsiveUiProvider } from '#/web/hooks/useResponsiveUiMode.tsx'
import { MainWindowRouterProvider } from '#/web/main-router.tsx'
import { mainWindowQueryClient } from '#/web/main-window-queries.ts'
const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('root element missing')
createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={mainWindowQueryClient}>
      <ResponsiveUiProvider>
        <MainWindowRouterProvider />
      </ResponsiveUiProvider>
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />}
    </QueryClientProvider>
  </StrictMode>,
)
