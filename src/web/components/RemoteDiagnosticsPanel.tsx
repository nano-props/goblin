import { toast } from 'sonner'
import { Button } from '#/web/components/ui/button.tsx'
import { Panel, PanelBody, PanelHeader, PanelInset } from '#/web/components/ui/panel.tsx'
import { useMainWindowNavigation } from '#/web/main-window-navigation.tsx'
import { failedDiagnosticsCategory, remoteSshCommand, shouldOfferSshSettings } from '#/web/lib/remote-support.ts'
import { useT } from '#/web/stores/i18n.ts'
import type {
  RemoteDiagnosticCategory,
  RemoteDiagnosticStageName,
  RemoteDiagnosticsResult,
} from '#/shared/remote-repo.ts'
interface Props {
  diagnostics: RemoteDiagnosticsResult | null
  loading: boolean
  onRetry: () => void
}

export function RemoteDiagnosticsPanel({ diagnostics, loading, onRetry }: Props) {
  const t = useT()
  const navigation = useMainWindowNavigation()
  if (!diagnostics && !loading) return null
  const summaryTarget = diagnostics?.target
  const failedCategory = failedDiagnosticsCategory(diagnostics)
  const canOpenSshSettings = shouldOfferSshSettings(failedCategory)

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(t('branch-status.copied'))
    } catch (err) {
      toast.error(t('action.result-error'), {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return (
    <Panel className="rounded-lg">
      <PanelHeader>
        <div className="text-xs font-medium">{t('repo-tabs.open-remote-diagnostics-title')}</div>
      </PanelHeader>
      <PanelBody className="space-y-2">
        {summaryTarget && (
          <PanelInset tone="muted" size="sm" className="text-[11px] text-muted-foreground">
            <div className="font-medium text-foreground">{summaryTarget.alias}</div>
            <div className="mt-0.5">
              {t('repo-tabs.open-remote-host-label')}: {summaryTarget.host} ·{' '}
              {t('repo-tabs.open-remote-username-label')}: {summaryTarget.user} ·{' '}
              {t('repo-tabs.open-remote-port-label')}: {summaryTarget.port}
            </div>
          </PanelInset>
        )}
        {diagnostics?.stages.map((stage) => (
          <PanelInset key={stage.name} size="sm">
            <div className="flex items-center gap-2">
              <StageIcon status={stage.status} />
              <span className="text-xs">{stageLabel(t, stage.name)}</span>
              {stage.status === 'failed' && (stage.category || stage.message) && (
                <span className="text-xs text-destructive">
                  {diagnosticCategoryLabel(t, stage.category ?? stage.message ?? '')}
                </span>
              )}
            </div>
            {stage.details && (
              <div className="mt-1 whitespace-pre-wrap break-words pl-4 font-mono text-[11px] text-muted-foreground">
                {stage.details}
              </div>
            )}
          </PanelInset>
        ))}
        {diagnostics?.details && !diagnostics.ok && (
          <PanelInset
            tone="muted"
            size="sm"
            className="whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground"
          >
            {diagnostics.details}
          </PanelInset>
        )}
        {diagnostics && !diagnostics.ok && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" size="sm" variant="outline" onClick={onRetry}>
              {t('repo-tabs.open-remote-diagnostics-retry')}
            </Button>
            {canOpenSshSettings && (
              <Button type="button" size="sm" variant="outline" onClick={() => navigation.openSettings('ssh')}>
                {t('repo-tabs.open-remote-open-ssh-settings')}
              </Button>
            )}
            {summaryTarget && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void copyText(remoteSshCommand(summaryTarget))}
              >
                {t('repo-tabs.open-remote-diagnostics-copy-ssh-command')}
              </Button>
            )}
            {diagnostics.details && (
              <Button type="button" size="sm" variant="ghost" onClick={() => void copyText(diagnostics.details ?? '')}>
                {t('repo-tabs.open-remote-diagnostics-copy-details')}
              </Button>
            )}
          </div>
        )}
        {loading && (
          <div className="px-0.5 py-1 text-xs text-muted-foreground">
            {t('repo-tabs.open-remote-diagnostics-testing')}
          </div>
        )}
      </PanelBody>
    </Panel>
  )
}

function stageLabel(t: (key: string) => string, stage: RemoteDiagnosticStageName): string {
  return t(`repo-tabs.open-remote-diagnostics-stage-${stage}`)
}

function diagnosticCategoryLabel(t: (key: string) => string, category: string): string {
  const known = category as RemoteDiagnosticCategory
  const key = `repo-tabs.open-remote-diagnostics-category-${known}`
  const translated = t(key)
  return translated === key ? category : translated
}

function StageIcon({ status }: { status: string }) {
  if (status === 'passed') return <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
  if (status === 'failed') return <span className="inline-block h-2 w-2 rounded-full bg-destructive" />
  if (status === 'running') return <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse" />
  if (status === 'skipped') return <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground" />
  return <span className="inline-block h-2 w-2 rounded-full bg-muted" />
}
