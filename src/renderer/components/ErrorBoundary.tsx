// React error boundary for the active-repo body. Without this, a render
// crash inside any tab (BranchList / LogList / StatusList / commit
// detail) would unmount the whole shell and show a blank window.
//
// We re-mount on `resetKey` change — App.tsx passes the active repoId
// as the key, so navigating to a different repo clears any prior crash
// without the user having to restart the app.

import type { ErrorInfo, ReactNode } from 'react'
import { ErrorBoundary as ReactErrorBoundary, getErrorMessage, type FallbackProps } from 'react-error-boundary'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useT } from '#/renderer/stores/i18n.ts'

interface Props {
  /** When this prop changes (e.g. activeRepoId), state is reset. */
  resetKey?: string | null
  children: ReactNode
}

function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const t = useT()
  const message = getErrorMessage(error) ?? t('error.render-crash-unknown')

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger-surface text-danger">
          <AlertTriangle size={22} />
        </div>
        <div className="text-sm font-semibold text-foreground mb-1">{t('error.render-crash-title')}</div>
        <div className="text-xs text-muted-foreground mb-4 leading-relaxed">{message}</div>
        <button
          type="button"
          onClick={resetErrorBoundary}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs text-foreground cursor-pointer hover:text-foreground hover:bg-muted shadow-sm transition-colors duration-100"
        >
          <RefreshCw size={12} />
          {t('error.try-again')}
        </button>
      </div>
    </div>
  )
}

function logRenderError(error: unknown, info: ErrorInfo): void {
  // Log to console — packaged builds don't ship a remote error sink, so
  // the next-best signal is the local devtools.
  console.error('[gbl] render crash', error, info.componentStack)
}

export function ErrorBoundary({ resetKey, children }: Props): ReactNode {
  return (
    <ReactErrorBoundary FallbackComponent={ErrorFallback} onError={logRenderError} resetKeys={[resetKey]}>
      {children}
    </ReactErrorBoundary>
  )
}
