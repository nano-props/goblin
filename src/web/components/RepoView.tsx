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
import { CompactRepoWorkspace, RepoWorkspace, RepoWorkspacePane } from '#/web/components/Layout.tsx'
import { useRepoToasts } from '#/web/hooks/useRepoToasts.tsx'
import { getRepoWorkspacePresentation } from '#/web/components/repo-workspace/model.ts'
import { UnavailableRepoView } from '#/web/components/UnavailableRepoView.tsx'
import { useResponsiveUiMode } from '#/web/hooks/useResponsiveUiMode.tsx'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'
import { WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'
import { useRetainedValueDuringExit } from '#/web/hooks/useRetainedValueDuringExit.ts'
import { useUiTransitionStore } from '#/web/stores/ui-transition.ts'
import {
  FocusModeSidebarReveal,
  FocusModeSidebarRevealTrigger,
  useFocusModeSidebarReveal,
} from '#/web/components/repo-shell/FocusModeSidebarReveal.tsx'
import { RepoShellSidebar } from '#/web/components/repo-shell/RepoShellSidebar.tsx'
import { WINDOW_TOPBAR_HEIGHT_PX } from '#/shared/window-chrome.ts'

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
        workspaceFocused: s.workspaceFocused,
        workspacePaneSize: s.workspacePaneSize,
      }
    },
    (a, b) =>
      a.exists === b.exists &&
      a.initialLoading === b.initialLoading &&
      a.workspaceFocused === b.workspaceFocused &&
      a.workspacePaneSize === b.workspacePaneSize,
  )
  const setWorkspacePaneSize = useReposStore((s) => s.setWorkspacePaneSize)
  const repo = useReposStore((s) => s.repos[repoId])
  useRepoToasts(repoId)

  const branchWorkspaceActive = !!repo?.ui.selectedBranch
  const behavior = repoWorkspaceBehavior({
    compact,
    workspaceFocused: view.workspaceFocused,
    branchWorkspaceActive,
  })

  const workspacePaneSize = view.workspacePaneSize
  const sidebarPaneSize = 100 - workspacePaneSize
  const selectedBranch = repo?.ui.selectedBranch ?? null
  const singlePane = selectedBranch ? 'workspace' : 'navigator'
  const focusRevealEnabled = !compact && behavior.branchNavigatorCollapsed
  const focusSidebar = useFocusModeSidebarReveal(focusRevealEnabled)
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

  const renderBranchNavigatorPane = (branchContent?: ReactNode) => (
    <RepoWorkspacePane>
      <RepoShellSidebar
        repoId={repoId}
        compact={compact}
        branchContent={branchContent}
        onOpenSettings={onOpenSettings}
      />
    </RepoWorkspacePane>
  )

  const renderWorkspaceBody = ({
    branchWorkspacePane,
    branchNavigatorPane = renderBranchNavigatorPane(),
    compactActivePane = singlePane,
  }: {
    branchWorkspacePane: ReactNode
    branchNavigatorPane?: ReactNode
    compactActivePane?: 'navigator' | 'workspace'
  }) => {
    if (compact) {
      return (
        <CompactRepoWorkspace
          activePane={compactActivePane}
          branchNavigatorPane={branchNavigatorPane}
          branchWorkspacePane={branchWorkspacePane}
        />
      )
    }

    if (behavior.singlePane) return compactActivePane === 'workspace' ? branchWorkspacePane : branchNavigatorPane

    return (
      <RepoWorkspace
        mode="split"
        workspacePaneSize={workspacePaneSize}
        onWorkspacePaneSizeChange={setWorkspacePaneSize}
        branchNavigatorCollapsed={behavior.branchNavigatorCollapsed}
        branchNavigatorPane={branchNavigatorPane}
        branchWorkspacePane={branchWorkspacePane}
      />
    )
  }

  const renderWorkspaceSection = (workspaceBody: ReactNode, revealSidebar = false) => (
    <section className="relative flex min-w-0 flex-1 flex-col">
      {workspaceBody}
      {!compact ? (
        <div
          data-testid="focus-mode-toggle-overlay"
          data-interactive
          data-focus-reveal-surface={focusRevealEnabled ? '' : undefined}
          className="goblin-focus-reveal-trigger-layer pointer-events-none absolute left-0 top-0 z-40 flex items-center bg-transparent"
          style={{ height: WINDOW_TOPBAR_HEIGHT_PX }}
        >
          <FocusModeSidebarRevealTrigger
            revealEnabled={focusRevealEnabled}
            onMouseEnter={focusSidebar.onTriggerEnter}
            onMouseLeave={focusSidebar.onTriggerLeave}
          />
        </div>
      ) : null}
      {revealSidebar && !compact && focusSidebar.rendered ? (
        <FocusModeSidebarReveal
          repoId={repoId}
          open={focusSidebar.open}
          sidebarSize={sidebarPaneSize}
          onSidebarSizeChange={(nextSidebarSize) => setWorkspacePaneSize(100 - nextSidebarSize)}
          onSurfaceEnter={focusSidebar.onSurfaceEnter}
          onSurfaceLeave={focusSidebar.onSurfaceLeave}
          onOpenSettings={onOpenSettings}
        />
      ) : null}
    </section>
  )

  if (isRepoUnavailable(repo)) {
    const unavailablePane = (
      <RepoWorkspacePane>
        <UnavailableRepoView repo={repo} />
      </RepoWorkspacePane>
    )
    return renderWorkspaceSection(
      renderWorkspaceBody({
        branchWorkspacePane: unavailablePane,
        branchNavigatorPane: renderBranchNavigatorPane(compact ? <UnavailableRepoView repo={repo} /> : undefined),
        compactActivePane: compact ? 'navigator' : singlePane,
      }),
      true,
    )
  }

  if (view.initialLoading) {
    const loadingPane = (
      <RepoWorkspacePane>
        {selectedBranch ? <BranchWorkspaceSkeleton /> : <BranchWorkspaceEmptySkeleton />}
      </RepoWorkspacePane>
    )
    return renderWorkspaceSection(
      renderWorkspaceBody({
        branchWorkspacePane: loadingPane,
        branchNavigatorPane: renderBranchNavigatorPane(
          compact && selectedBranch ? undefined : <BranchNavigatorSkeleton />,
        ),
        compactActivePane: selectedBranch ? 'workspace' : 'navigator',
      }),
      true,
    )
  }

  const branchWorkspacePane = (
    <RepoWorkspacePane>
      <BranchWorkspace
        repoId={repoId}
        selectedBranchName={compact ? compactWorkspaceSelectedBranch : undefined}
        shortcutsEnabled={!compact || singlePane === 'workspace'}
        toolbarTrafficLightOffset={!compact && behavior.branchNavigatorCollapsed}
      />
    </RepoWorkspacePane>
  )
  return renderWorkspaceSection(renderWorkspaceBody({ branchWorkspacePane }), true)
}
