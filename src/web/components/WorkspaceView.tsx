import { useEffect, type ReactNode } from 'react'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { isWorkspaceUnavailable } from '#/web/stores/workspaces/workspace-guards.ts'
import { WorkspacePane, type WorkspacePaneRouteContext } from '#/web/components/WorkspacePane.tsx'
import {
  BranchNavigatorSkeleton,
  EmptyWorkspacePaneSkeleton,
  WorkspaceLayoutSkeleton,
  WorkspacePaneSkeleton,
} from '#/web/components/Skeleton.tsx'
import { WorkspaceLayoutPane } from '#/web/components/Layout.tsx'
import { useRepoToasts } from '#/web/hooks/useRepoToasts.tsx'
import { useRestoreWorkspaceTabsOnView } from '#/web/hooks/useRestoreWorkspaceTabsOnView.ts'
import { getWorkspacePresentation } from '#/web/workspace-presentation.ts'
import { UnavailableWorkspaceView } from '#/web/components/UnavailableWorkspaceView.tsx'
import { WorkspaceProjectionFailureView } from '#/web/components/WorkspaceProjectionFailureView.tsx'
import { useResponsiveUiMode } from '#/web/hooks/useResponsiveUiMode.tsx'
import { WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'
import { useRetainedValueDuringExit } from '#/web/hooks/useRetainedValueDuringExit.ts'
import { useUiTransitionStore } from '#/web/stores/ui-transition.ts'
import { WorkspaceLayoutSidebar } from '#/web/components/workspace-layout/WorkspaceLayoutSidebar.tsx'
import { WorkspaceChrome } from '#/web/components/workspace-toolbar-chrome.tsx'
import { WorkspaceLayoutShell } from '#/web/components/workspace-layout/WorkspaceLayoutShell.tsx'
import { WorkspaceDashboardPane } from '#/web/components/workspace-pages/WorkspaceDashboardPane.tsx'
import { CreateWorktreePagePane } from '#/web/components/workspace-pages/CreateWorktreePagePane.tsx'
import type { WorkspaceRouteView } from '#/web/App.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { formatWorkspaceDisplayLocation } from '#/web/lib/paths.ts'
import type { WorkspaceProjectionPromotionViewState } from '#/web/hooks/useRestoreWorkspaceTabsOnView.ts'

interface WorkspaceProjectionRestoreController {
  state: WorkspaceProjectionPromotionViewState
  retry: () => void
}

function EmptyWorkspacePane({ trafficLightOffset }: { trafficLightOffset: boolean }) {
  return (
    <section data-testid="empty-workspace-pane" className="flex min-h-0 flex-1 flex-col bg-background">
      <WorkspaceChrome trafficLightOffset={trafficLightOffset} />
      <div className="min-h-0 flex-1" />
    </section>
  )
}

interface Props {
  workspaceId: WorkspaceId
  routeView?: WorkspaceRouteView | null
  onOpenSettings?: () => void
  onOpenWorkspaceNavigator?: (workspaceId: WorkspaceId) => void
  onOpenWorkspaceRootPane?: (workspaceId: WorkspaceId) => void
  onOpenWorkspaceDashboard?: (workspaceId: WorkspaceId) => void
  onOpenRepoBranch?: (workspaceId: WorkspaceId, branchName: string) => void
  onOpenRepoNewWorktree?: (workspaceId: WorkspaceId) => void
  onCancelRepoNewWorktree?: (workspaceId: WorkspaceId) => void
  onReplaceRepoBranch?: (workspaceId: WorkspaceId, branchName: string) => void
}

export function WorkspaceView({
  workspaceId,
  routeView = null,
  onOpenSettings,
  onOpenWorkspaceNavigator,
  onOpenWorkspaceRootPane,
  onOpenWorkspaceDashboard,
  onOpenRepoBranch,
  onOpenRepoNewWorktree,
  onCancelRepoNewWorktree,
  onReplaceRepoBranch,
}: Props) {
  const uiMode = useResponsiveUiMode()
  const compact = uiMode === 'compact'
  const view = useWorkspacesStore(
    useShallow((s) => {
      const workspace = s.workspaces[workspaceId]
      const presentation = getWorkspacePresentation(workspace)
      return {
        exists: presentation.exists,
        initialLoading: presentation.initialLoading,
        workspaceMembershipReady: s.workspaceMembershipReady,
        zenMode: s.zenMode,
        workspacePaneSize: s.workspacePaneSize,
      }
    }),
  )
  const setWorkspacePaneSize = useWorkspacesStore((s) => s.setWorkspacePaneSize)
  const workspace = useWorkspacesStore((s) => s.workspaces[workspaceId])
  const git = workspace?.capability.kind === 'git' ? workspace.capability.git : null
  const gitAvailable = git !== null
  const gitUnavailable = workspace?.capability.kind === 'filesystem'
  const gitCapabilitySettled = gitAvailable || gitUnavailable

  const routeBranchName = routeView?.kind === 'branch' ? routeView.branchName : null

  const currentBranchName = routeView?.kind === 'branch' ? routeView.branchName : null
  const routeWorkspacePageActive =
    routeView?.kind === 'workspace-root' ||
    routeView?.kind === 'worktree' ||
    routeView?.kind === 'dashboard' ||
    routeView?.kind === 'newWorktree'
  const workspacePaneActive = currentBranchName !== null || routeWorkspacePageActive
  const singlePane = currentBranchName || routeWorkspacePageActive ? 'workspace' : 'navigator'
  const compactWorkspaceCurrentBranchName = useRetainedValueDuringExit({
    value: currentBranchName,
    active: compact && singlePane === 'workspace',
    retainMs: WORKSPACE_PANE_TRANSITION_MS,
    resetKey: workspaceId,
  })

  // Publish "compact-workspace is mid-transition" to a global store
  // so the keyboard handler can suppress branch-action shortcuts for
  // the duration. Without this, the user sees branch X in the
  // workspace but pressing 'P' (pull) acts on the new route branch Y.
  // The transition is short (WORKSPACE_PANE_TRANSITION_MS
  // = 240 ms) and the suppression is imperceptible.
  const setCompactWorkspaceTransitioning = useUiTransitionStore((s) => s.setCompactWorkspaceTransitioning)
  const compactWorkspaceTransitioning =
    compact && compactWorkspaceCurrentBranchName !== null && compactWorkspaceCurrentBranchName !== currentBranchName
  const workspaceCurrentBranchName = compact ? compactWorkspaceCurrentBranchName : currentBranchName
  const workspacePaneRouteContext: WorkspacePaneRouteContext =
    routeView?.kind === 'branch' && routeView.branchName === workspaceCurrentBranchName
      ? { kind: 'routed', route: routeView.workspacePaneRoute }
      : { kind: 'inactive' }
  useEffect(() => {
    if (!compactWorkspaceTransitioning) {
      setCompactWorkspaceTransitioning(false)
      return
    }
    setCompactWorkspaceTransitioning(true)
    const timeout = window.setTimeout(() => {
      setCompactWorkspaceTransitioning(false)
    }, WORKSPACE_PANE_TRANSITION_MS)
    return () => window.clearTimeout(timeout)
  }, [compactWorkspaceTransitioning, setCompactWorkspaceTransitioning])

  if (!view.workspaceMembershipReady) {
    return (
      <WorkspaceLayoutSkeleton
        singlePane={compact}
        singlePaneView={singlePane}
        workspacePaneState={currentBranchName ? 'content' : 'empty'}
      />
    )
  }
  if (!view.exists || !workspace) return <RoutedWorkspaceNotFound workspaceId={workspaceId} />

  const zenModeCollapsed = !compact && view.zenMode && workspacePaneActive
  const workspaceTrafficLightOffset = zenModeCollapsed
  const sidebarSelectBranch = routeView
    ? (branchName: string) => onOpenRepoBranch?.(workspace.id, branchName)
    : undefined
  const sidebarCreateWorktree = routeView ? () => onOpenRepoNewWorktree?.(workspace.id) : undefined
  const sidebarOpenDashboard = routeView ? () => onOpenWorkspaceDashboard?.(workspace.id) : undefined
  const dashboardSelected = routeView?.kind === 'dashboard'
  const newWorktreeSelected = routeView?.kind === 'newWorktree'
  const renderSidebarPane = (
    branchContent?: ReactNode,
    chromeRegion: 'drag' | 'none' = zenModeCollapsed ? 'none' : 'drag',
  ) => (
    <WorkspaceLayoutPane>
      <WorkspaceLayoutSidebar
        workspaceId={workspace.id}
        git={git}
        compact={compact}
        branchContent={branchContent ?? (!gitCapabilitySettled ? <BranchNavigatorSkeleton /> : undefined)}
        chromeRegion={chromeRegion}
        onOpenSettings={onOpenSettings}
        onSelectBranch={sidebarSelectBranch}
        onCreateWorktree={sidebarCreateWorktree}
        onOpenDashboard={sidebarOpenDashboard}
        dashboardSelected={dashboardSelected}
        newWorktreeSelected={newWorktreeSelected}
        currentBranchName={routeBranchName}
        workspaceRootSelected={gitUnavailable && routeView?.kind === 'workspace-root'}
        onSelectWorkspaceRoot={gitUnavailable ? () => onOpenWorkspaceRootPane?.(workspace.id) : undefined}
      />
    </WorkspaceLayoutPane>
  )

  if (isWorkspaceUnavailable(workspace)) {
    return (
      <WorkspaceLayoutShell
        workspaceId={workspaceId}
        compact={compact}
        zenMode={view.zenMode}
        workspacePaneActive={workspacePaneActive}
        workspacePaneSize={view.workspacePaneSize}
        onWorkspacePaneSizeChange={setWorkspacePaneSize}
        sidebarPane={renderSidebarPane(compact ? <UnavailableWorkspaceView workspace={workspace} /> : undefined)}
        zenRevealSidebarPane={renderSidebarPane(undefined, 'none')}
        workspacePane={
          <WorkspaceLayoutPane>
            <WorkspaceChrome trafficLightOffset={workspaceTrafficLightOffset} />
            <UnavailableWorkspaceView workspace={workspace} />
          </WorkspaceLayoutPane>
        }
        singlePaneActivePane={compact ? 'navigator' : singlePane}
      />
    )
  }

  function renderWorkspace(projectionRestore: WorkspaceProjectionRestoreController | null): ReactNode {
    if (workspace.session.projectionState === 'stub' && !projectionRestore) {
      throw new Error('A filesystem workspace cannot own a Git projection stub')
    }
    if (workspace.session.projectionState === 'stub' && projectionRestore?.state.phase === 'failed') {
      const failure = (
        <WorkspaceProjectionFailureView
          workspace={workspace}
          message={projectionRestore.state.message}
          onRetry={projectionRestore.retry}
        />
      )
      return (
        <WorkspaceLayoutShell
          workspaceId={workspaceId}
          compact={compact}
          zenMode={view.zenMode}
          workspacePaneActive={workspacePaneActive}
          workspacePaneSize={view.workspacePaneSize}
          onWorkspacePaneSizeChange={setWorkspacePaneSize}
          sidebarPane={renderSidebarPane(compact ? failure : undefined)}
          zenRevealSidebarPane={renderSidebarPane(undefined, 'none')}
          workspacePane={
            <WorkspaceLayoutPane>
              <WorkspaceChrome trafficLightOffset={workspaceTrafficLightOffset} />
              {failure}
            </WorkspaceLayoutPane>
          }
          singlePaneActivePane={compact ? 'navigator' : singlePane}
        />
      )
    }

    if (workspace.session.projectionState === 'stub' || view.initialLoading) {
      return (
        <WorkspaceLayoutShell
          workspaceId={workspaceId}
          compact={compact}
          zenMode={view.zenMode}
          workspacePaneActive={workspacePaneActive}
          workspacePaneSize={view.workspacePaneSize}
          onWorkspacePaneSizeChange={setWorkspacePaneSize}
          sidebarPane={renderSidebarPane(compact && currentBranchName ? undefined : <BranchNavigatorSkeleton />)}
          zenRevealSidebarPane={renderSidebarPane(
            compact && currentBranchName ? undefined : <BranchNavigatorSkeleton />,
            'none',
          )}
          workspacePane={
            <WorkspaceLayoutPane>
              {currentBranchName ? (
                <WorkspacePaneSkeleton
                  toolbarDraggable={!compact}
                  toolbarTrafficLightOffset={workspaceTrafficLightOffset}
                />
              ) : (
                <>
                  <WorkspaceChrome trafficLightOffset={workspaceTrafficLightOffset} />
                  <EmptyWorkspacePaneSkeleton />
                </>
              )}
            </WorkspaceLayoutPane>
          }
          singlePaneActivePane={currentBranchName ? 'workspace' : 'navigator'}
        />
      )
    }

    return (
      <WorkspaceLayoutShell
        workspaceId={workspaceId}
        compact={compact}
        zenMode={view.zenMode}
        workspacePaneActive={workspacePaneActive}
        workspacePaneSize={view.workspacePaneSize}
        onWorkspacePaneSizeChange={setWorkspacePaneSize}
        sidebarPane={renderSidebarPane()}
        zenRevealSidebarPane={renderSidebarPane(undefined, 'none')}
        workspacePane={
          <WorkspaceLayoutPane>
            {routeView?.kind === 'dashboard' ? (
              <WorkspaceDashboardPane
                workspaceId={workspace.id}
                compact={compact}
                trafficLightOffset={workspaceTrafficLightOffset}
                onBack={() => onOpenWorkspaceNavigator?.(workspace.id)}
                onSelectBranch={(branchName) => onOpenRepoBranch?.(workspace.id, branchName)}
              />
            ) : routeView?.kind === 'workspace-root' ? (
              <WorkspacePane
                workspaceId={workspaceId}
                currentBranchName={null}
                workspacePaneRouteContext={{ kind: 'workspace-root' }}
                shortcutsEnabled={!compact || singlePane === 'workspace'}
                toolbarTrafficLightOffset={workspaceTrafficLightOffset}
                onBackToBranchNavigator={() => onOpenWorkspaceNavigator?.(workspace.id)}
              />
            ) : routeView?.kind === 'worktree' ? (
              <WorkspacePane
                workspaceId={workspaceId}
                currentBranchName={null}
                workspacePaneRouteContext={{
                  kind: 'git-worktree',
                  worktreePath: routeView.worktreePath,
                  route: routeView.workspacePaneRoute,
                }}
                shortcutsEnabled={!compact || singlePane === 'workspace'}
                toolbarTrafficLightOffset={workspaceTrafficLightOffset}
                onBackToBranchNavigator={() => onOpenWorkspaceNavigator?.(workspace.id)}
              />
            ) : routeView?.kind === 'newWorktree' ? (
              <CreateWorktreePagePane
                repoId={workspace.id}
                compact={compact}
                trafficLightOffset={workspaceTrafficLightOffset}
                onCancel={() => {
                  if (onCancelRepoNewWorktree) onCancelRepoNewWorktree(workspace.id)
                  else onOpenWorkspaceNavigator?.(workspace.id)
                }}
                onCreated={(branchName) => onReplaceRepoBranch?.(workspace.id, branchName)}
              />
            ) : routeView?.kind === 'empty' ? (
              <EmptyWorkspacePane trafficLightOffset={workspaceTrafficLightOffset} />
            ) : (
              <WorkspacePane
                workspaceId={workspaceId}
                currentBranchName={workspaceCurrentBranchName}
                workspacePaneRouteContext={workspacePaneRouteContext}
                shortcutsEnabled={!compact || singlePane === 'workspace'}
                toolbarTrafficLightOffset={workspaceTrafficLightOffset}
                onBackToBranchNavigator={routeView ? () => onOpenWorkspaceNavigator?.(workspace.id) : undefined}
              />
            )}
          </WorkspaceLayoutPane>
        }
        singlePaneActivePane={singlePane}
      />
    )
  }

  return git ? (
    <GitWorkspaceEffects workspaceId={workspaceId}>{renderWorkspace}</GitWorkspaceEffects>
  ) : (
    renderWorkspace(null)
  )
}

function GitWorkspaceEffects({
  workspaceId,
  children,
}: {
  workspaceId: WorkspaceId
  children: (projectionRestore: WorkspaceProjectionRestoreController) => ReactNode
}) {
  useRepoToasts(workspaceId)
  const projectionRestore = useRestoreWorkspaceTabsOnView({ workspaceId })
  return children(projectionRestore)
}

function RoutedWorkspaceNotFound({ workspaceId }: { workspaceId: WorkspaceId }) {
  const t = useT()
  const displayLocation = formatWorkspaceDisplayLocation(workspaceId)
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <div className="flex max-w-sm flex-col gap-2">
          <h1 className="text-sm font-medium text-foreground">{t('repo-route.not-found-title')}</h1>
          <p className="break-all text-sm text-muted-foreground">{displayLocation}</p>
        </div>
      </div>
    </section>
  )
}
