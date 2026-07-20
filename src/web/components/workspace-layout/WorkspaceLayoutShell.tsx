import { type ReactNode } from 'react'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { ZenModeSidebarChrome } from '#/web/components/workspace-layout/ZenModeSidebarChrome.tsx'
import { CompactWorkspaceLayout, WorkspaceSplitLayout } from '#/web/components/Layout.tsx'
import { workspaceLayoutBehavior } from '#/web/lib/workspace-layout.ts'

interface WorkspaceShellBaseProps {
  workspaceId?: WorkspaceId
  compact: boolean
  zenMode: boolean
  workspacePaneActive: boolean
  workspacePaneSize: number
  onWorkspacePaneSizeChange: (size: number) => void
  sidebarPane: ReactNode
  workspacePane: ReactNode
  singlePaneActivePane?: 'navigator' | 'workspace'
}

type WorkspaceShellProps = WorkspaceShellBaseProps &
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

export function WorkspaceLayoutShell({
  workspaceId,
  compact,
  zenMode,
  workspacePaneActive,
  workspacePaneSize,
  onWorkspacePaneSizeChange,
  sidebarPane,
  zenRevealSidebarPane,
  workspacePane,
  singlePaneActivePane = 'navigator',
  zenModeToggleEnabled = true,
}: WorkspaceShellProps) {
  const effectiveZenMode = zenModeToggleEnabled && zenMode
  const behavior = workspaceLayoutBehavior({
    compact,
    zenMode: effectiveZenMode,
    workspacePaneActive,
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
        <CompactWorkspaceLayout
          activePane={activePane}
          sidebarPane={navigatorPane}
          workspacePane={workspacePane}
          transitionScopeKey={workspaceId}
        />
      )
    }

    if (behavior.singlePane) return activePane === 'workspace' ? workspacePane : navigatorPane

    return (
      <WorkspaceSplitLayout
        mode="split"
        workspacePaneSize={workspacePaneSize}
        onWorkspacePaneSizeChange={onWorkspacePaneSizeChange}
        sidebarCollapsed={behavior.sidebarCollapsed}
        sidebarPane={navigatorPane}
        workspacePane={workspacePane}
      />
    )
  }

  return (
    <section className="relative flex min-w-0 flex-1 flex-col">
      {renderWorkspaceBody(workspacePane, sidebarPane)}
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
