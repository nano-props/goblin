import { toast } from 'vue-sonner'
import type { WorkspacePaneActionOutcome } from '#/web/workspace-pane/workspace-pane-action-outcome.ts'
import { translate } from '#/web/stores/i18n-vue.ts'

export function surfaceWorkspacePaneTerminalDestinationOutcome(
  outcome: WorkspacePaneActionOutcome | null,
  error?: unknown,
): void {
  if (
    outcome?.kind === 'completed' ||
    outcome?.kind === 'already-current' ||
    outcome?.kind === 'superseded'
  ) {
    return
  }
  const message = translate('dashboard.terminals.open-failed')
  if (error === undefined) toast.error(message)
  else toast.error(message, { description: error instanceof Error ? error.message : String(error) })
}
