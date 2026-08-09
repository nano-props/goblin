import type { FunctionalComponent, VNodeChild } from 'vue'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { CompactWorkspaceLayout, WorkspaceSplitLayout } from '#/web/components/Layout.tsx'
import { ZenModeSidebarChrome } from '#/web/components/workspace-layout/ZenModeSidebarChrome.tsx'
import { workspaceLayoutBehavior } from '#/web/lib/workspace-layout.ts'

interface WorkspaceLayoutShellProps {
  workspaceId?: WorkspaceId
  compact: boolean
  zenMode: boolean
  workspacePaneActive: boolean
  workspacePaneSize: number
  onWorkspacePaneSizeChange: (size: number) => void
  sidebarPane: VNodeChild
  workspacePane: VNodeChild
  singlePaneActivePane?: 'navigator' | 'workspace'
  zenModeToggleEnabled?: boolean
  zenRevealSidebarPane?: VNodeChild
}

export const WorkspaceLayoutShell: FunctionalComponent<WorkspaceLayoutShellProps> = (props) => {
  const zenModeToggleEnabled = props.zenModeToggleEnabled ?? true
  const effectiveZenMode = zenModeToggleEnabled && props.zenMode
  const behavior = workspaceLayoutBehavior({
    compact: props.compact,
    zenMode: effectiveZenMode,
    workspacePaneActive: props.workspacePaneActive,
  })
  const sidebarPaneSize = 100 - props.workspacePaneSize
  const zenRevealEnabled = !props.compact && behavior.sidebarCollapsed
  const activePane = props.singlePaneActivePane ?? 'navigator'

  let workspaceBody: VNodeChild
  if (props.compact) {
    workspaceBody = (
      <CompactWorkspaceLayout
        activePane={activePane}
        sidebarPane={props.sidebarPane}
        workspacePane={props.workspacePane}
        transitionScopeKey={props.workspaceId}
      />
    )
  } else if (behavior.singlePane) {
    workspaceBody = activePane === 'workspace' ? props.workspacePane : props.sidebarPane
  } else {
    workspaceBody = (
      <WorkspaceSplitLayout
        mode="split"
        workspacePaneSize={props.workspacePaneSize}
        onWorkspacePaneSizeChange={props.onWorkspacePaneSizeChange}
        sidebarCollapsed={behavior.sidebarCollapsed}
        sidebarPane={props.sidebarPane}
        workspacePane={props.workspacePane}
      />
    )
  }

  return (
    <section class="relative flex min-w-0 flex-1 flex-col">
      {workspaceBody}
      {!props.compact && zenModeToggleEnabled && props.zenRevealSidebarPane ? (
        <ZenModeSidebarChrome
          workspaceId={props.workspaceId}
          sidebarPane={props.zenRevealSidebarPane}
          zenModeToggleEnabled
          revealEnabled={zenRevealEnabled}
          sidebarSize={sidebarPaneSize}
          onSidebarSizeChange={(nextSidebarSize) => props.onWorkspacePaneSizeChange(100 - nextSidebarSize)}
        />
      ) : null}
    </section>
  )
}

WorkspaceLayoutShell.props = [
  'workspaceId',
  'compact',
  'zenMode',
  'workspacePaneActive',
  'workspacePaneSize',
  'onWorkspacePaneSizeChange',
  'sidebarPane',
  'workspacePane',
  'singlePaneActivePane',
  'zenModeToggleEnabled',
  'zenRevealSidebarPane',
]
