import { type ReactNode } from 'react'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { ZenModeSidebarChrome } from '#/web/components/repo-layout/ZenModeSidebarChrome.tsx'
import { CompactRepoWorkspace, RepoWorkspace } from '#/web/components/Layout.tsx'
import { repoWorkspaceBehavior } from '#/web/lib/workspace-layout.ts'

interface RepoWorkspaceShellBaseProps {
  workspaceId?: WorkspaceId
  compact: boolean
  zenMode: boolean
  repoWorkspaceActive: boolean
  workspacePaneSize: number
  onWorkspacePaneSizeChange: (size: number) => void
  sidebarPane: ReactNode
  repoWorkspacePane: ReactNode
  singlePaneActivePane?: 'navigator' | 'workspace'
}

type RepoWorkspaceShellProps = RepoWorkspaceShellBaseProps &
  (
    | {
        zenModeToggleEnabled?: true
        zenRevealSidebarPane: ReactNode
      }
    | {
        zenModeToggleEnabled: false
        zenRevealSidebarPane?: never
      }
  )

export function RepoLayoutWorkspaceShell({
  workspaceId,
  compact,
  zenMode,
  repoWorkspaceActive,
  workspacePaneSize,
  onWorkspacePaneSizeChange,
  sidebarPane,
  zenRevealSidebarPane,
  repoWorkspacePane,
  singlePaneActivePane = 'navigator',
  zenModeToggleEnabled = true,
}: RepoWorkspaceShellProps) {
  const effectiveZenMode = zenModeToggleEnabled && zenMode
  const behavior = repoWorkspaceBehavior({
    compact,
    zenMode: effectiveZenMode,
    repoWorkspaceActive,
  })
  const sidebarPaneSize = 100 - workspacePaneSize
  const zenRevealEnabled = !compact && behavior.sidebarCollapsed

  const renderWorkspaceBody = (
    workspacePane: ReactNode,
    navigatorPane: ReactNode = sidebarPane,
    activePane: 'navigator' | 'workspace' = singlePaneActivePane,
  ) => {
    if (compact) {
      return (
        <CompactRepoWorkspace
          activePane={activePane}
          sidebarPane={navigatorPane}
          repoWorkspacePane={workspacePane}
          transitionScopeKey={workspaceId}
        />
      )
    }

    if (behavior.singlePane) return activePane === 'workspace' ? workspacePane : navigatorPane

    return (
      <RepoWorkspace
        mode="split"
        workspacePaneSize={workspacePaneSize}
        onWorkspacePaneSizeChange={onWorkspacePaneSizeChange}
        sidebarCollapsed={behavior.sidebarCollapsed}
        sidebarPane={navigatorPane}
        repoWorkspacePane={workspacePane}
      />
    )
  }

  return (
    <section className="relative flex min-w-0 flex-1 flex-col">
      {renderWorkspaceBody(repoWorkspacePane, sidebarPane)}
      {!compact && zenModeToggleEnabled ? (
        <ZenModeSidebarChrome
          workspaceId={workspaceId}
          sidebarPane={zenRevealSidebarPane}
          zenModeToggleEnabled
          revealEnabled={zenRevealEnabled}
          sidebarSize={sidebarPaneSize}
          onSidebarSizeChange={(nextSidebarSize) => onWorkspacePaneSizeChange(100 - nextSidebarSize)}
        />
      ) : null}
    </section>
  )
}
