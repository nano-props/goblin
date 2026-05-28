import { useEffect, useMemo, useRef, useState } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { Check, Loader2, RotateCw } from 'lucide-react'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import type { RepoEvent, RepoState } from '#/renderer/stores/repos/types.ts'
import { useT } from '#/renderer/stores/i18n.ts'
import { Tip } from '#/renderer/components/Tip.tsx'
import { AsyncButton } from '#/renderer/components/AsyncButton.tsx'
import type { RepoActivity, RepoCompletion } from '#/renderer/components/repo-activity/model.ts'
import {
  getRepoActivity,
  getRepoActivityControlPresentation,
  getRepoActivityControlView,
} from '#/renderer/components/repo-activity/model.ts'
import { useVisibleLoadingValue } from '#/renderer/hooks/useLoadingVisibility.ts'
import { cn } from '#/renderer/lib/cn.ts'
import { Button } from '#/renderer/components/ui/button.tsx'
import { repoEventActionSuccessLabel } from '#/renderer/stores/repos/action-labels.ts'

interface Props {
  repoId: string
}

const COMPLETION_VISIBLE_MS = 1500
const EMPTY_EVENTS: RepoEvent[] = []

function useRepoActivityControlPresentation(repo: RepoState) {
  const rawActivity = getRepoActivity(repo)
  const rawActivityKey = rawActivity
    ? `${rawActivity.kind}:${rawActivity.labelKey}:${JSON.stringify(rawActivity.labelParams ?? {})}`
    : null
  const stableRawActivity = useMemo(() => rawActivity, [rawActivityKey])
  const visibleActivity = useVisibleLoadingValue(stableRawActivity)
  return getRepoActivityControlPresentation(repo, visibleActivity)
}

function repoActivityControlRepoEqual(a: RepoState | undefined, b: RepoState | undefined): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.id === b.id &&
      a.instanceToken === b.instanceToken &&
      a.resources === b.resources &&
      a.operations.branchAction === b.operations.branchAction &&
      a.availability === b.availability &&
      a.cache === b.cache &&
      a.remote === b.remote)
  )
}

export function RepoActivityControl({ repoId }: Props) {
  const repo = useStoreWithEqualityFn(useReposStore, (s) => s.repos[repoId], repoActivityControlRepoEqual)
  if (!repo) return null
  return <RepoActivityControlView repo={repo} />
}

function RepoActivityControlView({ repo }: { repo: RepoState }) {
  const { syncBlocked, visibleActivity, showingActivity } = useRepoActivityControlPresentation(repo)
  const completion = useRepoCompletion(repo.id)
  const view = getRepoActivityControlView({
    visibleActivity: showingActivity ? visibleActivity : null,
    completion,
    syncBlocked,
    localOnly: repo.remote.hasRemotes === false,
  })

  switch (view.kind) {
    case 'activity':
      return <RepoActivityIndicator activity={view.activity} />
    case 'completion':
      return <RepoCompletionIndicator completion={view.completion} />
    case 'local-only':
      return (
        <div className="flex items-center gap-2">
          <RepoLocalOnlyIndicator repo={repo} />
          <RepoCacheIndicator repo={repo} />
          <RepoFetchFailureIndicator repo={repo} />
        </div>
      )
    case 'refresh-button':
      return (
        <div className="flex items-center gap-2">
          <RepoRefreshButton repo={repo} syncBlocked={view.syncBlocked} />
          <RepoCacheIndicator repo={repo} />
          <RepoFetchFailureIndicator repo={repo} />
        </div>
      )
  }
}

function useRepoCompletion(repoId: string): RepoCompletion | null {
  const events = useReposStore((s) => s.repos[repoId]?.events ?? EMPTY_EVENTS)
  const [completion, setCompletion] = useState<RepoCompletion | null>(null)
  const latestEventIdRef = useRef(0)

  useEffect(() => {
    latestEventIdRef.current = 0
    setCompletion(null)
  }, [repoId])

  useEffect(() => {
    const latestSeen = latestEventIdRef.current
    let nextLatestSeen = latestSeen
    let nextCompletion: RepoCompletion | null = null
    for (const event of events) {
      nextLatestSeen = Math.max(nextLatestSeen, event.id)
      if (event.id <= latestSeen) continue
      if (event.kind !== 'result' || !event.result.ok) continue
      const label = repoEventActionSuccessLabel(event.action)
      if (label) nextCompletion = { id: event.id, ...label }
    }
    latestEventIdRef.current = nextLatestSeen
    if (nextCompletion) setCompletion(nextCompletion)
  }, [events])

  useEffect(() => {
    if (!completion) return
    const timer = window.setTimeout(() => {
      setCompletion((current) => (current?.id === completion.id ? null : current))
    }, COMPLETION_VISIBLE_MS)
    return () => window.clearTimeout(timer)
  }, [completion])

  return completion
}

function RepoRefreshButton({ repo, syncBlocked }: { repo: RepoState; syncBlocked: boolean }) {
  const t = useT()
  const syncAndRefresh = useReposStore((s) => s.syncAndRefresh)

  async function handleSync() {
    const token = repo.instanceToken
    if (syncBlocked) return
    await syncAndRefresh(repo.id, { token })
  }

  return (
    <Tip label={t(repo.remote.hasRemotes === false ? 'action.fetch-local-title' : 'action.fetch-title')}>
      <AsyncButton variant="ghost" onClick={handleSync}>
        {({ busy }) => (
          <>
            <RotateCw className={busy ? 'animate-spin' : ''} />
            {t('action.refresh')}
          </>
        )}
      </AsyncButton>
    </Tip>
  )
}

function RepoLocalOnlyIndicator({ repo }: { repo: RepoState }) {
  const t = useT()

  if (repo.remote.hasRemotes !== false) return null

  return (
    <span
      className="flex items-center gap-1 text-xs text-muted-foreground"
      title={t('tab.local-only-title')}
      aria-label={t('tab.local-only-title')}
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/70" />
      {t('tab.local-only')}
    </span>
  )
}

function RepoActivityIndicator({ activity }: { activity: RepoActivity }) {
  const t = useT()
  const label = t(activity.labelKey, activity.labelParams)

  return (
    <div className="flex items-center gap-2">
      <Tip label={label}>
        <span className="inline-flex">
          <Button
            variant="ghost"
            disabled
            aria-busy
            className={cn('bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground')}
          >
            <Loader2 className="animate-spin" />
            {label}
          </Button>
        </span>
      </Tip>
      <span className="sr-only" role="status">
        {label}
      </span>
    </div>
  )
}

function RepoCompletionIndicator({ completion }: { completion: RepoCompletion }) {
  const t = useT()
  const label = t(completion.labelKey, completion.labelParams)

  return (
    <div className="flex items-center gap-2">
      <Tip label={label}>
        <span className="inline-flex">
          <Button
            variant="ghost"
            disabled
            className="border-success-border bg-success-surface text-success hover:bg-success-surface hover:text-success"
          >
            <Check />
            {label}
          </Button>
        </span>
      </Tip>
      <span className="sr-only" role="status">
        {label}
      </span>
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
