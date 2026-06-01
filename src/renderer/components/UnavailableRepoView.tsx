import { AlertCircle, RotateCw, Shield, X } from 'lucide-react'
import { Button } from '#/renderer/components/ui/button.tsx'
import { EmptyState } from '#/renderer/components/Layout.tsx'
import { formatRepoLocator } from '#/renderer/lib/paths.ts'
import { formatTranslatableReason, shouldOfferSshSettings, unavailableBodyKey } from '#/renderer/lib/remote-support.ts'
import { rpc } from '#/renderer/rpc.ts'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import type { RepoState } from '#/renderer/stores/repos/types.ts'

interface Props {
  repo: RepoState
}

export function UnavailableRepoView({ repo }: Props) {
  const t = useT()
  const refreshAll = useReposStore((s) => s.refreshAll)
  const closeRepo = useReposStore((s) => s.closeRepo)
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
            <div className="mx-auto max-w-md rounded-md border border-border bg-muted/50 p-3 text-left">
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
            </div>
            <div className="flex justify-center gap-2">
              <Button
                type="button"
                variant="default"
                onClick={() => void refreshAll(repo.id, { token: repo.instanceToken })}
              >
                <RotateCw />
                {t('repo-unavailable.retry')}
              </Button>
              {canOpenSshSettings && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void rpc.app.openSettingsWindow.mutate({ page: 'ssh' })}
                >
                  <Shield />
                  {t('repo-tabs.open-remote-open-ssh-settings')}
                </Button>
              )}
              <Button type="button" variant="ghost" onClick={() => closeRepo(repo.id)}>
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
