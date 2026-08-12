import { FolderTree, LayoutDashboard } from '@lucide/vue'
import { computed, defineComponent } from 'vue'
import type { FunctionalComponent, VNodeChild } from 'vue'
import { workspaceNameFromLocator } from '#/shared/workspace-display-location.ts'
import type { WorkspaceDirectoryOverview } from '#/shared/workspace-overview.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { RepoReadNotice } from '#/web/components/RepoReadNotice.tsx'
import { RepoStatusFailureView } from '#/web/components/RepoStatusFailureView.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { DirectoryOverviewContent } from '#/web/components/workspace-pages/DirectoryOverviewContent.tsx'
import { WorkspaceDashboardTerminals } from '#/web/components/workspace-pages/WorkspaceDashboardTerminals.tsx'
import {
  DashboardAttention,
  DashboardHeader,
  DashboardRecentBranches,
  DashboardStats,
} from '#/web/components/workspace-pages/WorkspaceDashboardSections.tsx'
import { WorkspacePagePane } from '#/web/components/workspace-pages/WorkspacePagePane.tsx'
import { DASHBOARD_CARD_CLASS, DashboardSection } from '#/web/components/workspace-pages/dashboard-ui.tsx'
import { buildDashboardSummary } from '#/web/components/workspace-pages/workspace-dashboard-model.ts'
import type { DashboardPullRequestState } from '#/web/components/workspace-pages/workspace-dashboard-model.ts'
import { cn } from '#/web/lib/cn.ts'
import { formatWorkspaceDisplayLocation } from '#/web/lib/paths.ts'
import { repoQueryReadFailure } from '#/web/repo-read-failure.ts'
import {
  useRepoPullRequestsReadModel,
  useRepoSnapshotReadModel,
  useRepoWorktreeStatusReadModel,
} from '#/web/repo-queries.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { remoteWorkspaceTarget } from '#/web/stores/workspaces/workspace-guards.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { refreshRepoWorktreeStatus } from '#/web/stores/workspaces/worktree-status-refresh.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { useWorkspaceDirectoryOverview } from '#/web/workspace-directory-overview-query.ts'

interface WorkspaceDashboardPaneProps {
  workspaceId: WorkspaceId
  compact?: boolean
  trafficLightOffset?: boolean
  onBack?: () => void
  onOpenWorkspaceRoot?: () => void
  onSelectBranch?: (branchName: string) => void
}

export const WorkspaceDashboardPane = defineComponent<WorkspaceDashboardPaneProps>({
  name: 'WorkspaceDashboardPane',
  props: ['workspaceId', 'compact', 'trafficLightOffset', 'onBack', 'onOpenWorkspaceRoot', 'onSelectBranch'],

  setup(props) {
    const t = useT()
    const workspaces = useStoreSelector(workspacesStore, (state) => state.workspaces)
    const workspace = computed(() => {
      const state = workspaces.value[props.workspaceId]
      return state
        ? {
            id: state.id,
            workspaceRuntimeId: state.workspaceRuntimeId,
            admission: state.admission,
            capability: state.capability,
          }
        : null
    })

    function renderDashboardContent(
      currentWorkspace: DashboardWorkspaceProjection | null,
      compact: boolean,
    ): VNodeChild {
      if (currentWorkspace?.capability.kind === 'filesystem') {
        return (
          <DirectoryDashboardReadModel
            workspace={currentWorkspace}
            compact={compact}
            onOpenWorkspaceRoot={props.onOpenWorkspaceRoot}
          />
        )
      }

      const gitWorkspace = isGitDashboardWorkspace(currentWorkspace) ? currentWorkspace : null
      if (gitWorkspace) {
        return (
          <GitDashboardReadModel workspace={gitWorkspace} compact={compact} onSelectBranch={props.onSelectBranch} />
        )
      }

      return <div class={cn(DASHBOARD_CARD_CLASS, 'p-4 text-sm text-muted-foreground')}>{t('dashboard.loading')}</div>
    }

    return () => {
      const currentWorkspace = workspace.value
      const compact = props.compact ?? false

      return (
        <WorkspacePagePane
          icon={LayoutDashboard}
          label={t('workspace.dashboard')}
          compact={compact}
          trafficLightOffset={props.trafficLightOffset ?? false}
          onBack={props.onBack}
        >
          <ScrollArea class="min-h-0 flex-1 bg-background">
            <div class="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-5">
              {renderDashboardContent(currentWorkspace, compact)}
              {currentWorkspace ? <WorkspaceDashboardTerminals workspaceId={currentWorkspace.id} /> : null}
            </div>
          </ScrollArea>
        </WorkspacePagePane>
      )
    }
  },
})

type DashboardWorkspaceProjection = Pick<WorkspaceState, 'id' | 'workspaceRuntimeId' | 'admission' | 'capability'>
type GitDashboardWorkspace = Omit<DashboardWorkspaceProjection, 'capability'> & {
  capability: Extract<WorkspaceState['capability'], { kind: 'git' }>
}

function isGitDashboardWorkspace(workspace: DashboardWorkspaceProjection | null): workspace is GitDashboardWorkspace {
  return workspace?.capability.kind === 'git'
}

const GitDashboardReadModel = defineComponent<{
  workspace: GitDashboardWorkspace
  compact: boolean
  onSelectBranch?: (branchName: string) => void
}>({
  name: 'GitDashboardReadModel',
  props: ['workspace', 'compact', 'onSelectBranch'],

  setup(props) {
    const t = useT()
    const snapshotReadModel = useRepoSnapshotReadModel(
      () => props.workspace.id,
      () => props.workspace.workspaceRuntimeId,
    )
    const pullRequestsReadModel = useRepoPullRequestsReadModel(
      () => props.workspace.id,
      () => props.workspace.workspaceRuntimeId,
      { kind: 'repository-summary' },
    )
    const statusReadModel = useRepoWorktreeStatusReadModel(
      () => props.workspace.id,
      () => props.workspace.workspaceRuntimeId,
    )
    const branchModel = computed(() => {
      const snapshot = snapshotReadModel.data.value?.snapshot
      return snapshot ? { snapshot, status: statusReadModel.data.value?.status } : null
    })
    const pullRequestState = computed<DashboardPullRequestState>(() => {
      const data = pullRequestsReadModel.data.value
      if (!data) return pullRequestsReadModel.isError.value ? 'error' : 'pending'
      if (pullRequestsReadModel.isError.value) return 'stale'
      if (data.pullRequests === null) return 'unavailable'
      return data.pullRequests.length === 0 ? 'empty' : 'ready'
    })
    const summary = computed(() =>
      branchModel.value
        ? buildDashboardSummary(branchModel.value, pullRequestsReadModel.data.value?.pullRequests)
        : null,
    )

    function retryStatus(): void {
      void refreshRepoWorktreeStatus(
        { get: workspacesStore.getState },
        props.workspace.id,
        props.workspace.workspaceRuntimeId,
      )
    }

    return () => {
      const currentBranchModel = branchModel.value
      const currentSummary = summary.value
      const snapshot = snapshotReadModel.data.value?.snapshot
      const snapshotError = snapshotReadModel.error.value
      const snapshotErrorKey = snapshotError instanceof Error ? snapshotError.message : String(snapshotError ?? '')
      if (!snapshot && snapshotReadModel.isError.value) {
        return (
          <RepoStatusFailureView
            messageKey={snapshotErrorKey || 'error.failed-read-repo'}
            retrying={snapshotReadModel.isFetching.value}
            onRetry={() => void snapshotReadModel.refetch()}
          />
        )
      }
      if (!currentBranchModel || !currentSummary) {
        return <div class={cn(DASHBOARD_CARD_CLASS, 'p-4 text-sm text-muted-foreground')}>{t('dashboard.loading')}</div>
      }

      const readFailures = [
        repoQueryReadFailure(
          {
            isError: snapshotReadModel.isError.value,
            error: snapshotReadModel.error.value,
            isFetching: snapshotReadModel.isFetching.value,
            data: snapshotReadModel.data.value,
          },
          () => void snapshotReadModel.refetch(),
        ),
        repoQueryReadFailure(
          {
            isError: statusReadModel.isError.value,
            error: statusReadModel.error.value,
            isFetching: statusReadModel.isFetching.value,
            data: statusReadModel.data.value,
          },
          retryStatus,
        ),
        repoQueryReadFailure(
          {
            isError: pullRequestsReadModel.isError.value,
            error: pullRequestsReadModel.error.value,
            isFetching: pullRequestsReadModel.isFetching.value,
            data: pullRequestsReadModel.data.value,
          },
          () => void pullRequestsReadModel.refetch(),
        ),
      ].filter((failure) => failure !== null)

      return (
        <>
          <RepoReadNotice failures={readFailures} />
          <DashboardHeader
            workspace={props.workspace}
            remote={currentBranchModel.snapshot.remote}
            currentBranch={currentBranchModel.snapshot.current}
          />
          <DashboardStats compact={props.compact} summary={currentSummary} pullRequestState={pullRequestState.value} />
          <div
            class={cn(
              'grid gap-4',
              props.compact || currentSummary.attentionBranches.length === 0
                ? 'grid-cols-1'
                : 'xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]',
            )}
          >
            <DashboardAttention
              branchModel={currentBranchModel}
              summary={currentSummary}
              onSelectBranch={props.onSelectBranch}
            />
            <DashboardRecentBranches
              branchModel={currentBranchModel}
              branches={currentSummary.recentBranches}
              onSelectBranch={props.onSelectBranch}
            />
          </div>
        </>
      )
    }
  },
})

const DirectoryDashboardReadModel = defineComponent<{
  workspace: DashboardWorkspaceProjection
  compact: boolean
  onOpenWorkspaceRoot?: () => void
}>({
  name: 'DirectoryDashboardReadModel',
  props: ['workspace', 'compact', 'onOpenWorkspaceRoot'],
  setup(props) {
    const t = useT()
    const overviewReadModel = useWorkspaceDirectoryOverview(
      () => props.workspace.id,
      () => props.workspace.workspaceRuntimeId,
      true,
    )
    return () =>
      overviewReadModel.data.value ? (
        <DirectoryDashboard
          workspace={props.workspace}
          overview={overviewReadModel.data.value}
          compact={props.compact}
          onOpenWorkspaceRoot={props.onOpenWorkspaceRoot}
        />
      ) : overviewReadModel.isError.value ? (
        <div class={cn(DASHBOARD_CARD_CLASS, 'p-4 text-sm text-destructive')}>
          {t('dashboard.directory.read-failed')}
        </div>
      ) : (
        <div class={cn(DASHBOARD_CARD_CLASS, 'p-4 text-sm text-muted-foreground')}>{t('dashboard.loading')}</div>
      )
  },
})

interface DirectoryDashboardProps {
  workspace: Pick<WorkspaceState, 'id' | 'admission'>
  overview: WorkspaceDirectoryOverview
  compact: boolean
  onOpenWorkspaceRoot?: () => void
}

const DirectoryDashboard: FunctionalComponent<DirectoryDashboardProps> = (props) => {
  const t = useT()
  const displayLocation = formatWorkspaceDisplayLocation(
    props.workspace.id,
    remoteWorkspaceTarget(
      props.workspace.id,
      props.workspace.admission.kind === 'remote' ? props.workspace.admission.lifecycle : null,
    ),
  )
  return (
    <>
      <div class={cn(DASHBOARD_CARD_CLASS, 'p-4')}>
        <h1 class="truncate text-base font-semibold text-foreground">{workspaceNameFromLocator(props.workspace.id)}</h1>
        <div class="mt-1 truncate text-xs text-muted-foreground" title={displayLocation}>
          {displayLocation}
        </div>
      </div>
      <DirectoryOverviewContent overview={props.overview} compact={props.compact} />
      <DashboardSection title={t('dashboard.directory.working-directory')}>
        <button
          type="button"
          class={cn(
            'flex w-full min-w-0 items-center gap-3 px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45',
            props.onOpenWorkspaceRoot ? 'hover:bg-accent/45' : 'cursor-default',
          )}
          disabled={!props.onOpenWorkspaceRoot}
          onClick={() => props.onOpenWorkspaceRoot?.()}
        >
          <FolderTree size={16} class="shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium text-foreground" title={displayLocation}>
              {displayLocation}
            </span>
            <span class="block truncate text-xs text-muted-foreground">{t('dashboard.directory.open-files')}</span>
          </span>
        </button>
      </DashboardSection>
    </>
  )
}

DirectoryDashboard.props = ['workspace', 'overview', 'compact', 'onOpenWorkspaceRoot']
