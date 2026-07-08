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
import { useBranchActionItems } from '#/web/hooks/useBranchActionItems.ts'
import { useBranchActionShortcutRegistry } from '#/web/hooks/useBranchActionShortcutRegistry.ts'
import { useBranchActions, type BranchActions } from '#/web/hooks/useBranchActions.tsx'
import { BranchActionSurfaceContext } from '#/web/components/repo-workspace/branch-action-surface-context.ts'
import { useRepoProjectionReadModel } from '#/web/repo-data-query.ts'
import { repoBranchReadModelFromSnapshot } from '#/web/repo-branch-read-model.ts'
import { RepoWorkspaceSkeleton } from '#/web/components/Skeleton.tsx'
import type { RepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import { useWorkspacePaneRouteController } from '#/web/components/repo-workspace/workspace-pane-route-controller.ts'
import { projectBranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'

export type RepoWorkspacePaneRouteContext =
  | { kind: 'routed'; route: RepoBranchWorkspacePaneRoute | null }
  | { kind: 'inactive' }

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
      a.instanceId === b.instanceId &&
      a.ui.currentBranchName === b.ui.currentBranchName &&
      a.ui.preferredWorkspacePaneTabByTarget === b.ui.preferredWorkspacePaneTabByTarget &&
      a.dataLoads.visibleStatus === b.dataLoads.visibleStatus &&
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
            instanceId: repo.instanceId,
            ui: {
              currentBranchName: currentBranch,
              preferredWorkspacePaneTabByTarget: repo.ui.preferredWorkspacePaneTabByTarget,
            },
            dataLoads: {
              visibleStatus: repo.dataLoads.visibleStatus,
            },
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
    repoShell.instanceId,
    currentBranchName,
    'full',
    true,
  )
  const projection = projectionReadModel.data
  const branchReadModel = projection?.snapshot
    ? repoBranchReadModelFromSnapshot(projection.snapshot, projection.status)
    : null
  if (!branchReadModel || !projection) {
    return <RepoWorkspaceSkeleton toolbarTrafficLightOffset={toolbarTrafficLightOffset} />
  }
  let presentationBranchModel: RepoWorkspaceRepo['branchModel'] = {
    ...branchReadModel,
    status: projection.status,
    statusReady: projectionReadModel.isSuccess,
  }
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
  const detailBase = getCurrentRepoWorkspacePresentation(presentationRepo)
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
