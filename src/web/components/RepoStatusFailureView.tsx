import { AlertCircle, RefreshCw } from 'lucide-react'
import { REPO_MEMBERSHIP_READ_CONFLICT_KEY } from '#/shared/repo-membership-read.ts'
import { EmptyState } from '#/web/components/Layout.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { useT } from '#/web/stores/i18n.ts'

export function RepoStatusFailureView({
  messageKey,
  retrying,
  onRetry,
}: {
  messageKey: string
  retrying: boolean
  onRetry: () => void
}) {
  const t = useT()
  if (messageKey === REPO_MEMBERSHIP_READ_CONFLICT_KEY) {
    return <RepoMembershipChangingView retrying={retrying} onRetry={onRetry} />
  }
  const showDetail = messageKey !== 'error.failed-read-repo'
  return (
    <div role="alert" className="flex min-h-0 flex-1">
      <EmptyState
        icon={<AlertCircle size={18} />}
        title={t('error.failed-read-repo')}
        body={
          <div className="space-y-3">
            {showDetail && <div className="break-words">{t(messageKey)}</div>}
            <Button type="button" variant="default" disabled={retrying} onClick={onRetry}>
              <RefreshCw className={retrying ? 'animate-spin' : undefined} />
              {t('error.try-again')}
            </Button>
          </div>
        }
      />
    </div>
  )
}

export function RepoStatusStaleNotice({
  messageKey,
  retrying = false,
  onRetry,
}: {
  messageKey: string
  retrying?: boolean
  onRetry?: () => void
}) {
  const t = useT()
  if (messageKey === REPO_MEMBERSHIP_READ_CONFLICT_KEY) {
    return <RepoMembershipChangingNotice retrying={retrying} onRetry={onRetry} />
  }
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 border-b border-warning-border bg-warning-surface px-4 py-2 text-xs text-warning"
    >
      <div className="min-w-0">
        <span className="font-medium">{t('status.stale-title')}</span>
        <span className="break-words text-muted-foreground">
          {' \u2014 '}
          {t(messageKey)}
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

export function RepoReadFailureNotice({
  messageKey,
  retrying = false,
  onRetry,
}: {
  messageKey: string
  retrying?: boolean
  onRetry?: () => void
}) {
  const t = useT()
  if (messageKey === REPO_MEMBERSHIP_READ_CONFLICT_KEY) {
    return <RepoMembershipChangingNotice retrying={retrying} onRetry={onRetry} />
  }
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive"
    >
      <span className="min-w-0 break-words">{t(messageKey)}</span>
      {onRetry && (
        <Button type="button" size="sm" variant="ghost" disabled={retrying} onClick={onRetry}>
          <RefreshCw className={retrying ? 'animate-spin' : undefined} />
          {t('error.try-again')}
        </Button>
      )}
    </div>
  )
}

function RepoMembershipChangingView({ retrying, onRetry }: { retrying: boolean; onRetry: () => void }) {
  const t = useT()
  return (
    <div role="status" className="flex min-h-0 flex-1">
      <EmptyState
        icon={<RefreshCw size={18} />}
        title={t(REPO_MEMBERSHIP_READ_CONFLICT_KEY)}
        body={
          <Button type="button" variant="default" disabled={retrying} onClick={onRetry}>
            <RefreshCw className={retrying ? 'animate-spin' : undefined} />
            {t('error.try-again')}
          </Button>
        }
      />
    </div>
  )
}

function RepoMembershipChangingNotice({ retrying, onRetry }: { retrying?: boolean; onRetry?: () => void }) {
  const t = useT()
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground"
    >
      <span className="min-w-0 break-words">{t(REPO_MEMBERSHIP_READ_CONFLICT_KEY)}</span>
      {onRetry && (
        <Button type="button" size="sm" variant="ghost" disabled={retrying} onClick={onRetry}>
          <RefreshCw className={retrying ? 'animate-spin' : undefined} />
          {t('error.try-again')}
        </Button>
      )}
    </div>
  )
}
