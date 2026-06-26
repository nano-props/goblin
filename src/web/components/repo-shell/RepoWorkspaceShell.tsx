import { type ReactNode } from 'react'
import {
  FocusModeSidebarReveal,
  FocusModeSidebarRevealTrigger,
  useFocusModeSidebarReveal,
} from '#/web/components/repo-shell/FocusModeSidebarReveal.tsx'
import { CompactRepoWorkspace, RepoWorkspace } from '#/web/components/Layout.tsx'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'
import { WINDOW_CHROME_HEIGHT_PX } from '#/shared/window-chrome.ts'

interface RepoWorkspaceShellProps {
  repoId?: string
  compact: boolean
  workspaceFocused: boolean
  branchWorkspaceActive: boolean
  workspacePaneSize: number
  onWorkspacePaneSizeChange: (size: number) => void
  branchNavigatorPane: ReactNode
  branchWorkspacePane: ReactNode
  singlePaneActivePane?: 'navigator' | 'workspace'
  focusToggleEnabled?: boolean
  onOpenSettings?: () => void
}

export function RepoWorkspaceShell({
  repoId,
  compact,
  workspaceFocused,
  branchWorkspaceActive,
  workspacePaneSize,
  onWorkspacePaneSizeChange,
  branchNavigatorPane,
  branchWorkspacePane,
  singlePaneActivePane = 'navigator',
  focusToggleEnabled = true,
  onOpenSettings,
}: RepoWorkspaceShellProps) {
  const effectiveWorkspaceFocused = focusToggleEnabled && workspaceFocused
  const behavior = repoWorkspaceBehavior({
    compact,
    workspaceFocused: effectiveWorkspaceFocused,
    branchWorkspaceActive,
  })
  const sidebarPaneSize = 100 - workspacePaneSize
  const focusRevealEnabled = !compact && behavior.branchNavigatorCollapsed
  const focusSidebar = useFocusModeSidebarReveal(focusRevealEnabled)

  const renderWorkspaceBody = (
    workspacePane: ReactNode,
    navigatorPane: ReactNode = branchNavigatorPane,
    activePane: 'navigator' | 'workspace' = singlePaneActivePane,
  ) => {
    if (compact) {
      return (
        <CompactRepoWorkspace
          activePane={activePane}
          branchNavigatorPane={navigatorPane}
          branchWorkspacePane={workspacePane}
        />
      )
    }

    if (behavior.singlePane) return activePane === 'workspace' ? workspacePane : navigatorPane

    return (
      <RepoWorkspace
        mode="split"
        workspacePaneSize={workspacePaneSize}
        onWorkspacePaneSizeChange={onWorkspacePaneSizeChange}
        branchNavigatorCollapsed={behavior.branchNavigatorCollapsed}
        branchNavigatorPane={navigatorPane}
        branchWorkspacePane={workspacePane}
      />
    )
  }

  return (
    <section className="relative flex min-w-0 flex-1 flex-col">
      {renderWorkspaceBody(branchWorkspacePane, branchNavigatorPane)}
      {focusSidebar.rendered && !compact ? (
        <FocusModeSidebarReveal
          repoId={repoId}
          open={focusSidebar.open}
          interactive={focusRevealEnabled}
          sidebarSize={sidebarPaneSize}
          onSidebarSizeChange={(nextSidebarSize) => onWorkspacePaneSizeChange(100 - nextSidebarSize)}
          onSurfaceEnter={focusSidebar.onSurfaceEnter}
          onSurfaceLeave={focusSidebar.onSurfaceLeave}
          onOpenSettings={onOpenSettings}
        />
      ) : null}
      {/* Electron folds app-region entries in DOM order; keep the button no-drag after reveal drag. */}
      {focusToggleEnabled && !compact ? (
        <div
          data-testid="focus-mode-toggle-overlay"
          data-focus-reveal-surface={focusRevealEnabled ? '' : undefined}
          className="goblin-focus-reveal-trigger-layer pointer-events-none absolute left-0 top-0 z-40 flex items-center bg-transparent"
          style={{ height: WINDOW_CHROME_HEIGHT_PX }}
        >
          <FocusModeSidebarRevealTrigger
            revealEnabled={focusRevealEnabled}
            onMouseEnter={focusSidebar.onTriggerEnter}
            onMouseLeave={focusSidebar.onTriggerLeave}
          />
        </div>
      ) : null}
    </section>
  )
}
