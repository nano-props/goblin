import { AlertCircle, RotateCw, X } from 'lucide-react'
import { Button } from '#/renderer/components/ui/button.tsx'
import { EmptyState } from '#/renderer/components/Layout.tsx'
import { tildify } from '#/renderer/lib/paths.ts'
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

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <EmptyState
        icon={<AlertCircle size={18} />}
        title={t('repo-unavailable.title')}
        body={
          <div className="space-y-3">
            <div>{t('repo-unavailable.body')}</div>
            <div className="mx-auto max-w-md rounded-md border border-border bg-muted/50 p-3 text-left">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('repo-unavailable.path')}
              </div>
              <div className="mt-1 break-all font-mono text-[11px] text-foreground">{tildify(repo.id)}</div>
              <div className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('repo-unavailable.reason')}
              </div>
              <div className="mt-1 break-words text-xs text-warning">{formatReason(reason, t)}</div>
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

function formatReason(reason: string, t: (key: string) => string): string {
  return reason.startsWith('error.') ? t(reason) : reason
}
