import { AlertCircle, RefreshCw, Shield, X } from 'lucide-react'
import { isRemoteRepoId } from '#/shared/remote-repo.ts'
import { Button } from '#/web/components/ui/button.tsx'
import { EmptyState } from '#/web/components/Layout.tsx'
import { PanelInset } from '#/web/components/ui/panel.tsx'
import { formatRepoLocator } from '#/web/lib/paths.ts'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import { formatTranslatableReason, shouldOfferSshSettings, unavailableBodyKey } from '#/web/lib/remote-diagnostics.ts'
import { runManualRepoSync } from '#/web/stores/repos/refresh.ts'
import { isRepoUnavailable, remoteRepoTarget } from '#/web/stores/repos/repo-guards.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useT } from '#/web/stores/i18n.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'
interface Props {
  repo: RepoState
}

export function UnavailableRepoView({ repo }: Props) {
  const t = useT()
  const navigation = usePrimaryWindowNavigation()
  // Phase 4 invariant: the `availability.phase` mirror is a
  // legacy hint for the refresh-pipeline guards, NOT the
  // authoritative source. The lifecycle union is. Gate on
  // `isRepoUnavailable` (which dispatches by repo kind) and
  // read the reason from the field that owns it for each kind.
  const isUnavailable = isRepoUnavailable(repo)
  const isRemote = isRemoteRepoId(repo.id)
  const reason = isRemote
    ? repo.remote.lifecycle?.kind === 'failed'
      ? repo.remote.lifecycle.reason
      : 'error.failed-read-repo'
    : repo.availability.phase === 'unavailable'
      ? repo.availability.reason
      : 'error.failed-read-repo'
  if (!isUnavailable) {
    // Defensive: this view is only mounted by RepoView when
    // the repo is unavailable, but a stale render after a state
    // transition shouldn't render an empty body.
    return null
  }
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
                {formatRepoLocator(repo.id, remoteRepoTarget(repo.id, repo.remote.lifecycle))}
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
                  void runManualRepoSync(
                    { get: useReposStore.getState, set: useReposStore.setState },
                    repo.id,
                    { repoRuntimeId: repo.repoRuntimeId },
                  )
                }
              >
                <RefreshCw />
                {t('repo-unavailable.retry')}
              </Button>
              {canOpenSshSettings && (
                <Button type="button" variant="outline" onClick={() => navigation.openSettings('ssh')}>
                  <Shield />
                  {t('repo-picker.open-remote-open-ssh-settings')}
                </Button>
              )}
              <Button type="button" variant="ghost" onClick={() => void navigation.closeRepo(repo.id)}>
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
