import { AlertCircle, RefreshCw, Shield, X } from 'lucide-react'
import { toast } from 'sonner'
import { isRemoteWorkspaceId } from '#/shared/remote-workspace.ts'
import { Button } from '#/web/components/ui/button.tsx'
import { EmptyState } from '#/web/components/Layout.tsx'
import { PanelInset } from '#/web/components/ui/panel.tsx'
import { formatWorkspaceDisplayLocation } from '#/web/lib/paths.ts'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import { formatTranslatableReason, shouldOfferSshSettings, unavailableBodyKey } from '#/web/lib/remote-diagnostics.ts'
import { runManualWorkspaceRefresh } from '#/web/stores/workspaces/workspace-refresh-command.ts'
import { presentWorkspaceRefreshOutcome } from '#/web/workspace-refresh-feedback.ts'
import { isWorkspaceUnavailable, remoteWorkspaceTarget } from '#/web/stores/workspaces/workspace-guards.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
interface Props {
  workspace: WorkspaceState
}

export function UnavailableWorkspaceView({ workspace }: Props) {
  const t = useT()
  const navigation = usePrimaryWindowNavigation()
  // Phase 4 invariant: the `availability.phase` mirror is a
  // legacy hint for the refresh-pipeline guards, NOT the
  // authoritative source. The lifecycle union is. Gate on
  // `isWorkspaceUnavailable` (which dispatches by workspace kind) and
  // read the reason from the field that owns it for each kind.
  const isUnavailable = isWorkspaceUnavailable(workspace)
  const isRemote = isRemoteWorkspaceId(workspace.id)
  const reason = isRemote
    ? workspace.admission.kind === 'remote' && workspace.admission.lifecycle?.kind === 'failed'
      ? workspace.admission.lifecycle.reason
      : 'error.workspace-operation-failed'
    : workspace.availability.phase === 'unavailable'
      ? workspace.availability.reason
      : 'error.workspace-operation-failed'
  if (!isUnavailable) {
    // Defensive: this view is only mounted when the workspace is unavailable,
    // but a stale render after a state
    // transition shouldn't render an empty body.
    return null
  }
  const bodyKey = unavailableBodyKey(isRemote, reason)
  const canOpenSshSettings = isRemote && shouldOfferSshSettings(reason)

  async function handleClose() {
    const result = await navigation.closeWorkspace(workspace.id)
    if (!result.ok) toast.error(t(result.message))
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <EmptyState
        icon={<AlertCircle size={18} />}
        title={t('workspace-unavailable.title')}
        body={
          <div className="space-y-3">
            <div>{t(bodyKey)}</div>
            <PanelInset tone="muted" size="lg" className="mx-auto max-w-md text-left">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('workspace-unavailable.path')}
              </div>
              <div className="mt-1 break-all font-mono text-[11px] text-foreground">
                {formatWorkspaceDisplayLocation(
                  workspace.id,
                  remoteWorkspaceTarget(
                    workspace.id,
                    workspace.admission.kind === 'remote' ? workspace.admission.lifecycle : null,
                  ),
                )}
              </div>
              <div className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('workspace-unavailable.reason')}
              </div>
              <div className="mt-1 break-words text-xs text-warning">{formatTranslatableReason(t, reason)}</div>
            </PanelInset>
            <div className="flex justify-center gap-2">
              <Button
                type="button"
                variant="default"
                onClick={() => {
                  void runManualWorkspaceRefresh(
                    { get: useWorkspacesStore.getState, set: useWorkspacesStore.setState },
                    workspace.id,
                    { workspaceRuntimeId: workspace.workspaceRuntimeId },
                  ).then((outcome) => presentWorkspaceRefreshOutcome(outcome, t))
                }}
              >
                <RefreshCw />
                {t('workspace-unavailable.retry')}
              </Button>
              {canOpenSshSettings && (
                <Button type="button" variant="outline" onClick={() => navigation.openSettings('ssh')}>
                  <Shield />
                  {t('workspace-picker.open-remote-open-ssh-settings')}
                </Button>
              )}
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
