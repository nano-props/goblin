import { toast } from 'vue-sonner'
import { translate } from '#/web/stores/i18n-vue.ts'
import type { WorkspacePaneTabTargetUnavailableReason } from '#/web/workspace-pane/workspace-pane-tab-target.ts'

export function surfaceWorkspacePaneTabTargetUnavailable(reason: WorkspacePaneTabTargetUnavailableReason): void {
  const messageKey =
    reason === 'workspace-pane-tabs-failed'
      ? 'error.workspace-tabs-action-blocked-load-failed'
      : 'error.workspace-tabs-action-blocked-loading'
  toast.error(translate(messageKey), { id: 'workspace-pane-tabs-action-blocked' })
}
