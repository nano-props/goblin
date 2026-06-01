import { useT } from '#/renderer/stores/i18n.ts'
import type { RemoteDiagnosticsResult } from '#/shared/remote-repo.ts'

interface Props {
  diagnostics: RemoteDiagnosticsResult | null
  loading: boolean
  onRetry: () => void
}

export function RemoteDiagnosticsPanel({ diagnostics, loading, onRetry }: Props) {
  const t = useT()
  if (!diagnostics && !loading) return null

  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="text-xs font-medium">{t('repo-tabs.open-remote-diagnostics-title')}</div>
        {diagnostics && !diagnostics.ok && (
          <button type="button" className="text-xs text-primary hover:underline" onClick={onRetry}>
            {t('repo-tabs.open-remote-diagnostics-retry')}
          </button>
        )}
      </div>
      <div className="px-3 py-2">
        {diagnostics?.stages.map((stage) => (
          <div key={stage.name} className="flex items-center gap-2 py-0.5">
            <StageIcon status={stage.status} />
            <span className="text-xs">{stage.label}</span>
            {stage.status === 'failed' && stage.message && (
              <span className="text-xs text-destructive">{stage.message}</span>
            )}
          </div>
        ))}
        {loading && <div className="py-1 text-xs text-muted-foreground">{t('repo-tabs.open-remote-diagnostics-testing')}</div>}
      </div>
    </div>
  )
}

function StageIcon({ status }: { status: string }) {
  if (status === 'passed')
    return <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
  if (status === 'failed')
    return <span className="inline-block h-2 w-2 rounded-full bg-destructive" />
  if (status === 'running')
    return <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse" />
  if (status === 'skipped')
    return <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground" />
  return <span className="inline-block h-2 w-2 rounded-full bg-muted" />
}
