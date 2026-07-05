import { useEffect, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { isRepoUnavailable } from '#/web/stores/repos/repo-guards.ts'
import { RepoWorkspace } from '#/web/components/RepoWorkspace.tsx'
import {
  BranchNavigatorSkeleton,
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

interface Props {
  repoId: string
  routeView?: RepoRouteView | null
  onOpenSettings?: () => void
  onOpenRepoDashboard?: (repoId: string) => void
  onOpenRepoBranch?: (repoId: string, branchName: string) => void
  onOpenRepoNewWorktree?: (repoId: string) => void
}

export function RepoView({
  repoId,
  routeView = null,
  onOpenSettings,
  onOpenRepoDashboard,
  onOpenRepoBranch,
  onOpenRepoNewWorktree,
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
        zenMode: s.zenMode,
        workspacePaneSize: s.workspacePaneSize,
      }
    }),
  )
  const setWorkspacePaneSize = useReposStore((s) => s.setWorkspacePaneSize)
  const repo = useReposStore((s) => s.repos[repoId])
  useRepoToasts(repoId)

  const routeBranchName = routeView?.kind === 'branch' ? routeView.branchName : null

  const repoWorkspaceActive = routeView ? true : false
  const currentBranchName = routeView?.kind === 'branch' ? routeView.branchName : null
  const singlePane = currentBranchName ? 'workspace' : 'navigator'
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

  if (!view.exists || !repo) return <div />

  const zenModeCollapsed = !compact && view.zenMode && repoWorkspaceActive
  const workspaceTrafficLightOffset = zenModeCollapsed
  const renderBranchNavigatorPane = (branchContent?: ReactNode) => (
    <RepoWorkspacePane>
      <RepoLayoutSidebar
        repoId={repoId}
        compact={compact}
        branchContent={branchContent}
        chromeRegion={zenModeCollapsed ? 'none' : 'drag'}
        onOpenSettings={onOpenSettings}
        onSelectBranch={routeView ? (branchName) => onOpenRepoBranch?.(repo.id, branchName) : undefined}
        onCreateWorktree={routeView ? () => onOpenRepoNewWorktree?.(repo.id) : undefined}
        onOpenDashboard={routeView ? () => onOpenRepoDashboard?.(repo.id) : undefined}
        dashboardSelected={routeView?.kind === 'dashboard'}
        newWorktreeSelected={routeView?.kind === 'newWorktree'}
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
        branchNavigatorPane={renderBranchNavigatorPane(compact ? <UnavailableRepoView repo={repo} /> : undefined)}
        repoWorkspacePane={
          <RepoWorkspacePane>
            <WorkspaceChrome trafficLightOffset={workspaceTrafficLightOffset} />
            <UnavailableRepoView repo={repo} />
          </RepoWorkspacePane>
        }
        singlePaneActivePane={compact ? 'navigator' : singlePane}
        onOpenSettings={onOpenSettings}
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
        branchNavigatorPane={renderBranchNavigatorPane(
          compact && currentBranchName ? undefined : <BranchNavigatorSkeleton />,
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
        onOpenSettings={onOpenSettings}
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
      branchNavigatorPane={renderBranchNavigatorPane()}
      repoWorkspacePane={
        <RepoWorkspacePane>
          {routeView?.kind === 'dashboard' ? (
            <RepoDashboardPane trafficLightOffset={workspaceTrafficLightOffset} />
          ) : routeView?.kind === 'newWorktree' ? (
            <CreateWorktreePagePane
              repoId={repoId}
              trafficLightOffset={workspaceTrafficLightOffset}
              onCancel={() => onOpenRepoDashboard?.(repo.id)}
            />
          ) : (
            <RepoWorkspace
              repoId={repoId}
              currentBranchName={compact ? compactWorkspaceCurrentBranchName : currentBranchName}
              shortcutsEnabled={!compact || singlePane === 'workspace'}
              toolbarTrafficLightOffset={workspaceTrafficLightOffset}
              onBackToRepoDashboard={routeView ? () => onOpenRepoDashboard?.(repo.id) : undefined}
            />
          )}
        </RepoWorkspacePane>
      }
      singlePaneActivePane={routeView?.kind === 'dashboard' || routeView?.kind === 'newWorktree' ? 'workspace' : singlePane}
      onOpenSettings={onOpenSettings}
    />
  )
}
