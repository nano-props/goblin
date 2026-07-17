import { useCallback, useId, useMemo } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  getCurrentRepoWorkspacePresentation,
  type RepoWorkspaceRepo,
  type CurrentRepoWorkspacePresentation,
} from '#/web/components/repo-workspace/model.ts'
import { RepoWorkspaceToolbar } from '#/web/components/repo-workspace/RepoWorkspaceToolbar.tsx'
import { RepoWorkspaceContent } from '#/web/components/repo-workspace/RepoWorkspaceContent.tsx'
import {
  useWorkspaceRootTabModel,
  useRepoWorkspaceTabModel,
} from '#/web/components/repo-workspace/use-repo-workspace-tab-model.ts'
import { useWorkspacePaneVisibleStatusRefresh } from '#/web/components/repo-workspace/use-workspace-pane-visible-status-refresh.ts'
import { useBranchActionItems } from '#/web/hooks/useBranchActionItems.ts'
import { useBranchActionShortcutRegistry } from '#/web/hooks/useBranchActionShortcutRegistry.ts'
import { useBranchActions, type BranchActions } from '#/web/hooks/useBranchActions.tsx'
import { BranchActionSurfaceContext } from '#/web/components/repo-workspace/branch-action-surface-context.ts'
import {
  useRepoProjectionReadModel,
  useRepoWorktreeStatusReadModel,
  useWorkspaceDirectoryOverview,
} from '#/web/repo-data-query.ts'
import { repoBranchReadModelFromSnapshot } from '#/web/repo-branch-read-model.ts'
import { RepoWorkspaceSkeleton } from '#/web/components/Skeleton.tsx'
import { RepoStatusFailureView } from '#/web/components/RepoStatusFailureView.tsx'
import type { ParsedRepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import { useWorkspacePaneRouteController } from '#/web/components/repo-workspace/workspace-pane-route-controller.ts'
import { projectBranchActionRepo } from '#/web/hooks/branch-action-state.ts'
import { isRepoUnavailable } from '#/web/stores/repos/repo-guards.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'
import { refreshRepoWorktreeStatus } from '#/web/stores/repos/worktree-status-refresh.ts'
import { useT } from '#/web/stores/i18n.ts'
import { FiletreeTab } from '#/web/components/repo-workspace/panels.tsx'
import { WorkspacePanePanelFrame } from '#/web/components/workspace-pane/WorkspacePanePanelFrame.tsx'
import { usePrimaryWindowNavigation } from '#/web/primary-window-navigation.tsx'
import { renderWorkspacePaneRuntimeTabPanel } from '#/web/workspace-pane/workspace-pane-runtime-tab-panel.tsx'
import { runtimeWorkspacePaneTarget } from '#/shared/workspace-pane-tabs-target.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import { WorkspacePaneToolbar } from '#/web/components/workspace-pane/WorkspacePaneToolbar.tsx'
import {
  createPendingWorkspacePaneTabItem,
  createRuntimeWorkspacePaneTabItem,
  createStaticWorkspacePaneTabItem,
  isPendingWorkspacePaneTabItem,
  type WorkspacePaneTabItem,
} from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import { workspacePaneRuntimeTabProvider, workspacePaneStaticTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import { useWorkspacePaneRuntimeTabCreateAction } from '#/web/workspace-pane/use-workspace-pane-runtime-tab-create-action.ts'
import { useIsInitialTerminalProjectionHydrating } from '#/web/stores/terminal-projection-hydration.ts'
import { dispatchSelectWorkspacePaneTabByIdentityAction } from '#/web/workspace-pane/workspace-pane-tab-select-action.ts'
import { runCloseWorkspacePaneTabCommand } from '#/web/commands/workspace-commands.ts'
import { useWorkspacePaneTabsReorderMutation } from '#/web/workspace-pane/workspace-pane-tabs-reorder-mutation.ts'
import { useWorkspacePaneTabDragPreview } from '#/web/components/workspace-pane/workspace-pane-tab-drag-preview.ts'
import { orderWorkspacePaneItemsByTabEntries } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import type { WorkspacePaneRuntimeTabType, WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import { DirectoryOverviewContent } from '#/web/components/repo-pages/DirectoryOverviewContent.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { workspaceGitAvailable, workspaceGitUnavailable } from '#/shared/workspace-runtime.ts'

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
  workspaceProbe: RepoState['workspaceProbe']
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
      a.workspaceProbe === b.workspaceProbe &&
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
            workspaceProbe: repo.workspaceProbe,
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

function RepoWorkspaceLoaded(props: {
  repoShell: RepoWorkspaceRepoShell
  workspacePaneRouteContext: RepoWorkspacePaneRouteContext
  workspacePaneId: string
  shortcutsEnabled: boolean
  toolbarTrafficLightOffset: boolean
  onBackToBranchNavigator?: () => void
}) {
  if (workspaceGitUnavailable(props.repoShell.workspaceProbe)) {
    return (
      <WorkspaceRootPane
        repo={props.repoShell}
        terminalAvailable={props.repoShell.workspaceProbe.capabilities.terminal.available}
        workspacePaneId={props.workspacePaneId}
        toolbarTrafficLightOffset={props.toolbarTrafficLightOffset}
        onBackToNavigator={props.onBackToBranchNavigator}
      />
    )
  }
  if (!workspaceGitAvailable(props.repoShell.workspaceProbe)) {
    return <RepoWorkspaceSkeleton toolbarTrafficLightOffset={props.toolbarTrafficLightOffset} />
  }
  return <GitRepoWorkspaceLoaded {...props} />
}

function GitRepoWorkspaceLoaded({
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
            void refreshRepoWorktreeStatus({ get: useReposStore.getState }, repoShell.id, repoShell.repoRuntimeId)
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

function WorkspaceRootPane({
  repo,
  terminalAvailable,
  workspacePaneId,
  toolbarTrafficLightOffset,
  onBackToNavigator,
}: {
  repo: Pick<RepoWorkspaceRepoShell, 'id' | 'repoRuntimeId' | 'ui'>
  terminalAvailable: boolean
  workspacePaneId: string
  toolbarTrafficLightOffset: boolean
  onBackToNavigator?: () => void
}) {
  const t = useT()
  const navigation = usePrimaryWindowNavigation()
  const model = useWorkspaceRootTabModel(repo)
  const target = { kind: 'workspace-root' as const, repoRoot: repo.id, branchName: null, worktreePath: null }
  const runtimeTarget = runtimeWorkspacePaneTarget(target, repo.repoRuntimeId)
  const hydrating = useIsInitialTerminalProjectionHydrating(repo.id, repo.repoRuntimeId)
  const activePanel =
    model.selection?.tab === 'terminal' && terminalAvailable
      ? 'terminal'
      : model.selection?.tab === 'status'
        ? 'status'
        : 'files'
  const overviewReadModel = useWorkspaceDirectoryOverview(repo.id, repo.repoRuntimeId, activePanel === 'status')
  const selectedTerminalSessionId =
    model.selection?.kind === 'materialized-tab' && model.selection.materializedTab.kind === 'runtime'
      ? model.selection.materializedTab.sessionId
      : null
  const items = useMemo<WorkspacePaneTabItem[]>(() => {
    const workspaceTabs = model.tabs.filter(
      (tab) => tab.kind !== 'static' || tab.type === 'status' || tab.type === 'files',
    )
    return workspaceTabs.flatMap<WorkspacePaneTabItem>((tab) => {
      if (tab.type === 'terminal' && !terminalAvailable) return []
      if (tab.kind === 'static') {
        const provider = workspacePaneStaticTabProvider(tab.type as WorkspacePaneStaticTabType)
        const metadata = { t, branchName: '', statusCount: 0 }
        return [
          createStaticWorkspacePaneTabItem({
            type: tab.type as WorkspacePaneStaticTabType,
            label: provider.label(metadata),
            tooltip: provider.tooltip(metadata),
            closeLabel: provider.closeLabel(metadata),
            panelId: provider.panelId(workspacePaneId),
            closable: false,
          }),
        ]
      }
      const provider = workspacePaneRuntimeTabProvider(tab.runtimeType)
      if (tab.kind === 'pending') {
        const label = provider.pendingLabel({
          t,
          createPending: model.runtimeTabStateByType[tab.runtimeType].createPending,
          projectionPhase: model.runtimeTabStateByType[tab.runtimeType].projectionPhase,
        })
        return [createPendingWorkspacePaneTabItem({ type: tab.runtimeType, label, tooltip: label })]
      }
      const metadata = { t, branchName: '', statusCount: 0, view: tab.view }
      return [
        createRuntimeWorkspacePaneTabItem({
          view: tab.view,
          label: provider.label(metadata),
          tooltip: provider.tooltip(metadata),
          closeLabel: provider.closeLabel(metadata),
          panelId: provider.panelId(workspacePaneId),
        }),
      ]
    })
  }, [model.runtimeTabStateByType, model.tabs, t, terminalAvailable, workspacePaneId])
  const requestedActiveIdentity =
    model.activeTab?.identity ?? (activePanel === 'terminal' ? 'workspace-pane:terminal-host' : 'workspace-pane:files')
  const activeTabIdentity = items.some((item) => item.identity === requestedActiveIdentity)
    ? requestedActiveIdentity
    : workspacePaneStaticTabProvider('files').identity()
  const selectItem = useCallback(
    (item: WorkspacePaneTabItem) => {
      if (isPendingWorkspacePaneTabItem(item)) return
      void dispatchSelectWorkspacePaneTabByIdentityAction({
        repoId: repo.id,
        branchName: null,
        workspacePaneRoute: undefined,
        identity: item.identity,
        navigation,
      })
    },
    [navigation, repo.id],
  )
  const createAction = useWorkspacePaneRuntimeTabCreateAction({
    repoRoot: repo.id,
    repoRuntimeId: repo.repoRuntimeId,
    branchName: null,
    worktreePath: repo.id,
    runtimeTabStateByType: model.runtimeTabStateByType,
    initialRuntimeProjectionHydrating: hydrating,
    workspacePaneRoute: undefined,
    showCreatedRuntimeTab: (type: WorkspacePaneRuntimeTabType, sessionId: string) => {
      if (type !== 'terminal') return false
      const state = useReposStore.getState()
      state.setSelectedTerminal(formatTerminalWorktreeKey(repo.id, repo.id), sessionId)
      state.setWorkspacePaneTabForTarget(target, 'terminal')
      return true
    },
    t,
  })
  const { visualTabs, stageDragPreview, clearDragPreview } = useWorkspacePaneTabDragPreview({
    kind: 'workspace-root',
    repoRoot: repo.id,
    repoRuntimeId: repo.repoRuntimeId,
    branchName: null,
    worktreePath: null,
    canonicalTabs: model.tabEntries,
  })
  const { reorderTabs } = useWorkspacePaneTabsReorderMutation({
    repoRoot: repo.id,
    repoRuntimeId: repo.repoRuntimeId,
    branchName: null,
    worktreePath: null,
    canonicalTabs: model.tabEntries,
    onReorderRejected: clearDragPreview,
  })
  const visualItems = useMemo(
    () =>
      orderWorkspacePaneItemsByTabEntries(items, visualTabs, (item) =>
        isPendingWorkspacePaneTabItem(item) ? null : item.tabEntry,
      ),
    [items, visualTabs],
  )
  const handleReorder = useCallback(
    (tabs: Parameters<typeof reorderTabs>[0]) => {
      if (!stageDragPreview(tabs)) return
      reorderTabs(tabs)
    },
    [reorderTabs, stageDragPreview],
  )
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <WorkspacePaneToolbar
        workspacePaneTabTargetKey={workspacePaneTabsTargetIdentityKey(target)}
        items={visualItems}
        workspacePaneId={workspacePaneId}
        activeTabIdentity={activeTabIdentity}
        createAction={terminalAvailable ? createAction : null}
        trafficLightOffset={toolbarTrafficLightOffset}
        onBackToNavigator={onBackToNavigator}
        onSelect={selectItem}
        onReselect={selectItem}
        onClose={(item) => {
          if (isPendingWorkspacePaneTabItem(item)) return
          void runCloseWorkspacePaneTabCommand({
            repoId: repo.id,
            branchName: null,
            workspacePaneRoute: undefined,
            targetIdentity: item.identity,
            navigation,
          })
        }}
        onReorder={handleReorder}
      />
      {activePanel === 'status' ? (
        <WorkspacePanePanelFrame id={`${workspacePaneId}-status-panel`} label={t('tab.status')}>
          <ScrollArea className="min-h-0 flex-1 bg-background">
            <div className="p-4">
              {overviewReadModel.data ? (
                <DirectoryOverviewContent overview={overviewReadModel.data} />
              ) : overviewReadModel.isError ? (
                <div className="rounded-lg border border-border/60 bg-card p-4 text-sm text-destructive">
                  {t('dashboard.directory.read-failed')}
                </div>
              ) : (
                <div className="rounded-lg border border-border/60 bg-card p-4 text-sm text-muted-foreground">
                  {t('dashboard.loading')}
                </div>
              )}
            </div>
          </ScrollArea>
        </WorkspacePanePanelFrame>
      ) : activePanel === 'files' ? (
        <WorkspacePanePanelFrame id={`${workspacePaneId}-files-panel`} label={t('tab.files')}>
          <FiletreeTab repoId={repo.id} repoRuntimeId={repo.repoRuntimeId} branchName={null} worktreePath={repo.id} />
        </WorkspacePanePanelFrame>
      ) : runtimeTarget ? (
        renderWorkspacePaneRuntimeTabPanel({
          type: 'terminal',
          workspacePaneId,
          panelLabel: { label: t('tab.terminal') },
          target: {
            runtimeTarget,
            worktreePath: repo.id,
          },
          selectedSessionId: selectedTerminalSessionId,
          runtimeState: model.runtimeTabStateByType.terminal,
        })
      ) : null}
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
        onBackToBranchNavigator={onBackToBranchNavigator}
        onRetryStatus={() => {
          void refreshRepoWorktreeStatus({ get: useReposStore.getState }, repo.id, repo.repoRuntimeId)
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
