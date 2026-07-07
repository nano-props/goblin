import { useEffect, useId, useMemo } from 'react'
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
import { useRepoPullRequestsReadModel, useRepoStatusReadModel } from '#/web/repo-data-query.ts'
import { readRepoBranchQueryProjection, useRepoBranchReadModel } from '#/web/repo-branch-read-model.ts'
import { RepoWorkspaceSkeleton } from '#/web/components/Skeleton.tsx'
import { useWorkspaceNavigationHistory } from '#/web/workspace-navigation-history.ts'
import type { RepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import {
  reconcileWorkspacePaneRoute,
  workspacePaneRouteHistoryResolution,
  type WorkspacePaneRouteReconciliation,
} from '#/web/components/repo-workspace/workspace-pane-route-reconciliation.ts'

interface Props {
  repoId: string
  currentBranchName?: string | null
  workspacePaneRoute?: RepoBranchWorkspacePaneRoute | null
  shortcutsEnabled?: boolean
  toolbarTrafficLightOffset?: boolean
  onBackToBranchNavigator?: () => void
}

// Keep this equality in sync with fields read by RepoWorkspace children.
type RepoWorkspaceRepoShell = Omit<RepoWorkspaceRepo, 'branchModel'>

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
      a.dataLoads.status === b.dataLoads.status &&
      a.dataLoads.pullRequests === b.dataLoads.pullRequests &&
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
  workspacePaneRoute,
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
              status: repo.dataLoads.status,
              pullRequests: repo.dataLoads.pullRequests,
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
      workspacePaneRoute={workspacePaneRoute}
      workspacePaneId={workspacePaneId}
      shortcutsEnabled={shortcutsEnabled}
      toolbarTrafficLightOffset={toolbarTrafficLightOffset}
      onBackToBranchNavigator={onBackToBranchNavigator}
    />
  )
}

function RepoWorkspaceLoaded({
  repoShell,
  workspacePaneRoute,
  workspacePaneId,
  shortcutsEnabled,
  toolbarTrafficLightOffset,
  onBackToBranchNavigator,
}: {
  repoShell: RepoWorkspaceRepoShell
  workspacePaneRoute: RepoBranchWorkspacePaneRoute | null | undefined
  workspacePaneId: string
  shortcutsEnabled: boolean
  toolbarTrafficLightOffset: boolean
  onBackToBranchNavigator?: () => void
}) {
  const statusReadModel = useRepoStatusReadModel(repoShell.id, repoShell.instanceId, true)
  const branchReadModel = useRepoBranchReadModel(repoShell.id, repoShell.instanceId, true)
  const currentBranchName = repoShell.ui.currentBranchName
  const pullRequestsReadModel = useRepoPullRequestsReadModel(
    repoShell.id,
    repoShell.instanceId,
    currentBranchName ? [currentBranchName] : undefined,
    'full',
    !!currentBranchName,
  )
  const historyBranch = currentBranchName
    ? branchReadModel?.branches.find((branch) => branch.name === currentBranchName)
    : null
  useSyncRoutedWorkspacePaneSelection({
    repoId: repoShell.id,
    branchName: currentBranchName,
    route: workspacePaneRoute,
  })
  if (!branchReadModel || !statusReadModel.data) {
    return <RepoWorkspaceSkeleton toolbarTrafficLightOffset={toolbarTrafficLightOffset} />
  }
  let presentationBranchModel: RepoWorkspaceRepo['branchModel'] = {
    ...branchReadModel,
    status: statusReadModel.data,
    statusReady: statusReadModel.isSuccess,
  }
  if (currentBranchName && Array.isArray(pullRequestsReadModel.data)) {
    const pullRequest = pullRequestsReadModel.data.find((entry) => entry.branch === currentBranchName)?.pullRequest
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
  const presentationRepo: RepoWorkspaceRepo = { ...repoShell, branchModel: presentationBranchModel }
  const detail = getCurrentRepoWorkspacePresentation(presentationRepo)

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      {detail.branch ? (
        <BranchActionWorkspacePane
          repo={presentationRepo}
          detail={detail}
          workspacePaneRoute={workspacePaneRoute}
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
          workspacePaneRoute={workspacePaneRoute}
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
  workspacePaneRoute: RepoBranchWorkspacePaneRoute | null | undefined
  workspacePaneId: string
  toolbarTrafficLightOffset?: boolean
  branchActions?: BranchActions
  onBackToBranchNavigator?: () => void
}

function RepoWorkspacePane({
  repo,
  detail,
  workspacePaneRoute,
  workspacePaneId,
  toolbarTrafficLightOffset = false,
  branchActions,
  onBackToBranchNavigator,
}: RepoWorkspacePaneProps) {
  const workspacePaneTabModel = useRepoWorkspaceTabModel(repo, detail, workspacePaneRoute)
  const navigation = usePrimaryWindowNavigation()
  const workspacePaneRouteReconciliation = useMemo(
    () => reconcileWorkspacePaneRoute(workspacePaneRoute ?? null, workspacePaneTabModel),
    [workspacePaneRoute, workspacePaneTabModel],
  )
  useReconcileWorkspacePaneRoute({
    repoId: repo.id,
    branchName: detail.branch?.name ?? null,
    reconciliation: workspacePaneRouteReconciliation,
    navigation,
  })
  useWorkspacePaneNavigationHistory({
    repoId: repo.id,
    branchName: detail.branch?.name ?? null,
    worktreePath: detail.branch?.worktree?.path ?? null,
    route: workspacePaneRoute,
    reconciliation: workspacePaneRouteReconciliation,
  })

  return (
    <>
      <RepoWorkspaceToolbar
        repo={repo}
        detail={detail}
        workspacePaneId={workspacePaneId}
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

function useReconcileWorkspacePaneRoute({
  repoId,
  branchName,
  reconciliation,
  navigation,
}: {
  repoId: string
  branchName: string | null
  reconciliation: WorkspacePaneRouteReconciliation
  navigation: {
    selectRepoBranch: (repoId: string, branch: string, options?: { replace?: boolean }) => void
    showRepoBranchWorkspacePaneTab: (
      repoId: string,
      branch: string,
      tab: Extract<RepoBranchWorkspacePaneRoute, { kind: 'static' }>['tab'],
      options?: { replace?: boolean },
    ) => void
    showRepoBranchTerminalSession: (
      repoId: string,
      branch: string,
      terminalSessionId: string,
      options?: { replace?: boolean },
    ) => void
  }
}): void {
  useEffect(() => {
    if (!branchName) return
    applyWorkspacePaneRouteReconciliation({ repoId, branchName, reconciliation, navigation })
  }, [branchName, navigation, reconciliation, repoId])
}

function useWorkspacePaneNavigationHistory({
  repoId,
  branchName,
  worktreePath,
  route,
  reconciliation,
}: {
  repoId: string
  branchName: string | null
  worktreePath: string | null
  route: RepoBranchWorkspacePaneRoute | null | undefined
  reconciliation: WorkspacePaneRouteReconciliation
}): void {
  const historyRoute = workspacePaneRouteHistoryResolution(route ?? null, reconciliation)
  useWorkspaceNavigationHistory({
    replaceCurrent: reconciliation.kind === 'replace',
    routeContext:
      branchName && historyRoute.kind === 'record'
        ? {
            kind: 'branch',
            repoId,
            branchName,
            worktreePath,
            workspacePaneRoute: historyRoute.route,
          }
        : null,
  })
}

function applyWorkspacePaneRouteReconciliation({
  repoId,
  branchName,
  reconciliation,
  navigation,
}: {
  repoId: string
  branchName: string
  reconciliation: WorkspacePaneRouteReconciliation
  navigation: {
    selectRepoBranch: (repoId: string, branch: string, options?: { replace?: boolean }) => void
    showRepoBranchWorkspacePaneTab: (
      repoId: string,
      branch: string,
      tab: Extract<RepoBranchWorkspacePaneRoute, { kind: 'static' }>['tab'],
      options?: { replace?: boolean },
    ) => void
    showRepoBranchTerminalSession: (
      repoId: string,
      branch: string,
      terminalSessionId: string,
      options?: { replace?: boolean },
    ) => void
  }
}): void {
  if (reconciliation.kind === 'none' || reconciliation.kind === 'pending') return
  if (!reconciliation.route) {
    navigation.selectRepoBranch(repoId, branchName, { replace: true })
    return
  }
  if (reconciliation.route.kind === 'static') {
    navigation.showRepoBranchWorkspacePaneTab(repoId, branchName, reconciliation.route.tab, { replace: true })
    return
  }
  navigation.showRepoBranchTerminalSession(repoId, branchName, reconciliation.route.terminalSessionId, {
    replace: true,
  })
}

interface BranchActionWorkspacePaneProps {
  repo: RepoWorkspaceRepo
  detail: CurrentRepoWorkspacePresentation
  workspacePaneRoute: RepoBranchWorkspacePaneRoute | null | undefined
  branch: NonNullable<CurrentRepoWorkspacePresentation['branch']>
  workspacePaneId: string
  shortcutsEnabled: boolean
  toolbarTrafficLightOffset?: boolean
  onBackToBranchNavigator?: () => void
}

function BranchActionWorkspacePane({
  repo,
  detail,
  workspacePaneRoute,
  branch,
  workspacePaneId,
  shortcutsEnabled,
  toolbarTrafficLightOffset = false,
  onBackToBranchNavigator,
}: BranchActionWorkspacePaneProps) {
  const branchActions = useBranchActions(repo, branch)
  const actions = useBranchActionItems(repo, branch, branchActions)
  useBranchActionShortcutRegistry(actions, shortcutsEnabled)

  return (
    <BranchActionSurfaceContext value={actions}>
      <RepoWorkspacePane
        repo={repo}
        detail={detail}
        workspacePaneRoute={workspacePaneRoute}
        workspacePaneId={workspacePaneId}
        toolbarTrafficLightOffset={toolbarTrafficLightOffset}
        branchActions={branchActions}
        onBackToBranchNavigator={onBackToBranchNavigator}
      />
    </BranchActionSurfaceContext>
  )
}

function useSyncRoutedWorkspacePaneSelection({
  repoId,
  branchName,
  route,
}: {
  repoId: string
  branchName: string | null
  route: RepoBranchWorkspacePaneRoute | null | undefined
}): void {
  const setWorkspacePaneTab = useReposStore((s) => s.setWorkspacePaneTab)
  useEffect(() => {
    if (!branchName || !route) return
    const state = useReposStore.getState()
    const repo = state.repos[repoId]
    const branchModel = repo ? readRepoBranchQueryProjection(repo) : null
    const branch = branchModel?.branches.find((candidate) => candidate.name === branchName)
    const target = branch
      ? {
          repoRoot: repoId,
          branchName,
          worktreePath: branch.worktree?.path ?? null,
        }
      : null
    if (!repo || !target) return
    const routeTab = route.kind === 'static' ? route.tab : 'terminal'
    if (preferredWorkspacePaneTabForTarget(repo.ui, target) !== routeTab) {
      setWorkspacePaneTab(repoId, branchName, routeTab)
    }
  }, [branchName, repoId, route, setWorkspacePaneTab])
}
