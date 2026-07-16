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
