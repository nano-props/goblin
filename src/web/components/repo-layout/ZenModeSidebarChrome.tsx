import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { WorkspaceZenModeToggle } from '#/web/components/WorkspaceZenModeToggle.tsx'
import { RepoLayoutSidebar } from '#/web/components/repo-layout/RepoLayoutSidebar.tsx'
import { cn } from '#/web/lib/cn.ts'
import {
  clampRepoSidebarSizePercent,
  repoSidebarWidthExpression,
  repoSidebarWidthPx,
} from '#/web/components/repo-layout/sidebar-sizing.ts'
import { ResizeHandleLine, resizeHandleClassNames } from '#/web/components/ui/resizable.tsx'
import { useElementInlineSize } from '#/web/hooks/useElementInlineSize.ts'
import { WINDOW_CHROME_HEIGHT_PX } from '#/shared/window-chrome.ts'
import { WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'
import { WindowChromeInteractiveRegion } from '#/web/components/window-chrome-region.tsx'

const ZEN_REVEAL_SURFACE_SELECTOR = '[data-floating-surface],[data-zen-reveal-surface]'
const ZEN_REVEAL_CLOSE_MS = 260
type ResizeRailState = 'idle' | 'hover' | 'active'
type RevealPanelState = 'closed' | 'opening' | 'open' | 'closing'

interface ZenModeSidebarRevealState {
  open: boolean
  rendered: boolean
  onTriggerEnter: () => void
  onSurfaceEnter: () => void
  onSurfaceLeave: () => void
}

interface ZenModeSidebarRevealProps {
  repoId?: string
  open: boolean
  // The panel can stay visually mounted while zen mode exits; only an
  // interactive panel may own pointer handlers or native drag regions.
  interactive: boolean
  sidebarSize: number
  onSidebarSizeChange: (sidebarSize: number) => void
  onSurfaceEnter: () => void
  onSurfaceLeave: () => void
  onOpenSettings?: () => void
}

interface ZenModeSidebarRevealTriggerProps {
  revealEnabled?: boolean
  onMouseEnter?: () => void
}

interface ZenModeSidebarChromeProps {
  repoId?: string
  zenModeToggleEnabled: boolean
  revealEnabled: boolean
  sidebarSize: number
  onSidebarSizeChange: (sidebarSize: number) => void
  onOpenSettings?: () => void
}

function useZenModeSidebarReveal(enabled: boolean): ZenModeSidebarRevealState {
  const [open, setOpen] = useState(false)
  const previousEnabled = useRef(enabled)
  const exitRetainTimer = useRef<number | null>(null)
  const exitRetaining = useRef(false)

  const clearExitRetain = useCallback(() => {
    if (exitRetainTimer.current !== null) {
      window.clearTimeout(exitRetainTimer.current)
      exitRetainTimer.current = null
    }
    exitRetaining.current = false
  }, [])

  const openSidebar = useCallback(() => {
    if (!enabled) return
    clearExitRetain()
    setOpen(true)
  }, [clearExitRetain, enabled])

  const closeSidebar = useCallback(() => {
    if (exitRetaining.current) return
    setOpen(false)
  }, [])

  useEffect(() => {
    const wasEnabled = previousEnabled.current
    if (wasEnabled === enabled) return
    previousEnabled.current = enabled

    clearExitRetain()
    if (enabled) {
      setOpen(false)
      return
    }

    if (!open) {
      setOpen(false)
      return
    }

    exitRetaining.current = true
    exitRetainTimer.current = window.setTimeout(() => {
      exitRetainTimer.current = null
      exitRetaining.current = false
      setOpen(false)
    }, WORKSPACE_PANE_TRANSITION_MS)
  }, [clearExitRetain, enabled, open])

  useEffect(() => clearExitRetain, [clearExitRetain])

  const onTriggerEnter = useCallback(() => {
    openSidebar()
  }, [openSidebar])

  return {
    open,
    rendered: enabled || open,
    onTriggerEnter,
    onSurfaceEnter: openSidebar,
    onSurfaceLeave: closeSidebar,
  }
}

export function ZenModeSidebarChrome({
  repoId,
  zenModeToggleEnabled,
  revealEnabled,
  sidebarSize,
  onSidebarSizeChange,
  onOpenSettings,
}: ZenModeSidebarChromeProps) {
  const reveal = useZenModeSidebarReveal(revealEnabled)
  if (!zenModeToggleEnabled && !reveal.rendered) return null

  return (
    <>
      {reveal.rendered ? (
        <ZenModeSidebarReveal
          repoId={repoId}
          open={reveal.open}
          interactive={revealEnabled}
          sidebarSize={sidebarSize}
          onSidebarSizeChange={onSidebarSizeChange}
          onSurfaceEnter={reveal.onSurfaceEnter}
          onSurfaceLeave={reveal.onSurfaceLeave}
          onOpenSettings={onOpenSettings}
        />
      ) : null}
      {zenModeToggleEnabled ? (
        <ZenModeSidebarRevealTriggerLayer revealEnabled={revealEnabled} onMouseEnter={reveal.onTriggerEnter} />
      ) : null}
    </>
  )
}

function ZenModeSidebarRevealTriggerLayer({ revealEnabled = false, onMouseEnter }: ZenModeSidebarRevealTriggerProps) {
  return (
    <div
      data-testid="zen-mode-toggle-overlay"
      data-zen-reveal-surface={revealEnabled ? '' : undefined}
      className="goblin-zen-reveal-trigger-layer pointer-events-none absolute left-0 top-0 z-40 flex items-center bg-transparent"
      style={{ height: WINDOW_CHROME_HEIGHT_PX }}
    >
      <ZenModeSidebarRevealTrigger revealEnabled={revealEnabled} onMouseEnter={onMouseEnter} />
    </div>
  )
}

function ZenModeSidebarRevealTrigger({ revealEnabled = false, onMouseEnter }: ZenModeSidebarRevealTriggerProps) {
  return (
    <WindowChromeInteractiveRegion asChild>
      <WorkspaceZenModeToggle
        data-zen-reveal-surface={revealEnabled ? '' : undefined}
        data-testid="zen-mode-sidebar-trigger"
        className="pointer-events-auto"
        onMouseEnter={revealEnabled ? onMouseEnter : undefined}
      />
    </WindowChromeInteractiveRegion>
  )
}

function ZenModeSidebarReveal({
  repoId,
  open,
  interactive,
  sidebarSize,
  onSidebarSizeChange,
  onSurfaceEnter,
  onSurfaceLeave,
  onOpenSettings,
}: ZenModeSidebarRevealProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const hitAreaRef = useRef<HTMLDivElement | null>(null)
  const resizingRef = useRef(false)
  const resizeDragCleanupRef = useRef<(() => void) | null>(null)
  const closeAnimationTimerRef = useRef<number | null>(null)
  const openAnimationFrameRef = useRef<number | null>(null)
  const panelStateRef = useRef<RevealPanelState>(open ? 'open' : 'closed')
  const lastPointerRef = useRef({ x: 0, y: 0 })
  const [resizeRailState, setResizeRailState] = useState<ResizeRailState>('idle')
  const [panelState, setPanelState] = useState<RevealPanelState>(() => (open ? 'open' : 'closed'))
  const rootFontSizePx = useRootFontSizePx()
  const hostWidth = useElementInlineSize(hostRef, true)
  const measuredWidthPx =
    hostWidth === null
      ? null
      : repoSidebarWidthPx({
          sidebarSize,
          totalPx: hostWidth,
          rootFontSizePx,
        })
  const width = measuredWidthPx === null ? repoSidebarWidthExpression(sidebarSize) : `${measuredWidthPx}px`
  const style = {
    width,
  } as CSSProperties
  const panelInteractive = open && interactive
  const setPanelVisualState = useCallback((next: RevealPanelState) => {
    panelStateRef.current = next
    setPanelState(next)
  }, [])
  const clearCloseAnimationTimer = useCallback(() => {
    if (closeAnimationTimerRef.current === null) return
    window.clearTimeout(closeAnimationTimerRef.current)
    closeAnimationTimerRef.current = null
  }, [])
  const clearOpenAnimationFrame = useCallback(() => {
    if (openAnimationFrameRef.current === null) return
    window.cancelAnimationFrame(openAnimationFrameRef.current)
    openAnimationFrameRef.current = null
  }, [])
  const handleResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!panelInteractive) return
      const rect = zenRevealHostRect(hostRef.current)
      if (!rect || rect.width <= 0) return

      event.preventDefault()
      event.stopPropagation()
      resizeDragCleanupRef.current?.()
      resizingRef.current = true
      lastPointerRef.current = { x: event.clientX, y: event.clientY }
      setResizeRailState('active')
      onSurfaceEnter()

      const update = (clientX: number) => {
        onSidebarSizeChange(
          clampRepoSidebarSizePercent({
            sidebarPx: clientX - rect.left,
            totalPx: rect.width,
            rootFontSizePx,
          }),
        )
      }
      const handlePointerMove = (moveEvent: PointerEvent) => {
        lastPointerRef.current = { x: moveEvent.clientX, y: moveEvent.clientY }
        update(moveEvent.clientX)
      }
      const cleanupDragListeners = () => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerUp)
        if (resizeDragCleanupRef.current === cleanupDragListeners) {
          resizeDragCleanupRef.current = null
        }
      }
      const handlePointerUp = () => {
        cleanupDragListeners()
        resizingRef.current = false
        const target =
          typeof document.elementFromPoint === 'function'
            ? document.elementFromPoint(lastPointerRef.current.x, lastPointerRef.current.y)
            : null
        const pointerInsidePanel = !!target && !!panelRef.current?.contains(target)
        setResizeRailState(pointerInsidePanel ? 'hover' : 'idle')
        if (!pointerInsidePanel) onSurfaceLeave()
      }

      update(event.clientX)
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerUp)
      resizeDragCleanupRef.current = cleanupDragListeners
    },
    [onSidebarSizeChange, onSurfaceEnter, onSurfaceLeave, panelInteractive, rootFontSizePx],
  )
  useEffect(() => {
    return () => {
      resizeDragCleanupRef.current?.()
      clearCloseAnimationTimer()
      clearOpenAnimationFrame()
      resizeDragCleanupRef.current = null
      resizingRef.current = false
    }
  }, [clearCloseAnimationTimer, clearOpenAnimationFrame])
  useEffect(() => {
    clearCloseAnimationTimer()
    clearOpenAnimationFrame()
    if (open) {
      if (panelStateRef.current === 'open') return
      setPanelVisualState('opening')
      openAnimationFrameRef.current = window.requestAnimationFrame(() => {
        openAnimationFrameRef.current = null
        setPanelVisualState('open')
      })
      return
    }

    if (panelStateRef.current === 'closed') return
    setPanelVisualState('closing')
    closeAnimationTimerRef.current = window.setTimeout(() => {
      closeAnimationTimerRef.current = null
      setPanelVisualState('closed')
    }, ZEN_REVEAL_CLOSE_MS)
  }, [clearCloseAnimationTimer, clearOpenAnimationFrame, open, setPanelVisualState])
  const handleSurfaceLeave = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (resizingRef.current) return
      if (isPointerInsideRevealBounds(event, hostRef.current, panelRef.current)) return
      if (isZenRevealSurfaceTarget(event.relatedTarget, panelRef.current, hitAreaRef.current)) return
      onSurfaceLeave()
    },
    [onSurfaceLeave],
  )
  useEffect(() => {
    if (!panelInteractive) return

    const handlePointerMove = (event: PointerEvent) => {
      if (resizingRef.current) return
      if (
        isZenRevealSurfaceTarget(event.target, panelRef.current, hitAreaRef.current) ||
        isPointerInsideRevealBounds(event, hostRef.current, panelRef.current) ||
        isPointerInsideElement(event, hitAreaRef.current)
      ) {
        onSurfaceEnter()
        return
      }
      onSurfaceLeave()
    }

    document.addEventListener('pointermove', handlePointerMove)
    return () => document.removeEventListener('pointermove', handlePointerMove)
  }, [onSurfaceEnter, onSurfaceLeave, panelInteractive])
  const handleResizeRailMouseEnter = useCallback(() => {
    if (!resizingRef.current) setResizeRailState('hover')
  }, [])
  const handleResizeRailMouseLeave = useCallback(() => {
    if (resizingRef.current) return
    setResizeRailState('idle')
  }, [])

  return (
    <div
      ref={hostRef}
      data-testid="zen-mode-sidebar-layer"
      className="pointer-events-none absolute inset-y-0 left-0 right-0 z-30"
    >
      <div
        ref={hitAreaRef}
        data-zen-reveal-surface=""
        data-testid="zen-mode-sidebar-hit-area"
        className={cn('absolute bottom-0 left-0 w-3', interactive ? 'pointer-events-auto' : 'pointer-events-none')}
        style={{ top: WINDOW_CHROME_HEIGHT_PX }}
        onMouseEnter={interactive ? onSurfaceEnter : undefined}
        onMouseLeave={interactive ? handleSurfaceLeave : undefined}
        aria-hidden
      />
      <div
        ref={panelRef}
        data-zen-reveal-surface={panelInteractive ? '' : undefined}
        data-testid="zen-mode-sidebar-reveal"
        data-open={open ? 'true' : 'false'}
        data-interactive={panelInteractive ? 'true' : 'false'}
        data-state={panelState}
        aria-hidden={panelInteractive ? undefined : true}
        inert={panelInteractive ? undefined : true}
        className="goblin-zen-reveal-panel absolute inset-y-0 left-0 flex min-w-0 overflow-hidden bg-card"
        style={style}
        onMouseEnter={panelInteractive ? onSurfaceEnter : undefined}
        onMouseLeave={panelInteractive ? handleSurfaceLeave : undefined}
      >
        <RepoLayoutSidebar
          repoId={repoId}
          compact={false}
          chromeRegion={panelInteractive ? 'drag' : 'none'}
          onOpenSettings={onOpenSettings}
        />
        <WindowChromeInteractiveRegion
          data-testid="zen-mode-sidebar-resize-handle"
          data-separator={resizeRailState === 'idle' ? undefined : resizeRailState}
          role="separator"
          aria-orientation="vertical"
          className={cn(
            resizeHandleClassNames.hitTarget,
            resizeHandleClassNames.horizontal,
            'absolute inset-y-0 right-0 z-20',
          )}
          onPointerDown={panelInteractive ? handleResizePointerDown : undefined}
          onMouseEnter={panelInteractive ? handleResizeRailMouseEnter : undefined}
          onMouseLeave={panelInteractive ? handleResizeRailMouseLeave : undefined}
        >
          <ResizeHandleLine />
        </WindowChromeInteractiveRegion>
      </div>
    </div>
  )
}

function zenRevealHostRect(host: HTMLElement | null): DOMRect | null {
  const rect = host?.getBoundingClientRect()
  if (rect && rect.width > 0) return rect
  const parentRect = host?.parentElement?.getBoundingClientRect()
  return parentRect && parentRect.width > 0 ? parentRect : null
}

function isPointerInsideElement(event: PointerEvent, element: HTMLElement | null): boolean {
  if (!element) return false
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  )
}

function isPointerInsideRevealBounds(
  event: Pick<MouseEvent | PointerEvent, 'clientX' | 'clientY'>,
  host: HTMLElement | null,
  panel: HTMLElement | null,
): boolean {
  if (!host || !panel) return false
  const hostRect = host.getBoundingClientRect()
  const panelRect = panel.getBoundingClientRect()
  const width = panel.offsetWidth || panelRect.width
  if (hostRect.height <= 0 || width <= 0) return false

  return (
    event.clientX >= hostRect.left &&
    event.clientX <= hostRect.left + width &&
    event.clientY >= hostRect.top &&
    event.clientY <= hostRect.bottom
  )
}

function isZenRevealSurfaceTarget(
  target: EventTarget | null,
  panel: HTMLElement | null,
  hitArea: HTMLElement | null,
): boolean {
  if (!(target instanceof Node)) return false
  if (panel?.contains(target) || hitArea?.contains(target)) return true

  const targetElement = target instanceof Element ? target : target.parentElement
  return !!targetElement?.closest(ZEN_REVEAL_SURFACE_SELECTOR)
}

function useRootFontSizePx(): number {
  const [rootFontSizePx, setRootFontSizePx] = useState(16)

  useEffect(() => {
    const next = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize)
    if (Number.isFinite(next) && next > 0) setRootFontSizePx(next)
  }, [])

  return rootFontSizePx
}
