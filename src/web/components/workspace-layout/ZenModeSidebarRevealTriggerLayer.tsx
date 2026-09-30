import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { FunctionalComponent } from 'vue'
import { WORKSPACE_TOOLBAR_HEIGHT_PX } from '#/web/components/workspace-toolbar-layout.ts'
import { WorkspaceNavigationControls } from '#/web/components/WorkspaceNavigationControls.tsx'
import { InteractiveRegion } from '#/web/components/interactive-region.tsx'

interface ZenModeSidebarRevealTriggerProps {
  workspaceId?: WorkspaceId
  zenRevealTriggerEnabled?: boolean
  onZenRevealTriggerEnter?: () => void
}

export const ZenModeSidebarRevealTriggerLayer: FunctionalComponent<ZenModeSidebarRevealTriggerProps> = ({
  workspaceId,
  zenRevealTriggerEnabled = false,
  onZenRevealTriggerEnter,
}) => {
  return (
    <div
      data-testid="zen-mode-toggle-overlay"
      class="goblin-zen-reveal-trigger-layer pointer-events-none absolute left-0 top-0 z-40 flex items-center bg-transparent"
      style={{ height: `${WORKSPACE_TOOLBAR_HEIGHT_PX}px` }}
    >
      <ZenModeSidebarRevealTrigger
        workspaceId={workspaceId}
        zenRevealTriggerEnabled={zenRevealTriggerEnabled}
        onZenRevealTriggerEnter={onZenRevealTriggerEnter}
      />
    </div>
  )
}
ZenModeSidebarRevealTriggerLayer.props = ['workspaceId', 'zenRevealTriggerEnabled', 'onZenRevealTriggerEnter']
ZenModeSidebarRevealTriggerLayer.inheritAttrs = false

const ZenModeSidebarRevealTrigger: FunctionalComponent<ZenModeSidebarRevealTriggerProps> = ({
  workspaceId,
  zenRevealTriggerEnabled = false,
  onZenRevealTriggerEnter,
}) => {
  return (
    <InteractiveRegion>
      <WorkspaceNavigationControls
        workspaceId={workspaceId}
        zenRevealTriggerEnabled={zenRevealTriggerEnabled}
        onZenRevealTriggerEnter={onZenRevealTriggerEnter}
      />
    </InteractiveRegion>
  )
}
ZenModeSidebarRevealTrigger.props = ['workspaceId', 'zenRevealTriggerEnabled', 'onZenRevealTriggerEnter']
ZenModeSidebarRevealTrigger.inheritAttrs = false
