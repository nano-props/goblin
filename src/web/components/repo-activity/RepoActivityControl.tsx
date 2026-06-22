import { useEffect, useMemo, useRef, useState } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { Check, Loader2, RefreshCw } from 'lucide-react'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { RepoEvent, RepoState } from '#/web/stores/repos/types.ts'
import { useT } from '#/web/stores/i18n.ts'
import { Tip } from '#/web/components/Tip.tsx'
import { AsyncButton } from '#/web/components/AsyncButton.tsx'
import { runRepoRefreshIntent } from '#/web/stores/repos/refresh-coordinator.ts'
import type { RepoActivity, RepoCompletion } from '#/web/components/repo-activity/model.ts'
import {
  getRepoActivity,
  getRepoActivityControlView,
  isRepoPrimaryRefreshBusy,
} from '#/web/components/repo-activity/model.ts'
import { useVisibleLoadingValue } from '#/web/hooks/useLoadingVisibility.ts'
import { cn } from '#/web/lib/cn.ts'
import { Button } from '#/web/components/ui/button.tsx'
import { repoEventActionSuccessLabel } from '#/web/stores/repos/action-labels.ts'
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
  return useVisibleLoadingValue(stableRawActivity)
}

function repoActivityControlRepoEqual(a: RepoState | undefined, b: RepoState | undefined): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.id === b.id &&
      a.instanceToken === b.instanceToken &&
      a.resources === b.resources &&
      a.operations.fetch === b.operations.fetch &&
      a.operations.manualRefresh === b.operations.manualRefresh &&
      a.operations.branchAction === b.operations.branchAction &&
      a.availability === b.availability &&
      a.projection === b.projection &&
      a.remote === b.remote)
  )
}

export function RepoActivityControl({ repoId }: Props) {
  const repo = useStoreWithEqualityFn(useReposStore, (s) => s.repos[repoId], repoActivityControlRepoEqual)
  if (!repo) return null
  return <RepoActivityControlView repo={repo} />
}

function RepoActivityControlView({ repo }: { repo: RepoState }) {
  const visibleActivity = useRepoActivityControlPresentation(repo)
  const completion = useRepoCompletion(repo.id)
  const view = getRepoActivityControlView({
    visibleActivity,
    completion,
    manualSyncBusy: isRepoPrimaryRefreshBusy(repo),
  })

  switch (view.kind) {
    case 'activity':
      return <RepoActivityIndicator activity={view.activity} />
    case 'completion':
      return <RepoCompletionIndicator completion={view.completion} />
    case 'refresh-button':
      return (
        <div className="flex items-center gap-2">
          <RepoRefreshButton repo={repo} manualSyncBusy={view.manualSyncBusy} />
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

function RepoRefreshButton({
  repo,
  manualSyncBusy,
}: {
  repo: RepoState
  manualSyncBusy: boolean
}) {
  const t = useT()
  const label = t('action.refresh')

  function handleSync() {
    const token = repo.instanceToken
    // Fire-and-forget so AsyncButton's internal pending state does not fight
    // the external manualSyncBusy prop. The visual loading state is owned by
    // the operation, not the click promise.
    void runRepoRefreshIntent(useReposStore.getState, {
      kind: 'manual-refresh-requested',
      id: repo.id,
      token,
    })
  }

  const fetchTooltipKey = repo.remote.hasRemotes === false ? 'action.fetch-local-title' : 'action.fetch-title'

  return (
    <Tip label={t(fetchTooltipKey)}>
      <AsyncButton
        variant="ghost"
        size="icon-lg"
        disabled={manualSyncBusy}
        loading={manualSyncBusy}
        onClick={handleSync}
        aria-label={label}
      >
        {({ busy }) => (
          <>
            <RefreshCw className={busy ? 'animate-spin' : ''} />
          </>
        )}
      </AsyncButton>
    </Tip>
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
            size="icon-lg"
            disabled
            aria-busy
            aria-label={label}
            className={cn('bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground')}
          >
            <Loader2 className="animate-spin" />
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
            size="icon-lg"
            disabled
            aria-label={label}
            className="border-success-border bg-success-surface text-success hover:bg-success-surface hover:text-success"
          >
            <Check />
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

  if (repo.projection.source !== 'cache') return null

  const time = repo.projection.savedAt ? new Date(repo.projection.savedAt).toLocaleString() : ''
  const title = time ? t('tab.projectiond-title', { time }) : t('tab.projectiond')

  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground" title={title} aria-label={title}>
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/70" />
      {t('tab.projectiond')}
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
