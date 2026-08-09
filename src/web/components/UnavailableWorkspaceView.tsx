import { AlertCircle, RefreshCw, Shield, X } from '@lucide/vue'
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { toast } from 'vue-sonner'
import { isRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import { Button } from '#/web/components/ui/button.tsx'
import { EmptyState } from '#/web/components/Layout.tsx'
import { PanelInset } from '#/web/components/ui/panel.tsx'
import { formatWorkspaceDisplayLocation } from '#/web/lib/paths.ts'
import { useAppNavigation } from '#/web/app-navigation.tsx'
import { formatTranslatableReason, shouldOfferSshSettings, unavailableBodyKey } from '#/web/lib/remote-diagnostics.ts'
import { runWorkspaceRefresh } from '#/web/stores/workspaces/workspace-refresh-command.ts'
import { presentWorkspaceRefreshOutcome } from '#/web/workspace-refresh-feedback.ts'
import { remoteWorkspaceTarget, workspaceOperationalFailureReason } from '#/web/stores/workspaces/workspace-guards.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
interface Props {
  workspace: WorkspaceState
}

export const UnavailableWorkspaceView = defineComponent<Props>({
  name: 'UnavailableWorkspaceView',
  props: {
    workspace: { type: Object as PropType<WorkspaceState>, required: true },
  },

  setup(props) {
    const t = useT()
    const navigation = useAppNavigation()

    async function handleClose() {
      const result = await navigation.closeWorkspace(props.workspace.id)
      if (!result.ok) {
        const messageKey = result.message
        toast.error(t(messageKey))
      }
    }

    async function handleRetry() {
      const workspace = props.workspace
      if (workspace.admission.kind === 'remote' && workspace.admission.lifecycle?.kind === 'failed') {
        const outcome = await workspacesStore.getState().retryRemoteWorkspaceConnection(workspace.id)
        if (outcome && !outcome.ok) {
          toast.error(formatTranslatableReason(t, outcome.reason ?? 'unknown'))
        }
        return
      }
      const outcome = await runWorkspaceRefresh(
        { get: workspacesStore.getState, set: workspacesStore.setState },
        workspace.id,
        { workspaceRuntimeId: workspace.workspaceRuntimeId },
      )
      presentWorkspaceRefreshOutcome(outcome, t)
    }

    return () => {
      const workspace = props.workspace
      const failureReason = workspaceOperationalFailureReason(workspace)
      const isRemote = isRemoteWorkspaceId(workspace.id)
      if (!failureReason) return null
      const reason = failureReason
      const bodyKey = unavailableBodyKey(isRemote, reason)
      const canOpenSshSettings = isRemote && shouldOfferSshSettings(reason)

      return (
        <section class="flex min-w-0 flex-1 flex-col">
          <EmptyState
            icon={<AlertCircle size={18} />}
            title={t('workspace-unavailable.title')}
            body={
              <div class="space-y-3">
                <div>{t(bodyKey)}</div>
                <PanelInset tone="muted" size="lg" class="mx-auto max-w-md text-left">
                  <div class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t('workspace-unavailable.path')}
                  </div>
                  <div class="mt-1 break-all font-mono text-[11px] text-foreground">
                    {formatWorkspaceDisplayLocation(
                      workspace.id,
                      remoteWorkspaceTarget(
                        workspace.id,
                        workspace.admission.kind === 'remote' ? workspace.admission.lifecycle : null,
                      ),
                    )}
                  </div>
                  <div class="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t('workspace-unavailable.reason')}
                  </div>
                  <div class="mt-1 break-words text-xs text-warning">{formatTranslatableReason(t, reason)}</div>
                </PanelInset>
                <div class="flex justify-center gap-2">
                  <Button
                    type="button"
                    variant="default"
                    onClick={() => {
                      void handleRetry()
                    }}
                  >
                    <RefreshCw />
                    {t('workspace-unavailable.retry')}
                  </Button>
                  {canOpenSshSettings ? (
                    <Button type="button" variant="outline" onClick={() => navigation.openSettings('ssh')}>
                      <Shield />
                      {t('workspace-picker.open-remote-open-ssh-settings')}
                    </Button>
                  ) : null}
                  <Button type="button" variant="ghost" onClick={() => void handleClose()}>
                    <X />
                    {t('workspace-unavailable.close')}
                  </Button>
                </div>
              </div>
            }
          />
        </section>
      )
    }
  },
})
