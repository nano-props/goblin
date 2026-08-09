import type { CSSProperties, FunctionalComponent } from 'vue'
import { TITLE_BAR_HEIGHT_PX } from '#/shared/title-bar-chrome.ts'
import { TitleBarInteractiveRegion } from '#/web/components/title-bar-chrome-region.tsx'
import { ResizeHandleLine, resizeHandleClassNames } from '#/web/components/ui/resizable.tsx'
import { cn } from '#/web/lib/cn.ts'

const ZEN_REVEAL_RESIZE_HIT_TARGET_STYLE = {
  top: `${TITLE_BAR_HEIGHT_PX}px`,
  height: `calc(100% - ${TITLE_BAR_HEIGHT_PX}px)`,
} satisfies CSSProperties

export type ResizeRailState = 'idle' | 'hover' | 'drag'

interface ZenModeSidebarResizeRailProps {
  interactive: boolean
  resizeRailState: ResizeRailState
  onPointerDown: (event: PointerEvent) => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}

export const ZenModeSidebarResizeRail: FunctionalComponent<ZenModeSidebarResizeRailProps> = (props) => {
  const dataState = props.resizeRailState === 'idle' ? undefined : props.resizeRailState
  const handleProps = {
    'data-testid': 'zen-mode-sidebar-resize-handle',
    'data-state': dataState,
    role: 'separator' as const,
    'aria-orientation': 'vertical' as const,
    style: ZEN_REVEAL_RESIZE_HIT_TARGET_STYLE,
    class: cn(resizeHandleClassNames.hitTarget, resizeHandleClassNames.horizontal, 'absolute right-0 z-20'),
    onPointerdown: props.onPointerDown,
    onMouseenter: props.onMouseEnter,
    onMouseleave: props.onMouseLeave,
  }

  return (
    <>
      <div
        data-testid="zen-mode-sidebar-resize-visual"
        data-state={dataState}
        aria-hidden="true"
        class="group pointer-events-none absolute inset-y-0 right-0 z-20 w-px"
      >
        <ResizeHandleLine />
      </div>
      {props.interactive ? <TitleBarInteractiveRegion {...handleProps} /> : <div {...handleProps} />}
    </>
  )
}

ZenModeSidebarResizeRail.props = ['interactive', 'resizeRailState', 'onPointerDown', 'onMouseEnter', 'onMouseLeave']
