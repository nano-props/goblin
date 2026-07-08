import { useEffect, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { isRepoUnavailable } from '#/web/stores/repos/repo-guards.ts'
import { RepoWorkspace, type RepoWorkspacePaneRouteContext } from '#/web/components/RepoWorkspace.tsx'
import {
  BranchNavigatorSkeleton,
  RepoWorkspaceLayoutSkeleton,
  RepoWorkspaceEmptySkeleton,
  RepoWorkspaceSkeleton,
} from '#/web/components/Skeleton.tsx'
import { RepoWorkspacePane } from '#/web/components/Layout.tsx'
import { useRepoToasts } from '#/web/hooks/useRepoToasts.tsx'
import { getRepoWorkspacePresentation } from '#/web/components/repo-workspace/model.ts'
import { UnavailableRepoView } from '#/web/components/UnavailableRepoView.tsx'
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

function EmptyRepoWorkspacePane({ trafficLightOffset }: { trafficLightOffset: boolean }) {
  return (
    <section data-testid="repo-empty-workspace-pane" className="flex min-h-0 flex-1 flex-col bg-background">
      <WorkspaceChrome trafficLightOffset={trafficLightOffset} />
      <div className="min-h-0 flex-1" />
    </section>
  )
}

interface Props {
  repoId: string
  routeView?: RepoRouteView | null
  onOpenSettings?: () => void
  onOpenRepoRoot?: (repoId: string) => void
  onOpenRepoDashboard?: (repoId: string) => void
  onOpenRepoBranch?: (repoId: string, branchName: string) => void
  onOpenRepoNewWorktree?: (repoId: string) => void
  onCancelRepoNewWorktree?: (repoId: string) => void
  onReplaceRepoBranch?: (repoId: string, branchName: string) => void
}

export function RepoView({
  repoId,
  routeView = null,
  onOpenSettings,
  onOpenRepoRoot,
  onOpenRepoDashboard,
  onOpenRepoBranch,
  onOpenRepoNewWorktree,
  onCancelRepoNewWorktree,
  onReplaceRepoBranch,
}: Props) {
  const uiMode = useResponsiveUiMode()
  const compact = uiMode === 'compact'
  const view = useReposStore(
    useShallow((s) => {
      const repo = s.repos[repoId]
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
  const setWorkspacePaneSize = useReposStore((s) => s.setWorkspacePaneSize)
  const repo = useReposStore((s) => s.repos[repoId])
  useRepoToasts(repoId)

  const routeBranchName = routeView?.kind === 'branch' ? routeView.branchName : null

  const currentBranchName = routeView?.kind === 'branch' ? routeView.branchName : null
  const routeWorkspacePageActive = routeView?.kind === 'dashboard' || routeView?.kind === 'newWorktree'
  const repoWorkspaceActive = currentBranchName !== null || routeWorkspacePageActive
  const singlePane = currentBranchName || routeWorkspacePageActive ? 'workspace' : 'navigator'
  const compactWorkspaceCurrentBranchName = useRetainedValueDuringExit({
    value: currentBranchName,
    active: compact && singlePane === 'workspace',
    retainMs: WORKSPACE_PANE_TRANSITION_MS,
    resetKey: repoId,
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

  if (!view.exists || !repo) {
    if (!view.workspaceMembershipReady) {
      return (
        <RepoWorkspaceLayoutSkeleton
          singlePane={compact}
          singlePaneView={singlePane}
          repoWorkspaceState={currentBranchName ? 'content' : 'empty'}
        />
      )
    }
    return <RoutedRepoNotFound repoId={repoId} />
  }

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
        repoId={repoId}
        compact={compact}
        branchContent={branchContent}
        chromeRegion={chromeRegion}
        onOpenSettings={onOpenSettings}
        onSelectBranch={sidebarSelectBranch}
        onCreateWorktree={sidebarCreateWorktree}
        onOpenDashboard={sidebarOpenDashboard}
        dashboardSelected={dashboardSelected}
        newWorktreeSelected={newWorktreeSelected}
        currentBranchName={routeBranchName}
      />
    </RepoWorkspacePane>
  )

  if (isRepoUnavailable(repo)) {
    return (
      <RepoLayoutWorkspaceShell
        repoId={repoId}
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

  if (view.initialLoading) {
    return (
      <RepoLayoutWorkspaceShell
        repoId={repoId}
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
      repoId={repoId}
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
              repoId={repoId}
              compact={compact}
              trafficLightOffset={workspaceTrafficLightOffset}
              onBack={() => onOpenRepoRoot?.(repo.id)}
              onSelectBranch={(branchName) => onOpenRepoBranch?.(repo.id, branchName)}
            />
          ) : routeView?.kind === 'newWorktree' ? (
            <CreateWorktreePagePane
              repoId={repoId}
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
              repoId={repoId}
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

function RoutedRepoNotFound({ repoId }: { repoId: string }) {
  const t = useT()
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <div className="flex max-w-sm flex-col gap-2">
          <h1 className="text-sm font-medium text-foreground">{t('repo-route.not-found-title')}</h1>
          <p className="break-all text-sm text-muted-foreground">{repoId}</p>
        </div>
      </div>
    </section>
  )
}
