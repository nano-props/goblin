import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { TITLE_BAR_HEIGHT_PX } from '#/shared/title-bar-chrome.ts'
import { TitleBarInteractiveRegion } from '#/web/components/title-bar-chrome-region.tsx'
import { ResizeHandleLine, resizeHandleClassNames } from '#/web/components/ui/resizable.tsx'
import { cn } from '#/web/lib/cn.ts'

const ZEN_REVEAL_RESIZE_HIT_TARGET_STYLE = {
  top: TITLE_BAR_HEIGHT_PX,
  height: `calc(100% - ${TITLE_BAR_HEIGHT_PX}px)`,
} satisfies CSSProperties

export type ResizeRailState = 'idle' | 'hover' | 'active'

interface ZenModeSidebarResizeRailProps {
  interactive: boolean
  resizeRailState: ResizeRailState
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onMouseEnter: () => void
  onMouseLeave: () => void
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
