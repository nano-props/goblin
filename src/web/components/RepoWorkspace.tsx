import { useId } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  getCurrentRepoWorkspacePresentation,
  type RepoWorkspaceRepo,
  type CurrentRepoWorkspacePresentation,
} from '#/web/components/repo-workspace/model.ts'
import { RepoWorkspaceToolbar } from '#/web/components/repo-workspace/RepoWorkspaceToolbar.tsx'
import { RepoWorkspaceContent } from '#/web/components/repo-workspace/RepoWorkspaceContent.tsx'
import { useRepoWorkspaceTabModel } from '#/web/components/repo-workspace/use-repo-workspace-tab-model.ts'
import { useWorkspacePaneVisibleStatusRefresh } from '#/web/components/repo-workspace/use-workspace-pane-visible-status-refresh.ts'
import { useBranchActionItems } from '#/web/hooks/useBranchActionItems.ts'
import { useBranchActionShortcutRegistry } from '#/web/hooks/useBranchActionShortcutRegistry.ts'
import { useBranchActions, type BranchActions } from '#/web/hooks/useBranchActions.tsx'
import { BranchActionSurfaceContext } from '#/web/components/repo-workspace/branch-action-surface-context.ts'
import { useRepoProjectionReadModel, useRepoWorktreeStatusReadModel } from '#/web/repo-data-query.ts'
import { repoBranchReadModelFromSnapshot } from '#/web/repo-branch-read-model.ts'
import { RepoWorkspaceSkeleton } from '#/web/components/Skeleton.tsx'
import { RepoStatusFailureView } from '#/web/components/RepoStatusFailureView.tsx'
import type { ParsedRepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import { useWorkspacePaneRouteController } from '#/web/components/repo-workspace/workspace-pane-route-controller.ts'
import { projectBranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { isRepoUnavailable } from '#/web/stores/repos/repo-guards.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'
import { refreshRepoWorktreeStatus } from '#/web/stores/repos/worktree-status-refresh.ts'

export type RepoWorkspacePaneRouteContext =
  { kind: 'routed'; route: ParsedRepoBranchWorkspacePaneRoute | null } | { kind: 'inactive' }

interface Props {
  repoId: string
  currentBranchName?: string | null
  workspacePaneRouteContext: RepoWorkspacePaneRouteContext
  shortcutsEnabled?: boolean
  toolbarTrafficLightOffset?: boolean
  onBackToBranchNavigator?: () => void
}

// Keep this equality in sync with fields read by RepoWorkspace children.
type RepoWorkspaceRepoShell = Omit<RepoWorkspaceRepo, 'branchModel' | 'branchAction'> & {
  operations: Pick<RepoState['operations'], 'branchAction'>
}

function repoWorkspaceRepoShellEqual(
  a: RepoWorkspaceRepoShell | undefined,
  b: RepoWorkspaceRepoShell | undefined,
): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.id === b.id &&
      a.repoRuntimeId === b.repoRuntimeId &&
      a.ui.currentBranchName === b.ui.currentBranchName &&
      a.ui.preferredWorkspacePaneTabByTarget === b.ui.preferredWorkspacePaneTabByTarget &&
      a.unavailable === b.unavailable &&
      a.operations.branchAction === b.operations.branchAction &&
      a.remote.lifecycle === b.remote.lifecycle &&
      a.remote.hasRemotes === b.remote.hasRemotes &&
      a.remote.hasBrowserRemote === b.remote.hasBrowserRemote &&
      a.remote.hasGitHubRemote === b.remote.hasGitHubRemote &&
      a.remote.browserRemoteProvider === b.remote.browserRemoteProvider &&
      a.remote.remoteProviders === b.remote.remoteProviders)
  )
}

export function RepoWorkspace({
  repoId,
  currentBranchName,
  workspacePaneRouteContext,
  shortcutsEnabled = true,
  toolbarTrafficLightOffset = false,
  onBackToBranchNavigator,
}: Props) {
  const workspacePaneId = useId()
  const repoShell = useStoreWithEqualityFn(
    useReposStore,
    (s) => {
      const repo = s.repos[repoId]
      const currentBranch = repo ? (currentBranchName ?? null) : null
      return repo
        ? {
            id: repo.id,
            repoRuntimeId: repo.repoRuntimeId,
            ui: {
              currentBranchName: currentBranch,
              preferredWorkspacePaneTabByTarget: repo.ui.preferredWorkspacePaneTabByTarget,
            },
            unavailable: isRepoUnavailable(repo),
            operations: {
              branchAction: repo.operations.branchAction,
            },
            remote: {
              lifecycle: repo.remote.lifecycle,
              hasRemotes: repo.remote.hasRemotes,
              hasBrowserRemote: repo.remote.hasBrowserRemote,
              hasGitHubRemote: repo.remote.hasGitHubRemote,
              browserRemoteProvider: repo.remote.browserRemoteProvider,
              remoteProviders: repo.remote.remoteProviders,
            },
          }
        : undefined
    },
    repoWorkspaceRepoShellEqual,
  )
  if (!repoShell) return null

  return (
    <RepoWorkspaceLoaded
      repoShell={repoShell}
      workspacePaneRouteContext={workspacePaneRouteContext}
      workspacePaneId={workspacePaneId}
      shortcutsEnabled={shortcutsEnabled}
      toolbarTrafficLightOffset={toolbarTrafficLightOffset}
      onBackToBranchNavigator={onBackToBranchNavigator}
    />
  )
}

function RepoWorkspaceLoaded({
  repoShell,
  workspacePaneRouteContext,
  workspacePaneId,
  shortcutsEnabled,
  toolbarTrafficLightOffset,
  onBackToBranchNavigator,
}: {
  repoShell: RepoWorkspaceRepoShell
  workspacePaneRouteContext: RepoWorkspacePaneRouteContext
  workspacePaneId: string
  shortcutsEnabled: boolean
  toolbarTrafficLightOffset: boolean
  onBackToBranchNavigator?: () => void
}) {
  const currentBranchName = repoShell.ui.currentBranchName
  const projectionReadModel = useRepoProjectionReadModel(
    repoShell.id,
    repoShell.repoRuntimeId,
    currentBranchName,
    'full',
    true,
  )
  const projection = projectionReadModel.data
  const statusReadModel = useRepoWorktreeStatusReadModel(repoShell.id, repoShell.repoRuntimeId, true)
  const statusSnapshot = statusReadModel.data
  if (projection?.snapshot && !statusSnapshot && statusReadModel.isError) {
    const statusErrorKey =
      statusReadModel.error instanceof Error ? statusReadModel.error.message : String(statusReadModel.error)
    return (
      <section className="flex min-h-0 flex-1 flex-col bg-background">
        <RepoStatusFailureView
          messageKey={statusErrorKey}
          retrying={statusReadModel.isFetching}
          onRetry={() => {
            void refreshRepoWorktreeStatus(
              { get: useReposStore.getState, set: useReposStore.setState },
              repoShell.id,
              repoShell.repoRuntimeId,
            )
          }}
        />
      </section>
    )
  }
  const branchReadModel =
    projection?.snapshot && statusSnapshot
      ? repoBranchReadModelFromSnapshot(projection.snapshot, statusSnapshot.status)
      : null
  if (!branchReadModel || !projection) {
    return <RepoWorkspaceSkeleton toolbarTrafficLightOffset={toolbarTrafficLightOffset} />
  }
  let presentationBranchModel: RepoWorkspaceRepo['branchModel'] = branchReadModel
  if (currentBranchName && Array.isArray(projection.pullRequests)) {
    const pullRequest = projection.pullRequests.find((entry) => entry.branch === currentBranchName)?.pullRequest
    presentationBranchModel = {
      ...presentationBranchModel,
      branches: presentationBranchModel.branches.map((branch) => {
        if (branch.name !== currentBranchName) return branch
        if (pullRequest) return { ...branch, pullRequest }
        const { pullRequest: _pullRequest, ...branchWithoutPullRequest } = branch
        return branchWithoutPullRequest
      }),
    }
  }
  const presentationRepo: RepoWorkspaceRepo = {
    ...projectBranchActionRepo(repoShell, projection.operations.operations, currentBranchName),
    branchModel: presentationBranchModel,
  }
  const statusError = statusReadModel.error
  const statusErrorKey = statusError instanceof Error ? statusError.message : statusError ? String(statusError) : null
  const detailBase = getCurrentRepoWorkspacePresentation(presentationRepo, {
    loading: statusReadModel.isFetching,
    error: statusErrorKey,
    stale: !!statusSnapshot && statusReadModel.isError,
  })
  const detail: CurrentRepoWorkspacePresentation = {
    ...detailBase,
    loading: {
      ...detailBase.loading,
      pullRequests: projectionReadModel.isFetching && !projectionReadModel.dataUpdatedAt,
    },
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      {detail.branch ? (
        <BranchActionWorkspacePane
          repo={presentationRepo}
          detail={detail}
          workspacePaneRouteContext={workspacePaneRouteContext}
          branch={detail.branch}
          workspacePaneId={workspacePaneId}
          shortcutsEnabled={shortcutsEnabled}
          toolbarTrafficLightOffset={toolbarTrafficLightOffset}
          onBackToBranchNavigator={onBackToBranchNavigator}
        />
      ) : (
        <RepoWorkspacePane
          repo={presentationRepo}
          detail={detail}
          workspacePaneRouteContext={workspacePaneRouteContext}
          workspacePaneId={workspacePaneId}
          toolbarTrafficLightOffset={toolbarTrafficLightOffset}
          onBackToBranchNavigator={onBackToBranchNavigator}
        />
      )}
    </section>
  )
}

interface RepoWorkspacePaneProps {
  repo: RepoWorkspaceRepo
  detail: CurrentRepoWorkspacePresentation
  workspacePaneRouteContext: RepoWorkspacePaneRouteContext
  workspacePaneId: string
  toolbarTrafficLightOffset?: boolean
  branchActions?: BranchActions
  onBackToBranchNavigator?: () => void
}

function RepoWorkspacePane({
  repo,
  detail,
  workspacePaneRouteContext,
  workspacePaneId,
  toolbarTrafficLightOffset = false,
  branchActions,
  onBackToBranchNavigator,
}: RepoWorkspacePaneProps) {
  const workspacePaneRoute = workspacePaneRouteContext.kind === 'routed' ? workspacePaneRouteContext.route : undefined
  const routeControllerRoute = workspacePaneRouteContext.kind === 'routed' ? workspacePaneRouteContext.route : null
  const workspacePaneTabModel = useRepoWorkspaceTabModel(repo, detail, workspacePaneRoute)
  useWorkspacePaneVisibleStatusRefresh({
    repoId: repo.id,
    repoRuntimeId: repo.repoRuntimeId,
    branchName: workspacePaneTabModel.branchName,
    renderedTab: workspacePaneTabModel.renderedTab,
    unavailable: repo.unavailable,
  })
  useWorkspacePaneRouteController({
    enabled: workspacePaneRouteContext.kind === 'routed',
    repoId: repo.id,
    branchName: detail.branch?.name ?? null,
    worktreePath: detail.branch?.worktree?.path ?? null,
    route: routeControllerRoute,
    model: workspacePaneTabModel,
  })

  return (
    <>
      <RepoWorkspaceToolbar
        repo={repo}
        detail={detail}
        workspacePaneId={workspacePaneId}
        workspacePaneRoute={workspacePaneRoute}
        trafficLightOffset={toolbarTrafficLightOffset}
        workspacePaneTabModel={workspacePaneTabModel}
        branchActions={branchActions}
        onBackToBranchNavigator={onBackToBranchNavigator}
      />
      <RepoWorkspaceContent
        repo={repo}
        detail={detail}
        workspacePaneId={workspacePaneId}
        workspacePaneTabModel={workspacePaneTabModel}
        onRetryStatus={() => {
          void refreshRepoWorktreeStatus(
            { get: useReposStore.getState, set: useReposStore.setState },
            repo.id,
            repo.repoRuntimeId,
          )
        }}
      />
    </>
  )
}

interface BranchActionWorkspacePaneProps {
  repo: RepoWorkspaceRepo
  detail: CurrentRepoWorkspacePresentation
  workspacePaneRouteContext: RepoWorkspacePaneRouteContext
  branch: NonNullable<CurrentRepoWorkspacePresentation['branch']>
  workspacePaneId: string
  shortcutsEnabled: boolean
  toolbarTrafficLightOffset?: boolean
  onBackToBranchNavigator?: () => void
}

function BranchActionWorkspacePane({
  repo,
  detail,
  workspacePaneRouteContext,
  branch,
  workspacePaneId,
  shortcutsEnabled,
  toolbarTrafficLightOffset = false,
  onBackToBranchNavigator,
}: BranchActionWorkspacePaneProps) {
  const workspacePaneRoute = workspacePaneRouteContext.kind === 'routed' ? workspacePaneRouteContext.route : undefined
  const branchActions = useBranchActions(repo, branch)
  const actions = useBranchActionItems(repo, branch, branchActions, { workspacePaneRoute })
  useBranchActionShortcutRegistry(actions, shortcutsEnabled)

  return (
    <BranchActionSurfaceContext value={actions}>
      <RepoWorkspacePane
        repo={repo}
        detail={detail}
        workspacePaneRouteContext={workspacePaneRouteContext}
        workspacePaneId={workspacePaneId}
        toolbarTrafficLightOffset={toolbarTrafficLightOffset}
        branchActions={branchActions}
        onBackToBranchNavigator={onBackToBranchNavigator}
      />
    </BranchActionSurfaceContext>
  )
}
