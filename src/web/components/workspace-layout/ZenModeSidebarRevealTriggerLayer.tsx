import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { TITLE_BAR_HEIGHT_PX } from '#/shared/title-bar-chrome.ts'
import { WorkspaceNavigationControls } from '#/web/components/WorkspaceNavigationControls.tsx'
import { TitleBarInteractiveRegion } from '#/web/components/title-bar-chrome-region.tsx'

interface ZenModeSidebarRevealTriggerProps {
  workspaceId?: WorkspaceId
  zenRevealTriggerEnabled?: boolean
  onZenRevealTriggerEnter?: () => void
}

export function ZenModeSidebarRevealTriggerLayer({
  workspaceId,
  zenRevealTriggerEnabled = false,
  onZenRevealTriggerEnter,
}: ZenModeSidebarRevealTriggerProps) {
  return (
    <div
      data-testid="zen-mode-toggle-overlay"
      className="goblin-zen-reveal-trigger-layer pointer-events-none absolute left-0 top-0 z-40 flex items-center bg-transparent"
      style={{ height: TITLE_BAR_HEIGHT_PX }}
    >
      <ZenModeSidebarRevealTrigger
        workspaceId={workspaceId}
        zenRevealTriggerEnabled={zenRevealTriggerEnabled}
        onZenRevealTriggerEnter={onZenRevealTriggerEnter}
      />
    </div>
  )
}

function ZenModeSidebarRevealTrigger({
  workspaceId,
  zenRevealTriggerEnabled = false,
  onZenRevealTriggerEnter,
}: ZenModeSidebarRevealTriggerProps) {
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
