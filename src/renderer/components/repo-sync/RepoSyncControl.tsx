import { Loader2, RotateCw } from 'lucide-react'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import type { RepoState } from '#/renderer/stores/repos/types.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { Tip } from '#/renderer/components/Tip.tsx'
import { Button } from '#/renderer/components/ui/button.tsx'
import { getRepoSyncActivity, isRepoSyncBlocked } from '#/renderer/components/repo-sync/model.ts'

interface Props {
  repo: RepoState
}

export function RepoSyncControl({ repo }: Props) {
  const t = useT()
  const syncAndRefresh = useReposStore((s) => s.syncAndRefresh)
  const activity = getRepoSyncActivity(repo)
  const syncBlocked = isRepoSyncBlocked(repo)
  const buttonLabel = activity ? t(activity.labelKey) : t('action.refresh')
  const buttonDisabled = syncBlocked || activity !== null
  const Icon = activity ? Loader2 : RotateCw

  async function handleSync() {
    const token = repo.instanceToken
    if (buttonDisabled) return
    await syncAndRefresh(repo.id, { token })
  }

  return (
    <div className="flex items-center gap-2">
      <Tip label={t('action.fetch-title')}>
        <Button variant="ghost" onClick={handleSync} disabled={buttonDisabled} aria-busy={activity !== null}>
          <Icon className={activity ? 'animate-spin' : ''} />
          {buttonLabel}
        </Button>
      </Tip>
      {activity && (
        <span className="sr-only" role="status">
          {buttonLabel}
        </span>
      )}
      {!activity && <RepoFetchFailureIndicator repo={repo} />}
    </div>
  )
}

function RepoFetchFailureIndicator({ repo }: { repo: RepoState }) {
  const t = useT()

  if (repo.fetchFailed) {
    return (
      <span
        className="flex items-center gap-1 text-xs text-warning"
        // Hover surfaces the actual git error (e.g. "fatal: could
        // not read Username") so the user can act on it; without
        // a real message we fall back to the generic title.
        title={repo.fetchError ?? t('tab.fetch-failed-title')}
        aria-label={repo.fetchError ?? t('tab.fetch-failed-title')}
      >
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-warning" />
        {t('tab.fetch-failed')}
      </span>
    )
  }

  return null
}
