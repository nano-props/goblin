import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { TITLE_BAR_HEIGHT_PX } from '#/shared/title-bar-chrome.ts'
import { WorkspaceNavigationControls } from '#/web/components/WorkspaceNavigationControls.tsx'
import { NativeDragPlate, TitleBarInteractiveRegion } from '#/web/components/title-bar-chrome-region.tsx'
import { ResizeHandleLine, resizeHandleClassNames } from '#/web/components/ui/resizable.tsx'
import { cn } from '#/web/lib/cn.ts'

const ZEN_REVEAL_RESIZE_HIT_TARGET_STYLE = {
  top: TITLE_BAR_HEIGHT_PX,
  height: `calc(100% - ${TITLE_BAR_HEIGHT_PX}px)`,
} satisfies CSSProperties

export type ResizeRailState = 'idle' | 'hover' | 'active'

interface ZenModeSidebarRevealTriggerProps {
  workspaceId?: WorkspaceId
  zenRevealTriggerEnabled?: boolean
  onZenRevealTriggerEnter?: () => void
}

interface ZenModeSidebarResizeRailProps {
  interactive: boolean
  resizeRailState: ResizeRailState
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onMouseEnter: () => void
  onMouseLeave: () => void
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

export function ZenModeSidebarDragPlate({
  mounted,
  style,
  onSurfaceEnter,
}: {
  mounted: boolean
  style: CSSProperties
  onSurfaceEnter: () => void
}) {
  if (!mounted) return null

  return (
    <NativeDragPlate
      data-testid="zen-mode-sidebar-drag-plate"
      data-zen-reveal-surface=""
      className="z-30"
      style={style}
      onMouseEnter={onSurfaceEnter}
    />
  )
}

export function ZenModeSidebarResizeRail({
  interactive,
  resizeRailState,
  onPointerDown,
  onMouseEnter,
  onMouseLeave,
}: ZenModeSidebarResizeRailProps) {
  const separatorState = resizeRailState === 'idle' ? undefined : resizeRailState
  const handleProps = {
    'data-testid': 'zen-mode-sidebar-resize-handle',
    'data-separator': separatorState,
    role: 'separator' as const,
    'aria-orientation': 'vertical' as const,
    style: ZEN_REVEAL_RESIZE_HIT_TARGET_STYLE,
    className: cn(resizeHandleClassNames.hitTarget, resizeHandleClassNames.horizontal, 'absolute right-0 z-20'),
    onPointerDown,
    onMouseEnter,
    onMouseLeave,
  }

  return (
    <>
      <div
        data-testid="zen-mode-sidebar-resize-visual"
        data-separator={separatorState}
        aria-hidden
        className="group pointer-events-none absolute inset-y-0 right-0 z-20 w-px"
      >
        <ResizeHandleLine />
      </div>
      {interactive ? <TitleBarInteractiveRegion {...handleProps} /> : <div {...handleProps} />}
    </>
  )
}
