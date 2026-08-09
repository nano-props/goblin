import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import type { FunctionalComponent } from 'vue'
import { TITLE_BAR_HEIGHT_PX } from '#/shared/title-bar-chrome.ts'
import { WorkspaceNavigationControls } from '#/web/components/WorkspaceNavigationControls.tsx'
import { TitleBarInteractiveRegion } from '#/web/components/title-bar-chrome-region.tsx'

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
      style={{ height: `${TITLE_BAR_HEIGHT_PX}px` }}
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
    <TitleBarInteractiveRegion>
      <WorkspaceNavigationControls
        workspaceId={workspaceId}
        zenRevealTriggerEnabled={zenRevealTriggerEnabled}
        onZenRevealTriggerEnter={onZenRevealTriggerEnter}
      />
    </TitleBarInteractiveRegion>
  )
}
ZenModeSidebarRevealTrigger.props = ['workspaceId', 'zenRevealTriggerEnabled', 'onZenRevealTriggerEnter']
ZenModeSidebarRevealTrigger.inheritAttrs = false
