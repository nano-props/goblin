import { computed, defineComponent, onScopeDispose, watch } from 'vue'
import type { FunctionalComponent, VNodeChild } from 'vue'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { AppNavigationGeneration } from '#/web/app-navigation-lifecycle.ts'
import type { WorkspaceRouteView } from '#/web/App.tsx'
import { WorkspaceLayoutPane } from '#/web/components/Layout.tsx'
import {
  BranchNavigatorSkeleton,
  EmptyWorkspacePaneSkeleton,
  WorkspaceLayoutSkeleton,
  WorkspacePaneSkeleton,
} from '#/web/components/Skeleton.tsx'
import { UnavailableWorkspaceView } from '#/web/components/UnavailableWorkspaceView.tsx'
import { WorkspaceProjectionFailureView } from '#/web/components/WorkspaceProjectionFailureView.tsx'
import { CreateWorktreePagePane } from '#/web/components/workspace-pages/CreateWorktreePagePane.tsx'
import { WorkspaceDashboardPane } from '#/web/components/workspace-pages/WorkspaceDashboardPane.tsx'
import { WorkspacePane } from '#/web/components/workspace-pane/WorkspacePane.tsx'
import { provideWorkspacePaneTabStripScrollMemory } from '#/web/components/workspace-pane/workspace-pane-tab-strip-scroll-memory.tsx'
import type { WorkspacePaneRouteContext } from '#/web/components/workspace-pane/workspace-pane-types.ts'
import { WorkspaceLayoutShell } from '#/web/components/workspace-layout/WorkspaceLayoutShell.tsx'
import { WorkspaceLayoutSidebar } from '#/web/components/workspace-layout/WorkspaceLayoutSidebar.tsx'
import { WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'
import { WorkspaceChrome } from '#/web/components/workspace-toolbar-chrome.tsx'
import { useRepoToasts } from '#/web/hooks/useRepoToasts.tsx'
import { useResponsiveUiMode } from '#/web/hooks/useResponsiveUiMode.tsx'
import { useRestoreWorkspaceTabsOnView } from '#/web/hooks/useRestoreWorkspaceTabsOnView.ts'
import type { WorkspaceProjectionPromotionViewState } from '#/web/hooks/useRestoreWorkspaceTabsOnView.ts'
import { useRetainedValueDuringExit } from '#/web/hooks/useRetainedValueDuringExit.ts'
import { formatWorkspaceDisplayLocation } from '#/web/lib/paths.ts'
import { invalidateRepoMetadataQueries, invalidateRepoWorktreeStatusQueries } from '#/web/repo-query-runtime.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'
import { uiTransitionStore } from '#/web/stores/ui-transition.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { gitWorkspaceCanExecute, isWorkspaceUnavailable } from '#/web/stores/workspaces/workspace-guards.ts'

interface WorkspaceProjectionRestoreController {
  state: WorkspaceProjectionPromotionViewState
  retry: () => void
}

const EmptyWorkspacePane: FunctionalComponent<{ trafficLightOffset: boolean }> = (props) => (
  <section data-testid="empty-workspace-pane" class="flex min-h-0 flex-1 flex-col bg-background">
    <WorkspaceChrome trafficLightOffset={props.trafficLightOffset} />
    <div class="min-h-0 flex-1" />
  </section>
)

EmptyWorkspacePane.props = ['trafficLightOffset']

interface WorkspaceViewProps {
  workspaceId: WorkspaceId
  routeView?: WorkspaceRouteView | null
  onOpenSettings?: () => void
  onOpenWorkspaceNavigator?: (workspaceId: WorkspaceId) => void
  onOpenWorkspaceRootPane?: (workspaceId: WorkspaceId) => void
  onOpenWorkspaceDashboard?: (workspaceId: WorkspaceId) => void
  onOpenRepoBranch?: (workspaceId: WorkspaceId, branchName: string) => void
  onOpenRepoNewWorktree?: (workspaceId: WorkspaceId) => void
  onCancelRepoNewWorktree?: (workspaceId: WorkspaceId) => void
  onReplaceRepoBranch?: (
    workspaceId: WorkspaceId,
    branchName: string,
    navigationGeneration: AppNavigationGeneration,
  ) => void
}

export const WorkspaceView = defineComponent<WorkspaceViewProps>({
  name: 'WorkspaceView',
  props: [
    'workspaceId',
    'routeView',
    'onOpenSettings',
    'onOpenWorkspaceNavigator',
    'onOpenWorkspaceRootPane',
    'onOpenWorkspaceDashboard',
    'onOpenRepoBranch',
    'onOpenRepoNewWorktree',
    'onCancelRepoNewWorktree',
    'onReplaceRepoBranch',
  ],

  setup(props) {
    provideWorkspacePaneTabStripScrollMemory()
    return () => <WorkspaceViewContent {...props} />
  },
})

const WorkspaceViewContent = defineComponent<WorkspaceViewProps>({
  name: 'WorkspaceViewContent',
  props: [
    'workspaceId',
    'routeView',
    'onOpenSettings',
    'onOpenWorkspaceNavigator',
    'onOpenWorkspaceRootPane',
    'onOpenWorkspaceDashboard',
    'onOpenRepoBranch',
    'onOpenRepoNewWorktree',
    'onCancelRepoNewWorktree',
    'onReplaceRepoBranch',
  ],

  setup(props) {
    const uiMode = useResponsiveUiMode()
    const compact = computed(() => uiMode.value === 'compact')
    const view = useStoreSelector(
      workspacesStore,
      (state) => ({
        workspaceMembershipReady: state.workspaceMembershipReady,
        zenMode: state.zenMode,
        workspacePaneSize: state.workspacePaneSize,
      }),
      (left, right) =>
        left.workspaceMembershipReady === right.workspaceMembershipReady &&
        left.zenMode === right.zenMode &&
        left.workspacePaneSize === right.workspacePaneSize,
    )
    const workspaces = useStoreSelector(workspacesStore, (state) => state.workspaces)
    const workspace = computed(() => workspaces.value[props.workspaceId])
    const setWorkspacePaneSize = workspacesStore.getState().setWorkspacePaneSize
    const setCompactWorkspaceTransitioning = uiTransitionStore.getState().setCompactWorkspaceTransitioning
    const currentBranchName = computed(() => (props.routeView?.kind === 'branch' ? props.routeView.branchName : null))
    const routeWorkspacePageActive = computed(
      () =>
        props.routeView?.kind === 'workspace-root' ||
        props.routeView?.kind === 'worktree' ||
        props.routeView?.kind === 'dashboard' ||
        props.routeView?.kind === 'newWorktree',
    )
    const workspacePaneActive = computed(() => currentBranchName.value !== null || routeWorkspacePageActive.value)
    const singlePane = computed<'navigator' | 'workspace'>(() =>
      currentBranchName.value || routeWorkspacePageActive.value ? 'workspace' : 'navigator',
    )
    const compactWorkspaceCurrentBranchName = useRetainedValueDuringExit({
      value: currentBranchName,
      active: () => compact.value && singlePane.value === 'workspace',
      retainMs: WORKSPACE_PANE_TRANSITION_MS,
      resetKey: () => props.workspaceId,
    })
    const compactWorkspaceTransitioning = computed(
      () =>
        compact.value &&
        compactWorkspaceCurrentBranchName.value !== null &&
        compactWorkspaceCurrentBranchName.value !== currentBranchName.value,
    )
    const workspaceCurrentBranchName = computed(() =>
      compact.value ? compactWorkspaceCurrentBranchName.value : currentBranchName.value,
    )
    const workspacePaneRouteContext = computed<WorkspacePaneRouteContext>(() =>
      props.routeView?.kind === 'branch' && props.routeView.branchName === workspaceCurrentBranchName.value
        ? { kind: 'routed', route: props.routeView.workspacePaneRoute }
        : { kind: 'inactive' },
    )

    let previousWorkspaceRoute = {
      workspaceId: props.workspaceId,
      terminal: workspaceRouteViewIsTerminal(props.routeView ?? null),
    }
    // Leaving a terminal route makes Git metadata visible again. Invalidate
    // once at that route edge so the next projection is fresh.
    watch(
      [() => props.workspaceId, () => props.routeView ?? null, workspace],
      ([workspaceId, routeView, currentWorkspace]) => {
        const previous = previousWorkspaceRoute
        const terminal = workspaceRouteViewIsTerminal(routeView)
        previousWorkspaceRoute = { workspaceId, terminal }
        if (previous.workspaceId !== workspaceId || !previous.terminal || terminal) return
        if (!currentWorkspace || !gitWorkspaceCanExecute(currentWorkspace)) return
        invalidateRepoMetadataQueries(currentWorkspace.id, currentWorkspace.workspaceRuntimeId)
        invalidateRepoWorktreeStatusQueries(currentWorkspace.id, currentWorkspace.workspaceRuntimeId)
      },
    )

    // The global shortcut gate must share the exact lifetime of the compact
    // exit transition, including cancellation when another route wins.
    watch(
      compactWorkspaceTransitioning,
      (transitioning, _previous, onCleanup) => {
        setCompactWorkspaceTransitioning(transitioning)
        if (!transitioning) return
        const timeout = window.setTimeout(() => setCompactWorkspaceTransitioning(false), WORKSPACE_PANE_TRANSITION_MS)
        onCleanup(() => window.clearTimeout(timeout))
      },
      { immediate: true },
    )
    onScopeDispose(() => setCompactWorkspaceTransitioning(false))

    return () => {
      const currentView = view.value
      const currentWorkspace = workspace.value
      const currentRouteView = props.routeView ?? null
      const isCompact = compact.value
      const activeSinglePane = singlePane.value
      const routeBranchName = currentBranchName.value

      if (!currentView.workspaceMembershipReady) {
        return (
          <WorkspaceLayoutSkeleton
            singlePane={isCompact}
            singlePaneView={activeSinglePane}
            workspacePaneState={routeBranchName ? 'content' : 'empty'}
          />
        )
      }
      if (!currentWorkspace) return <RoutedWorkspaceNotFound workspaceId={props.workspaceId} />

      const git = currentWorkspace.capability.kind === 'git' ? currentWorkspace.capability.git : null
      const gitAvailable = git !== null
      const gitUnavailable = currentWorkspace.capability.kind === 'filesystem'
      const gitCapabilitySettled = gitAvailable || gitUnavailable
      const zenModeCollapsed = !isCompact && currentView.zenMode && workspacePaneActive.value
      const workspaceTrafficLightOffset = zenModeCollapsed
      const sidebarSelectBranch = currentRouteView
        ? (branchName: string) => props.onOpenRepoBranch?.(currentWorkspace.id, branchName)
        : undefined
      const sidebarCreateWorktree = currentRouteView
        ? () => props.onOpenRepoNewWorktree?.(currentWorkspace.id)
        : undefined
      const sidebarOpenDashboard = currentRouteView
        ? () => props.onOpenWorkspaceDashboard?.(currentWorkspace.id)
        : undefined

      const renderSidebarPane = (
        branchContent?: VNodeChild,
        chromeRegion: 'drag' | 'none' = zenModeCollapsed ? 'none' : 'drag',
      ): VNodeChild => (
        <WorkspaceLayoutPane>
          <WorkspaceLayoutSidebar
            workspaceId={currentWorkspace.id}
            git={git}
            compact={isCompact}
            branchContent={branchContent ?? (!gitCapabilitySettled ? <BranchNavigatorSkeleton /> : undefined)}
            chromeRegion={chromeRegion}
            onOpenSettings={props.onOpenSettings}
            onSelectBranch={sidebarSelectBranch}
            onCreateWorktree={sidebarCreateWorktree}
            onOpenDashboard={sidebarOpenDashboard}
            dashboardSelected={currentRouteView?.kind === 'dashboard'}
            newWorktreeSelected={currentRouteView?.kind === 'newWorktree'}
            currentBranchName={routeBranchName}
            workspaceRootSelected={gitUnavailable && currentRouteView?.kind === 'workspace-root'}
            onSelectWorkspaceRoot={
              gitUnavailable ? () => props.onOpenWorkspaceRootPane?.(currentWorkspace.id) : undefined
            }
          />
        </WorkspaceLayoutPane>
      )

      if (isWorkspaceUnavailable(currentWorkspace)) {
        return (
          <WorkspaceLayoutShell
            workspaceId={props.workspaceId}
            compact={isCompact}
            zenMode={currentView.zenMode}
            workspacePaneActive={workspacePaneActive.value}
            workspacePaneSize={currentView.workspacePaneSize}
            onWorkspacePaneSizeChange={setWorkspacePaneSize}
            sidebarPane={renderSidebarPane(
              isCompact ? <UnavailableWorkspaceView workspace={currentWorkspace} /> : undefined,
            )}
            zenRevealSidebarPane={renderSidebarPane(undefined, 'none')}
            workspacePane={
              <WorkspaceLayoutPane>
                <WorkspaceChrome trafficLightOffset={workspaceTrafficLightOffset} />
                <UnavailableWorkspaceView workspace={currentWorkspace} />
              </WorkspaceLayoutPane>
            }
            singlePaneActivePane={isCompact ? 'navigator' : activeSinglePane}
          />
        )
      }

      const renderWorkspacePaneContent = (): VNodeChild => {
        if (!currentRouteView) {
          return (
            <WorkspacePane
              workspaceId={props.workspaceId}
              currentBranchName={workspaceCurrentBranchName.value}
              workspacePaneRouteContext={workspacePaneRouteContext.value}
              shortcutsEnabled={!isCompact || activeSinglePane === 'workspace'}
              toolbarTrafficLightOffset={workspaceTrafficLightOffset}
            />
          )
        }

        switch (currentRouteView.kind) {
          case 'dashboard':
            return (
              <WorkspaceDashboardPane
                workspaceId={currentWorkspace.id}
                compact={isCompact}
                trafficLightOffset={workspaceTrafficLightOffset}
                onBack={() => props.onOpenWorkspaceNavigator?.(currentWorkspace.id)}
                onSelectBranch={(branchName) => props.onOpenRepoBranch?.(currentWorkspace.id, branchName)}
              />
            )
          case 'workspace-root':
            return (
              <WorkspacePane
                workspaceId={props.workspaceId}
                currentBranchName={null}
                workspacePaneRouteContext={{
                  kind: 'workspace-root',
                  route: currentRouteView.workspacePaneRoute,
                }}
                shortcutsEnabled={!isCompact || activeSinglePane === 'workspace'}
                toolbarTrafficLightOffset={workspaceTrafficLightOffset}
                onBackToBranchNavigator={() => props.onOpenWorkspaceNavigator?.(currentWorkspace.id)}
              />
            )
          case 'worktree':
            return (
              <WorkspacePane
                workspaceId={props.workspaceId}
                currentBranchName={null}
                workspacePaneRouteContext={{
                  kind: 'git-worktree',
                  worktreePath: currentRouteView.worktreePath,
                  route: currentRouteView.workspacePaneRoute,
                }}
                shortcutsEnabled={!isCompact || activeSinglePane === 'workspace'}
                toolbarTrafficLightOffset={workspaceTrafficLightOffset}
                onBackToBranchNavigator={() => props.onOpenWorkspaceNavigator?.(currentWorkspace.id)}
              />
            )
          case 'newWorktree':
            return (
              <CreateWorktreePagePane
                repoId={currentWorkspace.id}
                compact={isCompact}
                trafficLightOffset={workspaceTrafficLightOffset}
                onCancel={() => {
                  if (props.onCancelRepoNewWorktree) props.onCancelRepoNewWorktree(currentWorkspace.id)
                  else props.onOpenWorkspaceNavigator?.(currentWorkspace.id)
                }}
                onCreated={(branchName, navigationGeneration) =>
                  props.onReplaceRepoBranch?.(currentWorkspace.id, branchName, navigationGeneration)
                }
              />
            )
          case 'empty':
            return <EmptyWorkspacePane trafficLightOffset={workspaceTrafficLightOffset} />
          case 'branch':
            return (
              <WorkspacePane
                workspaceId={props.workspaceId}
                currentBranchName={workspaceCurrentBranchName.value}
                workspacePaneRouteContext={workspacePaneRouteContext.value}
                shortcutsEnabled={!isCompact || activeSinglePane === 'workspace'}
                toolbarTrafficLightOffset={workspaceTrafficLightOffset}
                onBackToBranchNavigator={() => props.onOpenWorkspaceNavigator?.(currentWorkspace.id)}
              />
            )
        }
      }

      const renderWorkspace = (projectionRestore: WorkspaceProjectionRestoreController | null): VNodeChild => {
        if (currentWorkspace.session.projectionState === 'stub' && !projectionRestore) {
          throw new Error('A filesystem workspace cannot own a Git projection stub')
        }
        if (currentWorkspace.session.projectionState === 'stub' && projectionRestore?.state.phase === 'failed') {
          const failure = (
            <WorkspaceProjectionFailureView
              workspace={currentWorkspace}
              message={projectionRestore.state.message}
              onRetry={projectionRestore.retry}
            />
          )
          return (
            <WorkspaceLayoutShell
              workspaceId={props.workspaceId}
              compact={isCompact}
              zenMode={currentView.zenMode}
              workspacePaneActive={workspacePaneActive.value}
              workspacePaneSize={currentView.workspacePaneSize}
              onWorkspacePaneSizeChange={setWorkspacePaneSize}
              sidebarPane={renderSidebarPane(isCompact ? failure : undefined)}
              zenRevealSidebarPane={renderSidebarPane(undefined, 'none')}
              workspacePane={
                <WorkspaceLayoutPane>
                  <WorkspaceChrome trafficLightOffset={workspaceTrafficLightOffset} />
                  {failure}
                </WorkspaceLayoutPane>
              }
              singlePaneActivePane={isCompact ? 'navigator' : activeSinglePane}
            />
          )
        }

        if (currentWorkspace.session.projectionState === 'stub') {
          const branchSkeleton = isCompact && routeBranchName ? undefined : <BranchNavigatorSkeleton />
          return (
            <WorkspaceLayoutShell
              workspaceId={props.workspaceId}
              compact={isCompact}
              zenMode={currentView.zenMode}
              workspacePaneActive={workspacePaneActive.value}
              workspacePaneSize={currentView.workspacePaneSize}
              onWorkspacePaneSizeChange={setWorkspacePaneSize}
              sidebarPane={renderSidebarPane(branchSkeleton)}
              zenRevealSidebarPane={renderSidebarPane(branchSkeleton, 'none')}
              workspacePane={
                <WorkspaceLayoutPane>
                  {routeBranchName ? (
                    <WorkspacePaneSkeleton toolbarTrafficLightOffset={workspaceTrafficLightOffset} />
                  ) : (
                    <>
                      <WorkspaceChrome trafficLightOffset={workspaceTrafficLightOffset} />
                      <EmptyWorkspacePaneSkeleton />
                    </>
                  )}
                </WorkspaceLayoutPane>
              }
              singlePaneActivePane={routeBranchName ? 'workspace' : 'navigator'}
            />
          )
        }

        return (
          <WorkspaceLayoutShell
            workspaceId={props.workspaceId}
            compact={isCompact}
            zenMode={currentView.zenMode}
            workspacePaneActive={workspacePaneActive.value}
            workspacePaneSize={currentView.workspacePaneSize}
            onWorkspacePaneSizeChange={setWorkspacePaneSize}
            sidebarPane={renderSidebarPane()}
            zenRevealSidebarPane={renderSidebarPane(undefined, 'none')}
            workspacePane={<WorkspaceLayoutPane>{renderWorkspacePaneContent()}</WorkspaceLayoutPane>}
            singlePaneActivePane={activeSinglePane}
          />
        )
      }

      return git ? (
        <GitWorkspaceEffects workspaceId={props.workspaceId} renderWorkspace={renderWorkspace} />
      ) : (
        renderWorkspace(null)
      )
    }
  },
})

function workspaceRouteViewIsTerminal(routeView: WorkspaceRouteView | null): boolean {
  return (
    (routeView?.kind === 'branch' || routeView?.kind === 'worktree' || routeView?.kind === 'workspace-root') &&
    routeView.workspacePaneRoute?.kind === 'terminal'
  )
}

interface GitWorkspaceEffectsProps {
  workspaceId: WorkspaceId
  renderWorkspace: (projectionRestore: WorkspaceProjectionRestoreController) => VNodeChild
}

const GitWorkspaceEffects = defineComponent<GitWorkspaceEffectsProps>({
  name: 'GitWorkspaceEffects',
  props: ['workspaceId', 'renderWorkspace'],
  setup(props) {
    useRepoToasts(() => props.workspaceId)
    const projectionRestore = useRestoreWorkspaceTabsOnView({ workspaceId: () => props.workspaceId })
    return () => props.renderWorkspace({ state: projectionRestore.state.value, retry: projectionRestore.retry })
  },
})

const RoutedWorkspaceNotFound = defineComponent<{ workspaceId: WorkspaceId }>({
  name: 'RoutedWorkspaceNotFound',
  props: ['workspaceId'],
  setup(props) {
    const t = useT()
    return () => (
      // An explicit URL remains navigation authority even when its target was
      // removed. Render the missing fact until a user chooses another route.
      <section class="flex min-h-0 flex-1 flex-col bg-background">
        <div class="flex flex-1 items-center justify-center p-6 text-center">
          <div class="flex max-w-sm flex-col gap-2">
            <h1 class="text-sm font-medium text-foreground">{t('workspace-route.not-found-title')}</h1>
            <p class="break-all text-sm text-muted-foreground">{formatWorkspaceDisplayLocation(props.workspaceId)}</p>
          </div>
        </div>
      </section>
    )
  },
})
