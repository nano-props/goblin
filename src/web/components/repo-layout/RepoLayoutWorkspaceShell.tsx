import { type ReactNode } from 'react'
import { ZenModeSidebarChrome } from '#/web/components/repo-layout/ZenModeSidebarChrome.tsx'
import { CompactRepoWorkspace, RepoWorkspace } from '#/web/components/Layout.tsx'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'

interface RepoWorkspaceShellProps {
  repoId?: string
  compact: boolean
  zenMode: boolean
  repoWorkspaceActive: boolean
  workspacePaneSize: number
  onWorkspacePaneSizeChange: (size: number) => void
  branchNavigatorPane: ReactNode
  repoWorkspacePane: ReactNode
  singlePaneActivePane?: 'navigator' | 'workspace'
  zenModeToggleEnabled?: boolean
  onOpenSettings?: () => void
}

export function RepoLayoutWorkspaceShell({
  repoId,
  compact,
  zenMode,
  repoWorkspaceActive,
  workspacePaneSize,
  onWorkspacePaneSizeChange,
  branchNavigatorPane,
  repoWorkspacePane,
  singlePaneActivePane = 'navigator',
  zenModeToggleEnabled = true,
  onOpenSettings,
}: RepoWorkspaceShellProps) {
  const effectiveZenMode = zenModeToggleEnabled && zenMode
  const behavior = repoWorkspaceBehavior({
    compact,
    zenMode: effectiveZenMode,
    repoWorkspaceActive,
  })
  const sidebarPaneSize = 100 - workspacePaneSize
  const zenRevealEnabled = !compact && behavior.branchNavigatorCollapsed

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
          repoWorkspacePane={workspacePane}
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
        repoWorkspacePane={workspacePane}
      />
    )
  }

  return (
    <section className="relative flex min-w-0 flex-1 flex-col">
      {renderWorkspaceBody(repoWorkspacePane, branchNavigatorPane)}
      {!compact ? (
        <ZenModeSidebarChrome
          repoId={repoId}
          zenModeToggleEnabled={zenModeToggleEnabled}
          revealEnabled={zenRevealEnabled}
          sidebarSize={sidebarPaneSize}
          onSidebarSizeChange={(nextSidebarSize) => onWorkspacePaneSizeChange(100 - nextSidebarSize)}
          onOpenSettings={onOpenSettings}
        />
      ) : null}
    </section>
  )
}
