import { defineComponent } from 'vue'
import { toast } from 'vue-sonner'
import { DialogStatusRow } from '#/web/components/ui/dialog-status-row.tsx'
import { failedDiagnosticsCategory } from '#/web/lib/remote-diagnostics.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import type { RemoteDiagnosticCategory, RemoteDiagnosticsResult } from '#/shared/remote-workspace.ts'
import { copyToClipboard } from '#/web/clipboard/clipboard-copy.ts'

interface Props {
  diagnostics: RemoteDiagnosticsResult | null
  error: string | null
  loading: boolean
  idleText: string
}

export const RemoteDiagnosticsPanel = defineComponent<Props>({
  name: 'RemoteDiagnosticsPanel',
  props: ['diagnostics', 'error', 'loading', 'idleText'],
  setup(props) {
    const t = useT()

    async function copyText(value: string): Promise<void> {
      try {
        await copyToClipboard(value)
        toast.success(t('branch-status.copied'))
      } catch (error) {
        toast.error(t('action.result-error'), {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return () => {
      const failedCategory = failedDiagnosticsCategory(props.diagnostics)
      const statusText = props.loading
        ? t('workspace-picker.open-remote-diagnostics-testing')
        : props.diagnostics
          ? props.diagnostics.ok
            ? t('workspace-picker.open-remote-diagnostics-ok')
            : diagnosticCategoryLabel(
                t,
                failedCategory ?? props.diagnostics.category ?? props.diagnostics.message ?? 'unknown',
              )
          : (props.error ?? props.idleText)
      const copyDetailsValue = props.diagnostics?.details ?? props.error ?? null

      return (
        <div data-slot="remote-diagnostics-status">
          <DialogStatusRow
            message={statusText}
            tone={
              props.error || (props.diagnostics && !props.diagnostics.ok)
                ? 'danger'
                : props.diagnostics?.ok
                  ? 'success'
                  : 'default'
            }
            actionLabel={copyDetailsValue ? t('workspace-picker.open-remote-diagnostics-copy-details') : undefined}
            onAction={copyDetailsValue ? () => void copyText(copyDetailsValue) : undefined}
          />
        </div>
      )
    }
  },
})

function diagnosticCategoryLabel(t: (key: string) => string, category: string): string {
  const known = category as RemoteDiagnosticCategory
  const diagnosticKey = `workspace-picker.open-remote-diagnostics-category-${known}`
  const translated = t(diagnosticKey)
  return translated === diagnosticKey ? category : translated
}
