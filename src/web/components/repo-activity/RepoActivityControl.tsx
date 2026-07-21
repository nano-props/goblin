import { useEffect, useMemo, useRef, useState } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { Check, Loader2, RefreshCw } from 'lucide-react'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type { GitWorkspaceProjection, WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { useI18nStore, useT } from '#/web/stores/i18n.ts'
import { Tip } from '#/web/components/Tip.tsx'
import { AsyncButton } from '#/web/components/AsyncButton.tsx'
import { runManualWorkspaceRefresh } from '#/web/stores/workspaces/workspace-refresh-command.ts'
import { presentWorkspaceRefreshOutcome } from '#/web/workspace-refresh-feedback.ts'
import type { RepoActivity, RepoActivityProjectionRepo, RepoCompletion } from '#/web/components/repo-activity/model.ts'
import {
  getRepoActivity,
  getRepoActivityControlView,
  isRepoPrimaryRefreshBusy,
} from '#/web/components/repo-activity/model.ts'
import { useVisibleLoadingValue } from '#/web/hooks/useLoadingVisibility.ts'
import { cn } from '#/web/lib/cn.ts'
import { Button } from '#/web/components/ui/button.tsx'
import { repoEventActionSuccessLabel } from '#/web/stores/workspaces/action-labels.ts'
import { formatRelativeTime } from '#/web/lib/dates.ts'
import { latestRepoSyncTime } from '#/web/stores/workspaces/sync-time.ts'
import { useRepoOperationsReadModel } from '#/web/repo-queries.ts'
import type { RepoOperationsSnapshot } from '#/shared/api-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

interface Props {
  repoId: WorkspaceId
}

const COMPLETION_VISIBLE_MS = 1500

type RepoActivityControlRepo = Pick<WorkspaceState, 'id' | 'workspaceRuntimeId'> &
  Pick<GitWorkspaceProjection, 'dataLoads' | 'projection' | 'remote'> &
  RepoActivityProjectionRepo

function useRepoActivityControlPresentation(
  repo: RepoActivityProjectionRepo,
  serverOperations?: RepoOperationsSnapshot,
) {
  const rawActivity = getRepoActivity(repo, serverOperations)
  const rawActivityKey = rawActivity
    ? `${rawActivity.kind}:${rawActivity.labelKey}:${JSON.stringify(rawActivity.labelParams ?? {})}`
    : null
  const stableRawActivity = useMemo(() => rawActivity, [rawActivityKey])
  return useVisibleLoadingValue(stableRawActivity)
}

function repoActivityControlRepoEqual(
  a: RepoActivityControlRepo | undefined,
  b: RepoActivityControlRepo | undefined,
): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.id === b.id &&
      a.workspaceRuntimeId === b.workspaceRuntimeId &&
      a.dataLoads === b.dataLoads &&
      a.branchAction === b.branchAction &&
      a.projection === b.projection &&
      a.remote === b.remote)
  )
}

export function RepoActivityControl({ repoId }: Props) {
  const repo = useStoreWithEqualityFn(
    useWorkspacesStore,
    (s): RepoActivityControlRepo | undefined => {
      const repo = s.workspaces[repoId]
      return repo?.capability.kind === 'git'
        ? {
            id: repo.id,
            workspaceRuntimeId: repo.workspaceRuntimeId,
            dataLoads: repo.capability.git.dataLoads,
            branchAction: repo.capability.git.operations.branchAction,
            projection: repo.capability.git.projection,
            remote: repo.capability.git.remote,
          }
        : undefined
    },
    repoActivityControlRepoEqual,
  )
  if (!repo) return null
  return <RepoActivityControlView repo={repo} />
}

function RepoActivityControlView({ repo }: { repo: RepoActivityControlRepo }) {
  const operationsReadModel = useRepoOperationsReadModel(repo.id, repo.workspaceRuntimeId)
  const visibleActivity = useRepoActivityControlPresentation(repo, operationsReadModel.data)
  const completion = useRepoCompletion(repo.id)
  const view = getRepoActivityControlView({
    visibleActivity,
    completion,
    manualSyncBusy: isRepoPrimaryRefreshBusy(repo, operationsReadModel.data),
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

function useRepoCompletion(repoId: WorkspaceId): RepoCompletion | null {
  const events = useWorkspacesStore((s) => {
    const workspace = s.workspaces[repoId]
    return workspace?.capability.kind === 'git' ? workspace.capability.git.events : null
  })
  const [completion, setCompletion] = useState<RepoCompletion | null>(null)
  const latestEventIdRef = useRef(0)

  useEffect(() => {
    latestEventIdRef.current = 0
    setCompletion(null)
  }, [repoId])

  useEffect(() => {
    if (!events) return
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

function RepoRefreshButton({ repo, manualSyncBusy }: { repo: RepoActivityControlRepo; manualSyncBusy: boolean }) {
  const t = useT()
  const lang = useI18nStore((s) => s.lang)
  const label = t('action.refresh')

  async function handleSync(): Promise<void> {
    const workspaceRuntimeId = repo.workspaceRuntimeId
    const outcome = await runManualWorkspaceRefresh(
      { get: useWorkspacesStore.getState, set: useWorkspacesStore.setState },
      repo.id,
      { workspaceRuntimeId },
    )
    presentWorkspaceRefreshOutcome(outcome, t)
  }

  const fetchTooltipKey = repo.remote.hasRemotes === false ? 'action.fetch-local-title' : 'action.fetch-title'
  const lastSyncedAt = latestRepoSyncTime(repo)
  const lastSyncedAtIso = lastSyncedAt === null ? null : new Date(lastSyncedAt).toISOString()
  const lastSyncedLabel = lastSyncedAtIso ? formatRelativeTime(lastSyncedAtIso, lang) : null

  // The picker no longer surfaces last-sync info on the tab itself,
  // so the refresh button tooltip is the primary place users check
  // how stale the view is. We show "Last synced X ago" when we have
  // a timestamp, and fall back to the action title before the first
  // sync has happened. Single-line label so the font matches the
  // rest of the repo chrome tooltips.
  const tooltipLabel = lastSyncedLabel
    ? `${t('workspace-picker.tooltip.last-sync-label')} ${lastSyncedLabel}`
    : t(fetchTooltipKey)

  return (
    <Tip label={tooltipLabel}>
      <AsyncButton
        variant="ghost"
        size="icon-lg"
        disabled={manualSyncBusy}
        loading={manualSyncBusy}
        onClick={() => void handleSync()}
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

function RepoCacheIndicator({ repo }: { repo: RepoActivityControlRepo }) {
  const t = useT()

  if (repo.projection.source !== 'cache') return null

  const time = repo.projection.savedAt ? new Date(repo.projection.savedAt).toLocaleString() : ''
  const title = time ? t('tab.cached-title', { time }) : t('tab.cached')

  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground" title={title} aria-label={title}>
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/70" />
      {t('tab.cached')}
    </span>
  )
}

function RepoFetchFailureIndicator({ repo }: { repo: RepoActivityControlRepo }) {
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
