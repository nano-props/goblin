import { useEffect, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { isRepoUnavailable } from '#/web/stores/workspaces/workspace-guards.ts'
import { RepoWorkspace, type RepoWorkspacePaneRouteContext } from '#/web/components/RepoWorkspace.tsx'
import {
  BranchNavigatorSkeleton,
  RepoWorkspaceLayoutSkeleton,
  RepoWorkspaceEmptySkeleton,
  RepoWorkspaceSkeleton,
} from '#/web/components/Skeleton.tsx'
import { RepoWorkspacePane } from '#/web/components/Layout.tsx'
import { useRepoToasts } from '#/web/hooks/useRepoToasts.tsx'
import { useRestoreWorkspaceTabsOnView } from '#/web/hooks/useRestoreWorkspaceTabsOnView.ts'
import { getRepoWorkspacePresentation } from '#/web/components/repo-workspace/model.ts'
import { UnavailableRepoView } from '#/web/components/UnavailableRepoView.tsx'
import { RepoProjectionFailureView } from '#/web/components/RepoProjectionFailureView.tsx'
import { useResponsiveUiMode } from '#/web/hooks/useResponsiveUiMode.tsx'
import { WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'
import { useRetainedValueDuringExit } from '#/web/hooks/useRetainedValueDuringExit.ts'
import { useUiTransitionStore } from '#/web/stores/ui-transition.ts'
import { RepoLayoutSidebar } from '#/web/components/repo-layout/RepoLayoutSidebar.tsx'
import { WorkspaceChrome } from '#/web/components/workspace-toolbar-chrome.tsx'
import { RepoLayoutWorkspaceShell } from '#/web/components/repo-layout/RepoLayoutWorkspaceShell.tsx'
import { RepoDashboardPane } from '#/web/components/repo-pages/RepoDashboardPane.tsx'
import { CreateWorktreePagePane } from '#/web/components/repo-pages/CreateWorktreePagePane.tsx'
import type { RepoRouteView } from '#/web/App.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { formatWorkspaceDisplayLocation } from '#/web/lib/paths.ts'
import type { WorkspaceProjectionPromotionViewState } from '#/web/hooks/useRestoreWorkspaceTabsOnView.ts'

interface RepoProjectionRestoreController {
  state: WorkspaceProjectionPromotionViewState
  retry: () => void
}

function EmptyRepoWorkspacePane({ trafficLightOffset }: { trafficLightOffset: boolean }) {
  return (
    <section data-testid="repo-empty-workspace-pane" className="flex min-h-0 flex-1 flex-col bg-background">
      <WorkspaceChrome trafficLightOffset={trafficLightOffset} />
      <div className="min-h-0 flex-1" />
    </section>
  )
}

interface Props {
  workspaceId: string
  routeView?: RepoRouteView | null
  onOpenSettings?: () => void
  onOpenRepoRoot?: (workspaceId: string) => void
  onOpenWorkspaceRoot?: (workspaceId: string) => void
  onOpenRepoDashboard?: (workspaceId: string) => void
  onOpenRepoBranch?: (workspaceId: string, branchName: string) => void
  onOpenRepoNewWorktree?: (workspaceId: string) => void
  onCancelRepoNewWorktree?: (workspaceId: string) => void
  onReplaceRepoBranch?: (workspaceId: string, branchName: string) => void
}

export function RepoView({
  workspaceId,
  routeView = null,
  onOpenSettings,
  onOpenRepoRoot,
  onOpenWorkspaceRoot,
  onOpenRepoDashboard,
  onOpenRepoBranch,
  onOpenRepoNewWorktree,
  onCancelRepoNewWorktree,
  onReplaceRepoBranch,
}: Props) {
  const uiMode = useResponsiveUiMode()
  const compact = uiMode === 'compact'
  const view = useWorkspacesStore(
    useShallow((s) => {
      const repo = s.workspaces[workspaceId]
      const presentation = getRepoWorkspacePresentation(repo)
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
  const repo = useWorkspacesStore((s) => s.workspaces[workspaceId])
  const git = repo?.capability.kind === 'git' ? repo.capability.git : null
  const gitAvailable = git !== null
  const gitUnavailable = repo?.capability.kind === 'filesystem'
  const gitCapabilitySettled = gitAvailable || gitUnavailable

  const routeBranchName = routeView?.kind === 'branch' ? routeView.branchName : null

  const currentBranchName = routeView?.kind === 'branch' ? routeView.branchName : null
  const routeWorkspacePageActive =
    routeView?.kind === 'workspace-root' ||
    routeView?.kind === 'worktree' ||
    routeView?.kind === 'dashboard' ||
    routeView?.kind === 'newWorktree'
  const repoWorkspaceActive = currentBranchName !== null || routeWorkspacePageActive
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
  const workspacePaneRouteContext: RepoWorkspacePaneRouteContext =
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
      <RepoWorkspaceLayoutSkeleton
        singlePane={compact}
        singlePaneView={singlePane}
        repoWorkspaceState={currentBranchName ? 'content' : 'empty'}
      />
    )
  }
  if (!view.exists || !repo) return <RoutedRepoNotFound workspaceId={workspaceId} />

  const zenModeCollapsed = !compact && view.zenMode && repoWorkspaceActive
  const workspaceTrafficLightOffset = zenModeCollapsed
  const sidebarSelectBranch = routeView ? (branchName: string) => onOpenRepoBranch?.(repo.id, branchName) : undefined
  const sidebarCreateWorktree = routeView ? () => onOpenRepoNewWorktree?.(repo.id) : undefined
  const sidebarOpenDashboard = routeView ? () => onOpenRepoDashboard?.(repo.id) : undefined
  const dashboardSelected = routeView?.kind === 'dashboard'
  const newWorktreeSelected = routeView?.kind === 'newWorktree'
  const renderSidebarPane = (
    branchContent?: ReactNode,
    chromeRegion: 'drag' | 'none' = zenModeCollapsed ? 'none' : 'drag',
  ) => (
    <RepoWorkspacePane>
      <RepoLayoutSidebar
        workspaceId={workspaceId}
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
        onSelectWorkspaceRoot={gitUnavailable ? () => onOpenWorkspaceRoot?.(repo.id) : undefined}
      />
    </RepoWorkspacePane>
  )

  if (isRepoUnavailable(repo)) {
    return (
      <RepoLayoutWorkspaceShell
        workspaceId={workspaceId}
        compact={compact}
        zenMode={view.zenMode}
        repoWorkspaceActive={repoWorkspaceActive}
        workspacePaneSize={view.workspacePaneSize}
        onWorkspacePaneSizeChange={setWorkspacePaneSize}
        sidebarPane={renderSidebarPane(compact ? <UnavailableRepoView repo={repo} /> : undefined)}
        zenRevealSidebarPane={renderSidebarPane(undefined, 'none')}
        repoWorkspacePane={
          <RepoWorkspacePane>
            <WorkspaceChrome trafficLightOffset={workspaceTrafficLightOffset} />
            <UnavailableRepoView repo={repo} />
          </RepoWorkspacePane>
        }
        singlePaneActivePane={compact ? 'navigator' : singlePane}
      />
    )
  }

  function renderWorkspace(projectionRestore: RepoProjectionRestoreController | null): ReactNode {
    if (repo.session.projectionState === 'stub' && !projectionRestore) {
      throw new Error('A filesystem workspace cannot own a Git projection stub')
    }
    if (repo.session.projectionState === 'stub' && projectionRestore?.state.phase === 'failed') {
      const failure = (
        <RepoProjectionFailureView
          repo={repo}
          message={projectionRestore.state.message}
          onRetry={projectionRestore.retry}
        />
      )
      return (
        <RepoLayoutWorkspaceShell
          workspaceId={workspaceId}
          compact={compact}
          zenMode={view.zenMode}
          repoWorkspaceActive={repoWorkspaceActive}
          workspacePaneSize={view.workspacePaneSize}
          onWorkspacePaneSizeChange={setWorkspacePaneSize}
          sidebarPane={renderSidebarPane(compact ? failure : undefined)}
          zenRevealSidebarPane={renderSidebarPane(undefined, 'none')}
          repoWorkspacePane={
            <RepoWorkspacePane>
              <WorkspaceChrome trafficLightOffset={workspaceTrafficLightOffset} />
              {failure}
            </RepoWorkspacePane>
          }
          singlePaneActivePane={compact ? 'navigator' : singlePane}
        />
      )
    }

    if (repo.session.projectionState === 'stub' || view.initialLoading) {
      return (
        <RepoLayoutWorkspaceShell
          workspaceId={workspaceId}
          compact={compact}
          zenMode={view.zenMode}
          repoWorkspaceActive={repoWorkspaceActive}
          workspacePaneSize={view.workspacePaneSize}
          onWorkspacePaneSizeChange={setWorkspacePaneSize}
          sidebarPane={renderSidebarPane(compact && currentBranchName ? undefined : <BranchNavigatorSkeleton />)}
          zenRevealSidebarPane={renderSidebarPane(
            compact && currentBranchName ? undefined : <BranchNavigatorSkeleton />,
            'none',
          )}
          repoWorkspacePane={
            <RepoWorkspacePane>
              {currentBranchName ? (
                <RepoWorkspaceSkeleton
                  toolbarDraggable={!compact}
                  toolbarTrafficLightOffset={workspaceTrafficLightOffset}
                />
              ) : (
                <>
                  <WorkspaceChrome trafficLightOffset={workspaceTrafficLightOffset} />
                  <RepoWorkspaceEmptySkeleton />
                </>
              )}
            </RepoWorkspacePane>
          }
          singlePaneActivePane={currentBranchName ? 'workspace' : 'navigator'}
        />
      )
    }

    return (
      <RepoLayoutWorkspaceShell
        workspaceId={workspaceId}
        compact={compact}
        zenMode={view.zenMode}
        repoWorkspaceActive={repoWorkspaceActive}
        workspacePaneSize={view.workspacePaneSize}
        onWorkspacePaneSizeChange={setWorkspacePaneSize}
        sidebarPane={renderSidebarPane()}
        zenRevealSidebarPane={renderSidebarPane(undefined, 'none')}
        repoWorkspacePane={
          <RepoWorkspacePane>
            {routeView?.kind === 'dashboard' ? (
              <RepoDashboardPane
                repoId={repo.id}
                compact={compact}
                trafficLightOffset={workspaceTrafficLightOffset}
                onBack={() => onOpenRepoRoot?.(repo.id)}
                onSelectBranch={(branchName) => onOpenRepoBranch?.(repo.id, branchName)}
              />
            ) : routeView?.kind === 'workspace-root' ? (
              <RepoWorkspace
                workspaceId={workspaceId}
                currentBranchName={null}
                workspacePaneRouteContext={{ kind: 'workspace-root' }}
                shortcutsEnabled={!compact || singlePane === 'workspace'}
                toolbarTrafficLightOffset={workspaceTrafficLightOffset}
                onBackToBranchNavigator={() => onOpenRepoRoot?.(repo.id)}
              />
            ) : routeView?.kind === 'worktree' ? (
              <RepoWorkspace
                workspaceId={workspaceId}
                currentBranchName={null}
                workspacePaneRouteContext={{
                  kind: 'git-worktree',
                  worktreePath: routeView.worktreePath,
                  route: routeView.workspacePaneRoute,
                }}
                shortcutsEnabled={!compact || singlePane === 'workspace'}
                toolbarTrafficLightOffset={workspaceTrafficLightOffset}
                onBackToBranchNavigator={() => onOpenRepoRoot?.(repo.id)}
              />
            ) : routeView?.kind === 'newWorktree' ? (
              <CreateWorktreePagePane
                repoId={repo.id}
                compact={compact}
                trafficLightOffset={workspaceTrafficLightOffset}
                onCancel={() => {
                  if (onCancelRepoNewWorktree) onCancelRepoNewWorktree(repo.id)
                  else onOpenRepoRoot?.(repo.id)
                }}
                onCreated={(branchName) => onReplaceRepoBranch?.(repo.id, branchName)}
              />
            ) : routeView?.kind === 'empty' ? (
              <EmptyRepoWorkspacePane trafficLightOffset={workspaceTrafficLightOffset} />
            ) : (
              <RepoWorkspace
                workspaceId={workspaceId}
                currentBranchName={workspaceCurrentBranchName}
                workspacePaneRouteContext={workspacePaneRouteContext}
                shortcutsEnabled={!compact || singlePane === 'workspace'}
                toolbarTrafficLightOffset={workspaceTrafficLightOffset}
                onBackToBranchNavigator={routeView ? () => onOpenRepoRoot?.(repo.id) : undefined}
              />
            )}
          </RepoWorkspacePane>
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
  workspaceId: string
  children: (projectionRestore: RepoProjectionRestoreController) => ReactNode
}) {
  useRepoToasts(workspaceId)
  const projectionRestore = useRestoreWorkspaceTabsOnView({ workspaceId })
  return children(projectionRestore)
}

function RoutedRepoNotFound({ workspaceId }: { workspaceId: string }) {
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
