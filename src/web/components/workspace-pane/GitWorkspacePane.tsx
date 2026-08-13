import { defineComponent } from 'vue'
import type { VNodeChild } from 'vue'
import type { PullRequestInfo } from '#/shared/git-types.ts'
import { RepoStatusFailureView } from '#/web/components/RepoStatusFailureView.tsx'
import { EmptyState } from '#/web/components/Layout.tsx'
import { WorkspacePaneSkeleton } from '#/web/components/Skeleton.tsx'
import { GitWorkspacePaneContent } from '#/web/components/repo-workspace/GitWorkspacePaneContent.tsx'
import { GitWorkspacePaneToolbar } from '#/web/components/repo-workspace/GitWorkspacePaneToolbar.tsx'
import { BranchActionSurfaceProvider } from '#/web/components/repo-workspace/branch-action-surface-context.ts'
import { getCurrentGitWorkspacePanePresentation } from '#/web/components/repo-workspace/model.ts'
import type {
  CurrentGitWorkspacePanePresentation,
  GitWorkspacePaneProjection,
  PullRequestReadPresentation,
} from '#/web/components/repo-workspace/model.ts'
import type {
  GitWorkspacePaneShell,
  WorkspacePaneRouteContext,
} from '#/web/components/workspace-pane/workspace-pane-types.ts'
import type { ParsedWorkspacePaneRoute } from '#/web/App.tsx'
import { projectBranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { useBranchActionItems } from '#/web/hooks/useBranchActionItems.tsx'
import { useBranchActionShortcutRegistry } from '#/web/hooks/useBranchActionShortcutRegistry.ts'
import { useBranchActions } from '#/web/hooks/useBranchActions.tsx'
import {
  useRepoOperationsReadModel,
  useRepoPullRequestsReadModel,
  useRepoSnapshotReadModel,
  useRepoWorktreeStatusReadModel,
} from '#/web/repo-queries.ts'
import { repoQueryReadFailure } from '#/web/repo-read-failure.ts'
import type { RepoReadFailure } from '#/web/repo-read-failure.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { refreshRepoWorktreeStatus } from '#/web/stores/workspaces/worktree-status-refresh.ts'
import { useGitWorkspacePaneRouteController } from '#/web/components/repo-workspace/git-workspace-pane-route-controller.ts'
import { useGitWorkspacePaneTabModel } from '#/web/workspace-pane/use-workspace-pane-tab-model.ts'
import { useT } from '#/web/stores/i18n-vue.ts'

interface GitWorkspacePaneProps {
  gitWorkspace: GitWorkspacePaneShell
  workspacePaneRouteContext: WorkspacePaneRouteContext
  workspacePaneId: string
  shortcutsEnabled: boolean
  toolbarTrafficLightOffset: boolean
  onBackToGitWorkspaceNavigator?: () => void
}

export const GitWorkspacePane = defineComponent<GitWorkspacePaneProps>({
  name: 'GitWorkspacePane',
  props: [
    'gitWorkspace',
    'workspacePaneRouteContext',
    'workspacePaneId',
    'shortcutsEnabled',
    'toolbarTrafficLightOffset',
    'onBackToGitWorkspaceNavigator',
  ],

  setup(props) {
    const t = useT()
    const snapshotReadModel = useRepoSnapshotReadModel(
      () => props.gitWorkspace.id,
      () => props.gitWorkspace.workspaceRuntimeId,
    )
    const operationsReadModel = useRepoOperationsReadModel(
      () => props.gitWorkspace.id,
      () => props.gitWorkspace.workspaceRuntimeId,
    )
    const statusReadModel = useRepoWorktreeStatusReadModel(
      () => props.gitWorkspace.id,
      () => props.gitWorkspace.workspaceRuntimeId,
    )

    function renderWorkspacePane(pullRequestProjection: BranchPullRequestProjection | null): VNodeChild {
      const currentBranchName = props.gitWorkspace.ui.currentBranchName
      const snapshot = snapshotReadModel.data.value?.snapshot
      if (!snapshot && snapshotReadModel.isError.value) {
        const snapshotError = snapshotReadModel.error.value
        return (
          <RepoStatusFailureView
            messageKey={snapshotError instanceof Error ? snapshotError.message : String(snapshotError)}
            retrying={snapshotReadModel.isFetching.value}
            onRetry={() => void snapshotReadModel.refetch()}
          />
        )
      }
      if (!snapshot) {
        return <WorkspacePaneSkeleton toolbarTrafficLightOffset={props.toolbarTrafficLightOffset} />
      }

      const pullRequest = pullRequestProjection?.pullRequest
      const pullRequestRead = pullRequestProjection?.read ?? NO_BRANCH_PULL_REQUEST_READ
      const statusSnapshot = statusReadModel.data.value
      const gitWorkspacePaneProjection: GitWorkspacePaneProjection = {
        ...projectBranchActionRepo(props.gitWorkspace, operationsReadModel.data.value?.operations, currentBranchName),
        snapshot,
        status: statusSnapshot?.status,
        probe: props.gitWorkspace.probe,
      }
      const statusError = statusReadModel.error.value
      const statusErrorKey =
        statusError instanceof Error ? statusError.message : statusError ? String(statusError) : null
      const detailBase = getCurrentGitWorkspacePanePresentation(
        gitWorkspacePaneProjection,
        {
          loading: statusReadModel.isPending.value || statusReadModel.isFetching.value,
          error: statusErrorKey,
          stale: !!statusSnapshot && statusReadModel.isError.value,
        },
        pullRequest,
        pullRequestRead,
      )
      const detail: CurrentGitWorkspacePanePresentation = {
        ...detailBase,
        loading: {
          ...detailBase.loading,
          pullRequests: pullRequestProjection?.loading ?? false,
        },
      }
      const snapshotReadFailure = repoQueryReadFailure(
        {
          isError: snapshotReadModel.isError.value,
          error: snapshotReadModel.error.value,
          isFetching: snapshotReadModel.isFetching.value,
          data: snapshotReadModel.data.value,
        },
        () => void snapshotReadModel.refetch(),
      )
      const snapshotReadFailures = snapshotReadFailure ? [snapshotReadFailure] : []

      if (props.workspacePaneRouteContext.kind === 'routed' && detail.worktree) {
        return <EmptyState title={t('workspace-route.not-found-title')} />
      }

      return (
        <section class="flex min-h-0 flex-1 flex-col bg-background">
          {detail.branch ? (
            <GitBranchActionWorkspacePane
              repo={gitWorkspacePaneProjection}
              detail={detail}
              workspacePaneRouteContext={props.workspacePaneRouteContext}
              branch={detail.branch}
              workspacePaneId={props.workspacePaneId}
              shortcutsEnabled={props.shortcutsEnabled}
              toolbarTrafficLightOffset={props.toolbarTrafficLightOffset}
              onBackToGitWorkspaceNavigator={props.onBackToGitWorkspaceNavigator}
              readFailures={snapshotReadFailures}
            />
          ) : (
            <GitWorkspacePaneSurface
              repo={gitWorkspacePaneProjection}
              detail={detail}
              workspacePaneRouteContext={props.workspacePaneRouteContext}
              workspacePaneId={props.workspacePaneId}
              toolbarTrafficLightOffset={props.toolbarTrafficLightOffset}
              onBackToGitWorkspaceNavigator={props.onBackToGitWorkspaceNavigator}
              readFailures={snapshotReadFailures}
            />
          )}
        </section>
      )
    }

    return () => {
      const currentBranchName = props.gitWorkspace.ui.currentBranchName
      return currentBranchName === null ? (
        renderWorkspacePane(null)
      ) : (
        <GitBranchWorkspacePaneReadModel
          repoId={props.gitWorkspace.id}
          workspaceRuntimeId={props.gitWorkspace.workspaceRuntimeId}
          branchName={currentBranchName}
          render={renderWorkspacePane}
        />
      )
    }
  },
})

interface BranchPullRequestProjection {
  pullRequest: PullRequestInfo | undefined
  read: PullRequestReadPresentation
  loading: boolean
}

interface GitBranchWorkspacePaneReadModelProps {
  repoId: GitWorkspacePaneShell['id']
  workspaceRuntimeId: string
  branchName: string
  render: (projection: BranchPullRequestProjection) => VNodeChild
}

const GitBranchWorkspacePaneReadModel = defineComponent<GitBranchWorkspacePaneReadModelProps>({
  name: 'GitBranchWorkspacePaneReadModel',
  inheritAttrs: false,
  props: ['repoId', 'workspaceRuntimeId', 'branchName', 'render'],
  setup(props) {
    const pullRequestsReadModel = useRepoPullRequestsReadModel(
      () => props.repoId,
      () => props.workspaceRuntimeId,
      () => ({ kind: 'branch-detail', branch: props.branchName }),
    )

    return () => {
      const data = pullRequestsReadModel.data.value
      const error = pullRequestsReadModel.error.value
      const errorKey = error instanceof Error ? error.message : error ? String(error) : null
      return props.render({
        pullRequest: data?.pullRequests?.[0]?.pullRequest,
        read: {
          state: !data
            ? pullRequestsReadModel.isError.value
              ? 'error'
              : 'pending'
            : data.pullRequests === null
              ? 'unavailable'
              : data.pullRequests.length === 0
                ? 'empty'
                : 'ready',
          stale: !!data && pullRequestsReadModel.isError.value,
          error: errorKey,
          retrying: pullRequestsReadModel.isFetching.value,
          retry: () => void pullRequestsReadModel.refetch(),
        },
        loading: pullRequestsReadModel.isPending.value || pullRequestsReadModel.isFetching.value,
      })
    }
  },
})

const NO_BRANCH_PULL_REQUEST_READ: PullRequestReadPresentation = {
  state: 'unavailable',
  stale: false,
  error: null,
  retrying: false,
  retry: () => {},
}

interface GitWorkspacePaneSurfaceProps {
  repo: GitWorkspacePaneProjection
  detail: CurrentGitWorkspacePanePresentation
  workspacePaneRouteContext: WorkspacePaneRouteContext
  workspacePaneId: string
  toolbarTrafficLightOffset?: boolean
  onBackToGitWorkspaceNavigator?: () => void
  readFailures: RepoReadFailure[]
}

const GitWorkspacePaneSurface = defineComponent<GitWorkspacePaneSurfaceProps>({
  name: 'GitWorkspacePaneSurface',
  props: [
    'repo',
    'detail',
    'workspacePaneRouteContext',
    'workspacePaneId',
    'toolbarTrafficLightOffset',
    'onBackToGitWorkspaceNavigator',
    'readFailures',
  ],

  setup(props) {
    const workspacePaneTabModel = useGitWorkspacePaneTabModel(
      () => props.repo,
      () => props.detail,
      () => workspacePaneRoute(props.workspacePaneRouteContext),
    )
    useGitWorkspacePaneRouteController({
      enabled: () => workspacePaneRoute(props.workspacePaneRouteContext) !== undefined,
      workspaceId: () => props.repo.id,
      branchName: () => props.detail.branch?.name ?? null,
      worktreePath: () => props.detail.worktree?.path ?? null,
      route: () => workspacePaneRoute(props.workspacePaneRouteContext) ?? null,
      model: workspacePaneTabModel,
    })

    return () => {
      const currentWorkspacePaneRoute = workspacePaneRoute(props.workspacePaneRouteContext)
      return (
        <>
          <GitWorkspacePaneToolbar
            repo={props.repo}
            detail={props.detail}
            workspacePaneId={props.workspacePaneId}
            workspacePaneRoute={currentWorkspacePaneRoute}
            trafficLightOffset={props.toolbarTrafficLightOffset ?? false}
            workspacePaneTabModel={workspacePaneTabModel.value}
            onBackToGitWorkspaceNavigator={props.onBackToGitWorkspaceNavigator}
          />
          <GitWorkspacePaneContent
            repo={props.repo}
            detail={props.detail}
            workspacePaneId={props.workspacePaneId}
            workspacePaneTabModel={workspacePaneTabModel.value}
            readFailures={props.readFailures}
            onBackToGitWorkspaceNavigator={props.onBackToGitWorkspaceNavigator}
            onRetryStatus={() => {
              void refreshRepoWorktreeStatus(
                { get: workspacesStore.getState },
                props.repo.id,
                props.repo.workspaceRuntimeId,
              )
            }}
          />
        </>
      )
    }
  },
})

interface GitBranchActionWorkspacePaneProps extends GitWorkspacePaneSurfaceProps {
  branch: NonNullable<CurrentGitWorkspacePanePresentation['branch']>
  shortcutsEnabled: boolean
}

const GitBranchActionWorkspacePane = defineComponent<GitBranchActionWorkspacePaneProps>({
  name: 'GitBranchActionWorkspacePane',
  props: [
    'repo',
    'detail',
    'workspacePaneRouteContext',
    'branch',
    'workspacePaneId',
    'shortcutsEnabled',
    'toolbarTrafficLightOffset',
    'onBackToGitWorkspaceNavigator',
    'readFailures',
  ],

  setup(props) {
    const branchActions = useBranchActions(
      () => props.repo,
      () => props.branch,
    )
    const actions = useBranchActionItems(
      () => props.repo,
      () => props.branch,
      () => branchActions,
      {
        workspacePaneRoute: () => workspacePaneRoute(props.workspacePaneRouteContext),
      },
    )
    useBranchActionShortcutRegistry(actions, () => props.shortcutsEnabled)

    return () => (
      <BranchActionSurfaceProvider value={actions.value}>
        <GitWorkspacePaneSurface
          repo={props.repo}
          detail={props.detail}
          workspacePaneRouteContext={props.workspacePaneRouteContext}
          workspacePaneId={props.workspacePaneId}
          toolbarTrafficLightOffset={props.toolbarTrafficLightOffset ?? false}
          onBackToGitWorkspaceNavigator={props.onBackToGitWorkspaceNavigator}
          readFailures={props.readFailures}
        />
      </BranchActionSurfaceProvider>
    )
  },
})

function workspacePaneRoute(context: WorkspacePaneRouteContext): ParsedWorkspacePaneRoute | null | undefined {
  return context.kind === 'routed' || context.kind === 'git-worktree' ? context.route : undefined
}
