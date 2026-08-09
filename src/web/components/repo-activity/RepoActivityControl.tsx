import { computed, defineComponent, onScopeDispose, ref, watch } from 'vue'
import type { PropType } from 'vue'
import { Check, Loader2, RefreshCw } from '@lucide/vue'
import type { RepoOperationsSnapshot } from '#/shared/api-types.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { AsyncButton } from '#/web/components/AsyncButton.tsx'
import { Tip } from '#/web/components/Tip.tsx'
import type { RepoActivity, RepoActivityProjectionRepo, RepoCompletion } from '#/web/components/repo-activity/model.ts'
import {
  getRepoActivity,
  getRepoActivityControlView,
  repoOperationsSnapshotHasPrimaryRefresh,
} from '#/web/components/repo-activity/model.ts'
import { Button } from '#/web/components/ui/button.tsx'
import { useVisibleLoadingValue } from '#/web/hooks/useLoadingVisibility.ts'
import { cn } from '#/web/lib/cn.ts'
import { formatRelativeTime } from '#/web/lib/dates.ts'
import { useRepoOperationsReadModel } from '#/web/repo-queries.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { i18nStore } from '#/web/stores/i18n.ts'
import { repoEventActionSuccessLabel } from '#/web/stores/workspaces/action-labels.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { latestRepoSyncTime } from '#/web/stores/workspaces/sync-time.ts'
import { runWorkspaceRefresh } from '#/web/stores/workspaces/workspace-refresh-command.ts'
import { presentWorkspaceRefreshOutcome } from '#/web/workspace-refresh-feedback.ts'

interface Props {
  repoId: WorkspaceId
}

const COMPLETION_VISIBLE_MS = 1500

type RepoActivityControlRepo = Pick<WorkspaceState, 'id' | 'workspaceRuntimeId'> & RepoActivityProjectionRepo

export const RepoActivityControl = defineComponent<Props>({
  name: 'RepoActivityControl',
  props: ['repoId'],
  setup(props) {
    const workspaces = useStoreSelector(workspacesStore, (state) => state.workspaces)
    const repo = computed<RepoActivityControlRepo | undefined>(() => {
      const workspace = workspaces.value[props.repoId]
      return workspace?.capability.kind === 'git'
        ? {
            id: workspace.id,
            workspaceRuntimeId: workspace.workspaceRuntimeId,
            branchAction: workspace.capability.git.operations.branchAction,
          }
        : undefined
    })
    return () => (repo.value ? <RepoActivityControlView repo={repo.value} /> : null)
  },
})

const RepoActivityControlView = defineComponent<{ repo: RepoActivityControlRepo }>({
  name: 'RepoActivityControlView',
  inheritAttrs: false,
  props: ['repo'],
  setup(props) {
    const t = useT()
    const operationsReadModel = useRepoOperationsReadModel(
      () => props.repo.id,
      () => props.repo.workspaceRuntimeId,
    )
    const rawActivity = computed(() => getRepoActivity(props.repo, operationsReadModel.data.value))
    const visibleActivity = useVisibleLoadingValue(rawActivity)
    const completion = useRepoCompletion(() => props.repo.id)

    return () => {
      const operationsSnapshot = operationsReadModel.data.value
      const view = getRepoActivityControlView({
        visibleActivity: visibleActivity.value,
        completion: completion.value,
        primaryRefreshBusy: repoOperationsSnapshotHasPrimaryRefresh(operationsSnapshot),
      })

      switch (view.kind) {
        case 'activity': {
          const activityLabelKey = view.activity.labelKey
          const label = t(activityLabelKey, view.activity.labelParams)
          return <RepoActivityIndicator activity={view.activity} label={label} />
        }
        case 'completion': {
          const completionLabelKey = view.completion.labelKey
          const label = t(completionLabelKey, view.completion.labelParams)
          return <RepoCompletionIndicator completion={view.completion} label={label} />
        }
        case 'refresh-button':
          return (
            <RepoRefreshButton
              repo={props.repo}
              primaryRefreshBusy={view.primaryRefreshBusy}
              lastFetchAt={operationsSnapshot?.lastFetchAt ?? null}
            />
          )
      }
    }
  },
})

function useRepoCompletion(repoId: () => WorkspaceId) {
  const completion = ref<RepoCompletion | null>(null)
  const workspaces = useStoreSelector(workspacesStore, (state) => state.workspaces)
  const events = computed(() => {
    const workspace = workspaces.value[repoId()]
    return workspace?.capability.kind === 'git' ? workspace.capability.git.events : null
  })
  let currentRepoId: WorkspaceId | null = null
  let latestEventId = 0
  let completionTimer: number | null = null

  function clearCompletionTimer(): void {
    if (completionTimer !== null) window.clearTimeout(completionTimer)
    completionTimer = null
  }

  // Completion is an event-stream projection. The watcher advances its cursor
  // once per authoritative event array and owns the short visibility timer.
  watch(
    [repoId, events],
    ([nextRepoId, nextEvents]) => {
      if (currentRepoId !== nextRepoId) {
        currentRepoId = nextRepoId
        latestEventId = 0
        completion.value = null
        clearCompletionTimer()
      }
      if (!nextEvents) return
      let nextLatestEventId = latestEventId
      let nextCompletion: RepoCompletion | null = null
      for (const event of nextEvents) {
        nextLatestEventId = Math.max(nextLatestEventId, event.id)
        if (event.id <= latestEventId || event.kind !== 'result' || !event.result.ok) continue
        const label = repoEventActionSuccessLabel(event.action)
        if (label) nextCompletion = { id: event.id, ...label }
      }
      latestEventId = nextLatestEventId
      if (!nextCompletion) return
      completion.value = nextCompletion
      clearCompletionTimer()
      const completionId = nextCompletion.id
      completionTimer = window.setTimeout(() => {
        if (completion.value?.id === completionId) completion.value = null
        completionTimer = null
      }, COMPLETION_VISIBLE_MS)
    },
    { immediate: true },
  )

  onScopeDispose(clearCompletionTimer)
  return completion
}

const RepoRefreshButton = defineComponent<{
  repo: RepoActivityControlRepo
  primaryRefreshBusy: boolean
  lastFetchAt: number | null
}>({
  name: 'RepoRefreshButton',
  props: {
    repo: { type: Object as PropType<RepoActivityControlRepo>, required: true },
    primaryRefreshBusy: Boolean,
    lastFetchAt: { type: Number as PropType<number | null>, default: null },
  },

  setup(props) {
    const t = useT()
    const lang = useStoreSelector(i18nStore, (state) => state.lang)

    async function refresh(): Promise<void> {
      const outcome = await runWorkspaceRefresh(
        { get: workspacesStore.getState, set: workspacesStore.setState },
        props.repo.id,
        { workspaceRuntimeId: props.repo.workspaceRuntimeId },
      )
      presentWorkspaceRefreshOutcome(outcome, t)
    }

    return () => {
      const label = t('action.refresh')
      const lastSyncedAt = latestRepoSyncTime({ lastFetchAt: props.lastFetchAt })
      const lastSyncedAtIso = lastSyncedAt === null ? null : new Date(lastSyncedAt).toISOString()
      const lastSyncedLabel = lastSyncedAtIso ? formatRelativeTime(lastSyncedAtIso, lang.value) : null
      const tooltipLabel = `${t('workspace-picker.tooltip.last-sync-label')} ${
        lastSyncedLabel ?? t('workspace-picker.tooltip.last-sync-unknown')
      }`

      return (
        <Tip label={tooltipLabel}>
          <AsyncButton
            variant="ghost"
            size="icon-lg"
            disabled={props.primaryRefreshBusy}
            loading={props.primaryRefreshBusy}
            action={refresh}
            aria-label={label}
          >
            {({ busy }: { busy: boolean }) => <RefreshCw class={busy ? 'animate-spin' : ''} />}
          </AsyncButton>
        </Tip>
      )
    }
  },
})

function RepoActivityIndicator({ activity: _activity, label }: { activity: RepoActivity; label: string }) {
  return (
    <div class="flex items-center gap-2">
      <Tip label={label}>
        <span class="inline-flex">
          <Button
            variant="ghost"
            size="icon-lg"
            disabled
            aria-busy="true"
            aria-label={label}
            class={cn('bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground')}
          >
            <Loader2 class="animate-spin" />
          </Button>
        </span>
      </Tip>
      <span class="sr-only" role="status">
        {label}
      </span>
    </div>
  )
}

function RepoCompletionIndicator({ completion: _completion, label }: { completion: RepoCompletion; label: string }) {
  return (
    <div class="flex items-center gap-2">
      <Tip label={label}>
        <span class="inline-flex">
          <Button
            variant="ghost"
            size="icon-lg"
            disabled
            aria-label={label}
            class="border-success-border bg-success-surface text-success hover:bg-success-surface hover:text-success"
          >
            <Check />
          </Button>
        </span>
      </Tip>
      <span class="sr-only" role="status">
        {label}
      </span>
    </div>
  )
}
