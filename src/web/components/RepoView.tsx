import { useEffect, type ReactNode } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { isRepoUnavailable } from '#/web/stores/repos/helpers.ts'
import { BranchWorkspace } from '#/web/components/BranchWorkspace.tsx'
import {
  BranchNavigatorSkeleton,
  BranchWorkspaceEmptySkeleton,
  BranchWorkspaceSkeleton,
} from '#/web/components/Skeleton.tsx'
import { RepoWorkspacePane } from '#/web/components/Layout.tsx'
import { useRepoToasts } from '#/web/hooks/useRepoToasts.tsx'
import { getRepoWorkspacePresentation } from '#/web/components/repo-workspace/model.ts'
import { UnavailableRepoView } from '#/web/components/UnavailableRepoView.tsx'
import { useResponsiveUiMode } from '#/web/hooks/useResponsiveUiMode.tsx'
import { WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'
import { useRetainedValueDuringExit } from '#/web/hooks/useRetainedValueDuringExit.ts'
import { useUiTransitionStore } from '#/web/stores/ui-transition.ts'
import { RepoShellSidebar } from '#/web/components/repo-shell/RepoShellSidebar.tsx'
import { WorkspaceChrome } from '#/web/components/workspace-toolbar-chrome.tsx'
import { RepoWorkspaceShell } from '#/web/components/repo-shell/RepoWorkspaceShell.tsx'

interface Props {
  repoId: string
  onOpenSettings?: () => void
}

export function RepoView({ repoId, onOpenSettings }: Props) {
  const uiMode = useResponsiveUiMode()
  const compact = uiMode === 'compact'
  const view = useStoreWithEqualityFn(
    useReposStore,
    (s) => {
      const repo = s.repos[repoId]
      const presentation = getRepoWorkspacePresentation(repo)
      return {
        exists: presentation.exists,
        initialLoading: presentation.initialLoading,
        zenMode: s.zenMode,
        workspacePaneSize: s.workspacePaneSize,
      }
    },
    (a, b) =>
      a.exists === b.exists &&
      a.initialLoading === b.initialLoading &&
      a.zenMode === b.zenMode &&
      a.workspacePaneSize === b.workspacePaneSize,
  )
  const setWorkspacePaneSize = useReposStore((s) => s.setWorkspacePaneSize)
  const repo = useReposStore((s) => s.repos[repoId])
  useRepoToasts(repoId)

  const branchWorkspaceActive = !!repo?.ui.selectedBranch
  const selectedBranch = repo?.ui.selectedBranch ?? null
  const singlePane = selectedBranch ? 'workspace' : 'navigator'
  const compactWorkspaceSelectedBranch = useRetainedValueDuringExit({
    value: selectedBranch,
    active: compact && singlePane === 'workspace',
    retainMs: WORKSPACE_PANE_TRANSITION_MS,
    resetKey: repoId,
  })

  // Publish "compact-workspace is mid-transition" to a global store
  // so the keyboard handler can suppress branch-action shortcuts for
  // the duration. Without this, the user sees branch X in the
  // workspace but pressing 'P' (pull) acts on the new live branch Y,
  // because the keyboard handler reads `repo.ui.selectedBranch`
  // directly. The transition is short (WORKSPACE_PANE_TRANSITION_MS
  // = 240 ms) and the suppression is imperceptible.
  const setCompactWorkspaceTransitioning = useUiTransitionStore((s) => s.setCompactWorkspaceTransitioning)
  const compactWorkspaceTransitioning =
    compact && compactWorkspaceSelectedBranch !== null && compactWorkspaceSelectedBranch !== selectedBranch
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

  const zenModeCollapsed = !compact && view.zenMode && branchWorkspaceActive
  const workspaceTrafficLightOffset = zenModeCollapsed

  const renderBranchNavigatorPane = (branchContent?: ReactNode) => (
    <RepoWorkspacePane>
      <RepoShellSidebar
        repoId={repoId}
        compact={compact}
        branchContent={branchContent}
        chromeRegion={zenModeCollapsed ? 'none' : 'drag'}
        onOpenSettings={onOpenSettings}
      />
    </RepoWorkspacePane>
  )

  if (isRepoUnavailable(repo)) {
    return (
      <RepoWorkspaceShell
        repoId={repoId}
        compact={compact}
        zenMode={view.zenMode}
        branchWorkspaceActive={branchWorkspaceActive}
        workspacePaneSize={view.workspacePaneSize}
        onWorkspacePaneSizeChange={setWorkspacePaneSize}
        branchNavigatorPane={renderBranchNavigatorPane(compact ? <UnavailableRepoView repo={repo} /> : undefined)}
        branchWorkspacePane={
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
      <RepoWorkspaceShell
        repoId={repoId}
        compact={compact}
        zenMode={view.zenMode}
        branchWorkspaceActive={branchWorkspaceActive}
        workspacePaneSize={view.workspacePaneSize}
        onWorkspacePaneSizeChange={setWorkspacePaneSize}
        branchNavigatorPane={renderBranchNavigatorPane(
          compact && selectedBranch ? undefined : <BranchNavigatorSkeleton />,
        )}
        branchWorkspacePane={
          <RepoWorkspacePane>
            {selectedBranch ? (
              <BranchWorkspaceSkeleton
                toolbarDraggable={!compact}
                toolbarTrafficLightOffset={workspaceTrafficLightOffset}
              />
            ) : (
              <>
                <WorkspaceChrome trafficLightOffset={workspaceTrafficLightOffset} />
                <BranchWorkspaceEmptySkeleton />
              </>
            )}
          </RepoWorkspacePane>
        }
        singlePaneActivePane={selectedBranch ? 'workspace' : 'navigator'}
        onOpenSettings={onOpenSettings}
      />
    )
  }

  return (
    <RepoWorkspaceShell
      repoId={repoId}
      compact={compact}
      zenMode={view.zenMode}
      branchWorkspaceActive={branchWorkspaceActive}
      workspacePaneSize={view.workspacePaneSize}
      onWorkspacePaneSizeChange={setWorkspacePaneSize}
      branchNavigatorPane={renderBranchNavigatorPane()}
      branchWorkspacePane={
        <RepoWorkspacePane>
          <BranchWorkspace
            repoId={repoId}
            selectedBranchName={compact ? compactWorkspaceSelectedBranch : undefined}
            shortcutsEnabled={!compact || singlePane === 'workspace'}
            toolbarTrafficLightOffset={workspaceTrafficLightOffset}
          />
        </RepoWorkspacePane>
      }
      singlePaneActivePane={singlePane}
      onOpenSettings={onOpenSettings}
    />
  )
}
