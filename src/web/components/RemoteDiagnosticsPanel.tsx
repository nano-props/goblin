import { toast } from 'sonner'
import { DialogStatusRow } from '#/web/components/ui/dialog-status-row.tsx'
import { failedDiagnosticsCategory } from '#/web/lib/remote-support.ts'
import { useT } from '#/web/stores/i18n.ts'
import type { RemoteDiagnosticCategory, RemoteDiagnosticsResult } from '#/shared/remote-repo.ts'

interface Props {
  diagnostics: RemoteDiagnosticsResult | null
  error: string | null
  loading: boolean
  idleText: string
}

export function RemoteDiagnosticsPanel({ diagnostics, error, loading, idleText }: Props) {
  const t = useT()
  const failedCategory = failedDiagnosticsCategory(diagnostics)

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

  const statusText = loading
    ? t('repo-tabs.open-remote-diagnostics-testing')
    : diagnostics
      ? diagnostics.ok
        ? t('repo-tabs.open-remote-diagnostics-ok')
        : diagnosticCategoryLabel(t, failedCategory ?? diagnostics.category ?? diagnostics.message ?? 'unknown')
      : error
        ? error
        : idleText
  const copyDetailsValue = diagnostics?.details ?? error ?? null

  return (
    <div data-slot="remote-diagnostics-status">
      <DialogStatusRow
        message={statusText}
        tone={error || (diagnostics && !diagnostics.ok) ? 'danger' : diagnostics?.ok ? 'success' : 'default'}
        actionLabel={copyDetailsValue ? t('repo-tabs.open-remote-diagnostics-copy-details') : undefined}
        onAction={copyDetailsValue ? () => void copyText(copyDetailsValue) : undefined}
      />
    </div>
  )
}

function diagnosticCategoryLabel(t: (key: string) => string, category: string): string {
  const known = category as RemoteDiagnosticCategory
  const key = `repo-tabs.open-remote-diagnostics-category-${known}`
  const translated = t(key)
  return translated === key ? category : translated
}
