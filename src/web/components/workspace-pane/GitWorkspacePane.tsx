import {
  getCurrentGitWorkspacePanePresentation,
  type CurrentGitWorkspacePanePresentation,
  type GitWorkspacePaneProjection,
  type PullRequestReadPresentation,
} from '#/web/components/repo-workspace/model.ts'
import { GitWorkspacePaneContent } from '#/web/components/repo-workspace/GitWorkspacePaneContent.tsx'
import { GitWorkspacePaneToolbar } from '#/web/components/repo-workspace/GitWorkspacePaneToolbar.tsx'
import { BranchActionSurfaceContext } from '#/web/components/repo-workspace/branch-action-surface-context.ts'
import { RepoStatusFailureView } from '#/web/components/RepoStatusFailureView.tsx'
import { repoQueryReadFailure, type RepoReadFailure } from '#/web/repo-read-failure.ts'
import { WorkspacePaneSkeleton } from '#/web/components/Skeleton.tsx'
import type {
  GitWorkspacePaneShell,
  WorkspacePaneRouteContext,
} from '#/web/components/workspace-pane/workspace-pane-types.ts'
import { projectBranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { useBranchActionItems } from '#/web/hooks/useBranchActionItems.ts'
import { useBranchActionShortcutRegistry } from '#/web/hooks/useBranchActionShortcutRegistry.ts'
import { useBranchActions } from '#/web/hooks/useBranchActions.tsx'
import {
  useRepoOperationsReadModel,
  useRepoPullRequestsReadModel,
  useRepoSnapshotReadModel,
  useRepoWorktreeStatusReadModel,
} from '#/web/repo-queries.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { refreshRepoWorktreeStatus } from '#/web/stores/workspaces/worktree-status-refresh.ts'
import { useGitWorkspacePaneRouteController } from '#/web/components/repo-workspace/git-workspace-pane-route-controller.ts'
import { useGitWorkspacePaneTabModel } from '#/web/workspace-pane/use-workspace-pane-tab-model.ts'

export function GitWorkspacePane({
  gitWorkspace,
  workspacePaneRouteContext,
  workspacePaneId,
  shortcutsEnabled,
  toolbarTrafficLightOffset,
  onBackToBranchNavigator,
}: {
  gitWorkspace: GitWorkspacePaneShell
  workspacePaneRouteContext: WorkspacePaneRouteContext
  workspacePaneId: string
  shortcutsEnabled: boolean
  toolbarTrafficLightOffset: boolean
  onBackToBranchNavigator?: () => void
}) {
  const currentBranchName = gitWorkspace.ui.currentBranchName
  const snapshotReadModel = useRepoSnapshotReadModel(gitWorkspace.id, gitWorkspace.workspaceRuntimeId, true)
  const snapshot = snapshotReadModel.data?.snapshot
  const pullRequestsReadModel = useRepoPullRequestsReadModel(
    gitWorkspace.id,
    gitWorkspace.workspaceRuntimeId,
    { kind: 'branch-detail', branch: currentBranchName ?? '' },
    currentBranchName !== null,
  )
  const operationsReadModel = useRepoOperationsReadModel(gitWorkspace.id, gitWorkspace.workspaceRuntimeId)
  const statusReadModel = useRepoWorktreeStatusReadModel(gitWorkspace.id, gitWorkspace.workspaceRuntimeId, true)
  const statusSnapshot = statusReadModel.data
  if (!snapshot && snapshotReadModel.isError) {
    const snapshotError = snapshotReadModel.error
    const messageKey = snapshotError instanceof Error ? snapshotError.message : String(snapshotError)
    return (
      <RepoStatusFailureView
        messageKey={messageKey}
        retrying={snapshotReadModel.isFetching}
        onRetry={() => void snapshotReadModel.refetch()}
      />
    )
  }
  if (!snapshot) {
    return <WorkspacePaneSkeleton toolbarTrafficLightOffset={toolbarTrafficLightOffset} />
  }
  const pullRequest = pullRequestsReadModel.data?.pullRequests?.[0]?.pullRequest
  const pullRequestError = pullRequestsReadModel.error
  const pullRequestErrorKey =
    pullRequestError instanceof Error ? pullRequestError.message : pullRequestError ? String(pullRequestError) : null
  const pullRequestRead: PullRequestReadPresentation = {
    state: !pullRequestsReadModel.data
      ? pullRequestsReadModel.isError
        ? 'error'
        : 'pending'
      : pullRequestsReadModel.data.pullRequests === null
        ? 'unavailable'
        : pullRequestsReadModel.data.pullRequests.length === 0
          ? 'empty'
          : 'ready',
    stale: !!pullRequestsReadModel.data && pullRequestsReadModel.isError,
    error: pullRequestErrorKey,
    retrying: pullRequestsReadModel.isFetching,
    retry: () => void pullRequestsReadModel.refetch(),
  }
  const gitWorkspacePaneProjection: GitWorkspacePaneProjection = {
    ...projectBranchActionRepo(gitWorkspace, operationsReadModel.data?.operations, currentBranchName),
    snapshot,
    status: statusSnapshot?.status,
    probe: gitWorkspace.probe,
  }
  const statusError = statusReadModel.error
  const statusErrorKey = statusError instanceof Error ? statusError.message : statusError ? String(statusError) : null
  const detailBase = getCurrentGitWorkspacePanePresentation(
    gitWorkspacePaneProjection,
    {
      loading: statusReadModel.isPending || statusReadModel.isFetching,
      error: statusErrorKey,
      stale: !!statusSnapshot && statusReadModel.isError,
    },
    pullRequest,
    pullRequestRead,
  )
  const detail: CurrentGitWorkspacePanePresentation = {
    ...detailBase,
    loading: {
      ...detailBase.loading,
      pullRequests: pullRequestsReadModel.isPending || pullRequestsReadModel.isFetching,
    },
  }
  const snapshotReadFailure = repoQueryReadFailure(snapshotReadModel, () => void snapshotReadModel.refetch())
  const snapshotReadFailures = snapshotReadFailure ? [snapshotReadFailure] : []

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      {detail.branch ? (
        <GitBranchActionWorkspacePane
          repo={gitWorkspacePaneProjection}
          detail={detail}
          workspacePaneRouteContext={workspacePaneRouteContext}
          branch={detail.branch}
          workspacePaneId={workspacePaneId}
          shortcutsEnabled={shortcutsEnabled}
          toolbarTrafficLightOffset={toolbarTrafficLightOffset}
          onBackToBranchNavigator={onBackToBranchNavigator}
          readFailures={snapshotReadFailures}
        />
      ) : (
        <GitWorkspacePaneSurface
          repo={gitWorkspacePaneProjection}
          detail={detail}
          workspacePaneRouteContext={workspacePaneRouteContext}
          workspacePaneId={workspacePaneId}
          toolbarTrafficLightOffset={toolbarTrafficLightOffset}
          onBackToBranchNavigator={onBackToBranchNavigator}
          readFailures={snapshotReadFailures}
        />
      )}
    </section>
  )
}

interface GitWorkspacePaneSurfaceProps {
  repo: GitWorkspacePaneProjection
  detail: CurrentGitWorkspacePanePresentation
  workspacePaneRouteContext: WorkspacePaneRouteContext
  workspacePaneId: string
  toolbarTrafficLightOffset?: boolean
  onBackToBranchNavigator?: () => void
  readFailures: RepoReadFailure[]
}

function GitWorkspacePaneSurface({
  repo,
  detail,
  workspacePaneRouteContext,
  workspacePaneId,
  toolbarTrafficLightOffset = false,
  onBackToBranchNavigator,
  readFailures,
}: GitWorkspacePaneSurfaceProps) {
  const workspacePaneRoute = workspacePaneRouteContext.kind === 'routed' ? workspacePaneRouteContext.route : undefined
  const routeControllerRoute = workspacePaneRouteContext.kind === 'routed' ? workspacePaneRouteContext.route : null
  const workspacePaneTabModel = useGitWorkspacePaneTabModel(repo, detail, workspacePaneRoute)
  useGitWorkspacePaneRouteController({
    enabled: workspacePaneRouteContext.kind === 'routed',
    workspaceId: repo.id,
    branchName: detail.branch?.name ?? null,
    worktreePath: detail.branch?.worktree?.path ?? null,
    route: routeControllerRoute,
    model: workspacePaneTabModel,
  })

  return (
    <>
      <GitWorkspacePaneToolbar
        repo={repo}
        detail={detail}
        workspacePaneId={workspacePaneId}
        workspacePaneRoute={workspacePaneRoute}
        trafficLightOffset={toolbarTrafficLightOffset}
        workspacePaneTabModel={workspacePaneTabModel}
        onBackToBranchNavigator={onBackToBranchNavigator}
      />
      <GitWorkspacePaneContent
        repo={repo}
        detail={detail}
        workspacePaneId={workspacePaneId}
        workspacePaneTabModel={workspacePaneTabModel}
        readFailures={readFailures}
        onBackToBranchNavigator={onBackToBranchNavigator}
        onRetryStatus={() => {
          void refreshRepoWorktreeStatus({ get: useWorkspacesStore.getState }, repo.id, repo.workspaceRuntimeId)
        }}
      />
    </>
  )
}

interface GitBranchActionWorkspacePaneProps {
  repo: GitWorkspacePaneProjection
  detail: CurrentGitWorkspacePanePresentation
  workspacePaneRouteContext: WorkspacePaneRouteContext
  branch: NonNullable<CurrentGitWorkspacePanePresentation['branch']>
  workspacePaneId: string
  shortcutsEnabled: boolean
  toolbarTrafficLightOffset?: boolean
  onBackToBranchNavigator?: () => void
  readFailures: RepoReadFailure[]
}

function GitBranchActionWorkspacePane({
  repo,
  detail,
  workspacePaneRouteContext,
  branch,
  workspacePaneId,
  shortcutsEnabled,
  toolbarTrafficLightOffset = false,
  onBackToBranchNavigator,
  readFailures,
}: GitBranchActionWorkspacePaneProps) {
  const workspacePaneRoute = workspacePaneRouteContext.kind === 'routed' ? workspacePaneRouteContext.route : undefined
  const branchActions = useBranchActions(repo, branch)
  const actions = useBranchActionItems(repo, branch, branchActions, { workspacePaneRoute })
  useBranchActionShortcutRegistry(actions, shortcutsEnabled)

  return (
    <BranchActionSurfaceContext value={actions}>
      <GitWorkspacePaneSurface
        repo={repo}
        detail={detail}
        workspacePaneRouteContext={workspacePaneRouteContext}
        workspacePaneId={workspacePaneId}
        toolbarTrafficLightOffset={toolbarTrafficLightOffset}
        onBackToBranchNavigator={onBackToBranchNavigator}
        readFailures={readFailures}
      />
    </BranchActionSurfaceContext>
  )
}
