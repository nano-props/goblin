import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { cn } from '#/web/lib/cn.ts'
import {
  clampWorkspaceSidebarSizePercent,
  workspaceSidebarWidthExpression,
  workspaceSidebarWidthPx,
} from '#/web/components/workspace-layout/sidebar-sizing.ts'
import { FloatingSurfaceBoundary } from '#/web/components/ui/floating-surface-boundary.tsx'
import { useElementInlineSize } from '#/web/hooks/useElementInlineSize.ts'
import { TITLE_BAR_HEIGHT_PX } from '#/shared/title-bar-chrome.ts'
import { WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'
import {
  ZenModeSidebarResizeRail,
  type ResizeRailState,
} from '#/web/components/workspace-layout/ZenModeSidebarResizeRail.tsx'
import { ZenModeSidebarRevealTriggerLayer } from '#/web/components/workspace-layout/ZenModeSidebarRevealTriggerLayer.tsx'
import { NativeDragPlate } from '#/web/components/title-bar-chrome-region.tsx'
import {
  isPointerInsideElement,
  isPointerInsideRevealBounds,
  isZenRevealSurfaceTarget,
  zenRevealHostRect,
} from '#/web/components/workspace-layout/zen-mode-sidebar-pointer.ts'

const ZEN_REVEAL_CLOSE_MS = 260
type RevealPanelState = 'closed' | 'opening' | 'open' | 'closing'

interface ZenModeSidebarRevealState {
  open: boolean
  rendered: boolean
  onTriggerEnter: () => void
  onSurfaceEnter: () => void
  onSurfaceLeave: () => void
}

interface ZenModeSidebarRevealProps {
  sidebarPane: ReactNode
  open: boolean
  // The panel can stay visually mounted while zen mode exits; only an
  // interactive panel may own pointer handlers or native drag regions.
  interactive: boolean
  sidebarSize: number
  onSidebarSizeChange: (sidebarSize: number) => void
  onSurfaceEnter: () => void
  onSurfaceLeave: () => void
}

interface ZenModeSidebarChromeProps {
  workspaceId?: WorkspaceId
  sidebarPane: ReactNode
  zenModeToggleEnabled: boolean
  revealEnabled: boolean
  sidebarSize: number
  onSidebarSizeChange: (sidebarSize: number) => void
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
  workspaceId,
  sidebarPane,
  zenModeToggleEnabled,
  revealEnabled,
  sidebarSize,
  onSidebarSizeChange,
}: ZenModeSidebarChromeProps) {
  const reveal = useZenModeSidebarReveal(revealEnabled)
  if (!zenModeToggleEnabled && !reveal.rendered) return null

  return (
    <>
      {reveal.rendered ? (
        <ZenModeSidebarReveal
          sidebarPane={sidebarPane}
          open={reveal.open}
          interactive={revealEnabled}
          sidebarSize={sidebarSize}
          onSidebarSizeChange={onSidebarSizeChange}
          onSurfaceEnter={reveal.onSurfaceEnter}
          onSurfaceLeave={reveal.onSurfaceLeave}
        />
      ) : null}
      {zenModeToggleEnabled ? (
        <ZenModeSidebarRevealTriggerLayer
          workspaceId={workspaceId}
          zenRevealTriggerEnabled={revealEnabled}
          onZenRevealTriggerEnter={reveal.onTriggerEnter}
        />
      ) : null}
    </>
  )
}

function ZenModeSidebarReveal({
  sidebarPane,
  open,
  interactive,
  sidebarSize,
  onSidebarSizeChange,
  onSurfaceEnter,
  onSurfaceLeave,
}: ZenModeSidebarRevealProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const hitAreaRef = useRef<HTMLDivElement | null>(null)
  const resizingRef = useRef(false)
  const resizeDragCleanupRef = useRef<(() => void) | null>(null)
  const closeAnimationTimerRef = useRef<number | null>(null)
  const openAnimationFrameRef = useRef<number | null>(null)
  const unpinRecheckFrameRef = useRef<number | null>(null)
  const panelStateRef = useRef<RevealPanelState>(open ? 'open' : 'closed')
  const lastPointerRef = useRef({ x: 0, y: 0 })
  const lastPointerKnownRef = useRef(false)
  const previousDescendantSurfacePinnedRef = useRef(false)
  const [resizeRailState, setResizeRailState] = useState<ResizeRailState>('idle')
  const [panelState, setPanelState] = useState<RevealPanelState>(() => (open ? 'open' : 'closed'))
  const [pinnedByDescendantSurface, setPinnedByDescendantSurface] = useState(false)
  const rootFontSizePx = useRootFontSizePx()
  const hostWidth = useElementInlineSize(hostRef, true)
  const measuredWidthPx =
    hostWidth === null
      ? null
      : workspaceSidebarWidthPx({
          sidebarSize,
          totalPx: hostWidth,
          rootFontSizePx,
        })
  const width = measuredWidthPx === null ? workspaceSidebarWidthExpression(sidebarSize) : `${measuredWidthPx}px`
  const style = {
    width,
  } as CSSProperties
  const dragPlateStyle = {
    width,
    height: TITLE_BAR_HEIGHT_PX,
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
  const clearUnpinRecheckFrame = useCallback(() => {
    if (unpinRecheckFrameRef.current === null) return
    window.cancelAnimationFrame(unpinRecheckFrameRef.current)
    unpinRecheckFrameRef.current = null
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
      lastPointerKnownRef.current = true
      setResizeRailState('active')
      onSurfaceEnter()

      const update = (clientX: number) => {
        onSidebarSizeChange(
          clampWorkspaceSidebarSizePercent({
            sidebarPx: clientX - rect.left,
            totalPx: rect.width,
            rootFontSizePx,
          }),
        )
      }
      const handlePointerMove = (moveEvent: PointerEvent) => {
        lastPointerRef.current = { x: moveEvent.clientX, y: moveEvent.clientY }
        lastPointerKnownRef.current = true
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
      clearUnpinRecheckFrame()
      resizeDragCleanupRef.current = null
      resizingRef.current = false
    }
  }, [clearCloseAnimationTimer, clearOpenAnimationFrame, clearUnpinRecheckFrame])
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
      lastPointerRef.current = { x: event.clientX, y: event.clientY }
      lastPointerKnownRef.current = true
      if (resizingRef.current) return
      if (pinnedByDescendantSurface) return
      if (isPointerInsideRevealBounds(event, hostRef.current, panelRef.current)) return
      if (isZenRevealSurfaceTarget(event.relatedTarget, panelRef.current, hitAreaRef.current)) return
      onSurfaceLeave()
    },
    [onSurfaceLeave, pinnedByDescendantSurface],
  )
  const recheckSurfaceAfterUnpin = useEffectEvent(() => {
    if (!panelInteractive) return
    if (resizingRef.current) return
    if (pinnedByDescendantSurface) return
    if (!lastPointerKnownRef.current) return

    const pointer = lastPointerRef.current
    const target =
      typeof document.elementFromPoint === 'function' ? document.elementFromPoint(pointer.x, pointer.y) : null
    if (
      (target &&
        isZenRevealSurfaceTarget(target, panelRef.current, hitAreaRef.current, {
          includeClosedFloatingSurfaces: false,
        })) ||
      isPointerInsideRevealBounds({ clientX: pointer.x, clientY: pointer.y }, hostRef.current, panelRef.current) ||
      isPointerInsideElement({ clientX: pointer.x, clientY: pointer.y }, hitAreaRef.current)
    ) {
      return
    }

    onSurfaceLeave()
  })
  const requestUnpinRecheck = useCallback(() => {
    clearUnpinRecheckFrame()
    unpinRecheckFrameRef.current = window.requestAnimationFrame(() => {
      unpinRecheckFrameRef.current = null
      recheckSurfaceAfterUnpin()
    })
  }, [clearUnpinRecheckFrame, recheckSurfaceAfterUnpin])
  const handleDescendantSurfacePinnedChange = useCallback(
    (nextPinned: boolean) => {
      const wasPinned = previousDescendantSurfacePinnedRef.current
      previousDescendantSurfacePinnedRef.current = nextPinned
      setPinnedByDescendantSurface(nextPinned)

      if (nextPinned) {
        clearUnpinRecheckFrame()
        return
      }

      if (!wasPinned) return
      requestUnpinRecheck()
    },
    [clearUnpinRecheckFrame, requestUnpinRecheck],
  )
  const handleDocumentPointerMove = useEffectEvent((event: PointerEvent) => {
    lastPointerRef.current = { x: event.clientX, y: event.clientY }
    lastPointerKnownRef.current = true
    if (resizingRef.current) return
    if (pinnedByDescendantSurface) return
    if (
      isZenRevealSurfaceTarget(event.target, panelRef.current, hitAreaRef.current) ||
      isPointerInsideRevealBounds(event, hostRef.current, panelRef.current) ||
      isPointerInsideElement(event, hitAreaRef.current)
    ) {
      onSurfaceEnter()
      return
    }
    onSurfaceLeave()
  })
  useEffect(() => {
    if (!panelInteractive) return

    const handlePointerMove = (event: PointerEvent) => {
      handleDocumentPointerMove(event)
    }

    document.addEventListener('pointermove', handlePointerMove)
    return () => document.removeEventListener('pointermove', handlePointerMove)
  }, [panelInteractive])
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
        data-testid="zen-mode-sidebar-hit-area"
        className={cn('absolute bottom-0 left-0 w-3', interactive ? 'pointer-events-auto' : 'pointer-events-none')}
        style={{ top: TITLE_BAR_HEIGHT_PX }}
        onMouseEnter={interactive ? onSurfaceEnter : undefined}
        aria-hidden
      />
      <div
        ref={panelRef}
        data-zen-reveal-surface={panelInteractive ? '' : undefined}
        data-testid="zen-mode-sidebar-reveal"
        data-open={open ? 'true' : 'false'}
        data-panel-interactive={panelInteractive ? 'true' : 'false'}
        data-state={panelState}
        aria-hidden={panelInteractive ? undefined : true}
        inert={panelInteractive ? undefined : true}
        className="goblin-zen-reveal-panel absolute inset-y-0 left-0 flex min-w-0 overflow-hidden bg-navigation"
        style={style}
        onMouseEnter={panelInteractive ? onSurfaceEnter : undefined}
        onMouseLeave={panelInteractive ? handleSurfaceLeave : undefined}
      >
        <FloatingSurfaceBoundary onPinnedChange={handleDescendantSurfacePinnedChange}>
          {sidebarPane}
          <ZenModeSidebarResizeRail
            interactive={panelInteractive}
            resizeRailState={resizeRailState}
            onPointerDown={handleResizePointerDown}
            onMouseEnter={handleResizeRailMouseEnter}
            onMouseLeave={handleResizeRailMouseLeave}
          />
        </FloatingSurfaceBoundary>
      </div>
      <ZenModeSidebarDragPlate mounted={panelInteractive} style={dragPlateStyle} onSurfaceEnter={onSurfaceEnter} />
    </div>
  )
}

function ZenModeSidebarDragPlate({
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

function useRootFontSizePx(): number {
  const [rootFontSizePx, setRootFontSizePx] = useState(16)

  useEffect(() => {
    const next = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize)
    if (Number.isFinite(next) && next > 0) setRootFontSizePx(next)
  }, [])

  return rootFontSizePx
}
