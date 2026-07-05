// React error boundary for the current repo body. Without this, a render
// crash inside any repo workspace view (BranchNavigator / StatusList / commit
// detail) would unmount the whole shell and show a blank window.
//
// We re-mount on `resetKey` change — App.tsx passes the current repo id
// as the key, so navigating to a different repo clears any prior crash
// without the user having to restart the app.

import type { ErrorInfo, ReactNode } from 'react'
import { ErrorBoundary as ReactErrorBoundary, getErrorMessage, type FallbackProps } from 'react-error-boundary'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { gblLog } from '#/web/logger.ts'
import { markReactRenderErrorLogged } from '#/web/react-error-logging.ts'

interface Props {
  /** When this prop changes (e.g. route identity), state is reset. */
  resetKey?: string | null
  children: ReactNode
}

function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const t = useT()
  const message = getErrorMessage(error) ?? t('error.render-crash-unknown')

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-md space-y-3 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-danger-surface text-danger">
          <AlertTriangle size={22} />
        </div>
        <div className="space-y-1">
          <div className="text-sm font-semibold text-foreground">{t('error.render-crash-title')}</div>
          <div className="text-xs leading-relaxed text-muted-foreground">{message}</div>
        </div>
        <Button type="button" variant="outline" onClick={resetErrorBoundary} className="h-8 px-3">
          <RefreshCw className="size-3" />
          {t('error.try-again')}
        </Button>
      </div>
    </div>
  )
}

function logRenderError(error: unknown, info: ErrorInfo): void {
  if (markReactRenderErrorLogged(error)) return
  // Log to console — packaged builds don't ship a remote error sink, so
  // the next-best signal is the local devtools.
  gblLog.error('render crash', { error, componentStack: info.componentStack })
}

export function ErrorBoundary({ resetKey, children }: Props): ReactNode {
  return (
    <ReactErrorBoundary FallbackComponent={ErrorFallback} onError={logRenderError} resetKeys={[resetKey]}>
      {children}
    </ReactErrorBoundary>
  )
}
