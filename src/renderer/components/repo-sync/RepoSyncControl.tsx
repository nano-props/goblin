import { Loader2, RotateCw } from 'lucide-react'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import type { RepoState } from '#/renderer/stores/repos/types.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { Tip } from '#/renderer/components/Tip.tsx'
import { AsyncButton } from '#/renderer/components/AsyncButton.tsx'
import { getRepoSyncActivity, getRepoSyncPresentation } from '#/renderer/components/repo-sync/model.ts'
import { useVisibleLoadingValue } from '#/renderer/hooks/useLoadingVisibility.ts'
import { cn } from '#/renderer/lib/cn.ts'

interface Props {
  repo: RepoState
}

function useRepoSyncPresentation(repo: RepoState) {
  const rawActivity = getRepoSyncActivity(repo)
  const visibleActivity = useVisibleLoadingValue(rawActivity)
  return getRepoSyncPresentation(repo, visibleActivity)
}

export function RepoSyncControl({ repo }: Props) {
  const t = useT()
  const syncAndRefresh = useReposStore((s) => s.syncAndRefresh)
  const { rawBlocked, visibleActivity, visualBusy, visualDisabled } = useRepoSyncPresentation(repo)
  const buttonLabel = visibleActivity ? t(visibleActivity.labelKey) : t('action.refresh')
  const Icon = visibleActivity ? Loader2 : RotateCw

  async function handleSync() {
    const token = repo.instanceToken
    if (rawBlocked) return
    await syncAndRefresh(repo.id, { token })
  }

  return (
    <div className="flex items-center gap-2">
      <Tip label={t('action.fetch-title')}>
        <AsyncButton
          variant="ghost"
          onClick={handleSync}
          loading={visualBusy}
          disabled={visualDisabled}
          className={cn(visualBusy && 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground')}
        >
          {({ busy }) => {
            const BusyIcon = busy ? Loader2 : Icon
            return (
              <>
                <BusyIcon className={busy ? 'animate-spin' : ''} />
                {buttonLabel}
              </>
            )
          }}
        </AsyncButton>
      </Tip>
      {visualBusy && (
        <span className="sr-only" role="status">
          {buttonLabel}
        </span>
      )}
      {!visualBusy && <RepoCacheIndicator repo={repo} />}
      {!visualBusy && <RepoFetchFailureIndicator repo={repo} />}
    </div>
  )
}

function RepoCacheIndicator({ repo }: { repo: RepoState }) {
  const t = useT()

  if (repo.cache.source !== 'cache') return null

  const time = repo.cache.savedAt ? new Date(repo.cache.savedAt).toLocaleString() : ''
  const title = time ? t('tab.cached-title', { time }) : t('tab.cached')

  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground" title={title} aria-label={title}>
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/70" />
      {t('tab.cached')}
    </span>
  )
}

function RepoFetchFailureIndicator({ repo }: { repo: RepoState }) {
  const t = useT()

  if (repo.remote.fetchFailed) {
    return (
      <span
        className="flex items-center gap-1 text-xs text-warning"
        // Hover surfaces the actual git error (e.g. "fatal: could
        // not read Username") so the user can act on it; without
        // a real message we fall back to the generic title.
        title={repo.remote.fetchError ?? t('tab.fetch-failed-title')}
        aria-label={repo.remote.fetchError ?? t('tab.fetch-failed-title')}
      >
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-warning" />
        {t('tab.fetch-failed')}
      </span>
    )
  }

  return null
}
