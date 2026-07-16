import { AlertCircle, RefreshCw } from 'lucide-react'
import { EmptyState } from '#/web/components/Layout.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { useT } from '#/web/stores/i18n.ts'

export function RepoStatusFailureView({
  message,
  retrying,
  onRetry,
}: {
  message: string
  retrying: boolean
  onRetry: () => void
}) {
  const t = useT()
  return (
    <EmptyState
      icon={<AlertCircle size={18} />}
      title={t('error.failed-read-repo')}
      body={
        <div className="space-y-3">
          <div className="break-words">{t(message)}</div>
          <Button type="button" variant="default" disabled={retrying} onClick={onRetry}>
            <RefreshCw className={retrying ? 'animate-spin' : undefined} />
            {t('error.try-again')}
          </Button>
        </div>
      }
    />
  )
}

export function RepoStatusStaleNotice({
  message,
  retrying = false,
  onRetry,
}: {
  message: string
  retrying?: boolean
  onRetry?: () => void
}) {
  const t = useT()
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 border-b border-warning-border bg-warning-surface px-4 py-2 text-xs text-warning"
    >
      <div className="min-w-0">
        <span className="font-medium">{t('status.stale-title')}</span>
        <span className="break-words text-muted-foreground">
          {' \u2014 '}
          {t(message)}
        </span>
      </div>
      {onRetry && (
        <Button type="button" size="sm" variant="ghost" disabled={retrying} onClick={onRetry}>
          <RefreshCw className={retrying ? 'animate-spin' : undefined} />
          {t('error.try-again')}
        </Button>
      )}
    </div>
  )
}
