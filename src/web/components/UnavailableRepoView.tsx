import { AlertCircle, RotateCw, Shield, X } from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { EmptyState } from '#/web/components/Layout.tsx'
import { PanelInset } from '#/web/components/ui/panel.tsx'
import { formatRepoLocator } from '#/web/lib/paths.ts'
import { useMainWindowNavigation } from '#/web/main-window-navigation.tsx'
import { formatTranslatableReason, shouldOfferSshSettings, unavailableBodyKey } from '#/web/lib/remote-support.ts'
import { runRepoRefreshIntent } from '#/web/stores/repos/refresh-coordinator.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'
interface Props {
  repo: RepoState
}

export function UnavailableRepoView({ repo }: Props) {
  const t = useT()
  const navigation = useMainWindowNavigation()
  const reason = repo.availability.phase === 'unavailable' ? repo.availability.reason : 'error.failed-read-repo'
  const isRemote = !!repo.remote.target
  const bodyKey = unavailableBodyKey(isRemote, reason)
  const canOpenSshSettings = isRemote && shouldOfferSshSettings(reason)

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <EmptyState
        icon={<AlertCircle size={18} />}
        title={t('repo-unavailable.title')}
        body={
          <div className="space-y-3">
            <div>{t(bodyKey)}</div>
            <PanelInset tone="muted" size="lg" className="mx-auto max-w-md text-left">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('repo-unavailable.path')}
              </div>
              <div className="mt-1 break-all font-mono text-[11px] text-foreground">
                {formatRepoLocator(repo.id, repo.remote.target)}
              </div>
              <div className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('repo-unavailable.reason')}
              </div>
              <div className="mt-1 break-words text-xs text-warning">{formatTranslatableReason(t, reason)}</div>
            </PanelInset>
            <div className="flex justify-center gap-2">
              <Button
                type="button"
                variant="default"
                onClick={() =>
                  void runRepoRefreshIntent(useReposStore.getState, {
                    kind: 'manual-refresh-requested',
                    id: repo.id,
                    token: repo.instanceToken,
                  })
                }
              >
                <RotateCw />
                {t('repo-unavailable.retry')}
              </Button>
              {canOpenSshSettings && (
                <Button type="button" variant="outline" onClick={() => navigation.openSettings('ssh')}>
                  <Shield />
                  {t('repo-tabs.open-remote-open-ssh-settings')}
                </Button>
              )}
              <Button type="button" variant="ghost" onClick={() => navigation.closeRepo(repo.id)}>
                <X />
                {t('repo-unavailable.close')}
              </Button>
            </div>
          </div>
        }
      />
    </section>
  )
}
