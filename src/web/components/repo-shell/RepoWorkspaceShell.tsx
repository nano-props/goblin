import { type ReactNode } from 'react'
import { FocusModeSidebarChrome } from '#/web/components/repo-shell/FocusModeSidebarChrome.tsx'
import { CompactRepoWorkspace, RepoWorkspace } from '#/web/components/Layout.tsx'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'

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
      {!compact ? (
        <FocusModeSidebarChrome
          repoId={repoId}
          focusToggleEnabled={focusToggleEnabled}
          revealEnabled={focusRevealEnabled}
          sidebarSize={sidebarPaneSize}
          onSidebarSizeChange={(nextSidebarSize) => onWorkspacePaneSizeChange(100 - nextSidebarSize)}
          onOpenSettings={onOpenSettings}
        />
      ) : null}
    </section>
  )
}
