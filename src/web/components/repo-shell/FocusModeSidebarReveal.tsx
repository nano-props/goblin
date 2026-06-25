import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { WorkspaceFocusToggle } from '#/web/components/WorkspaceFocusToggle.tsx'
import { RepoShellSidebar } from '#/web/components/repo-shell/RepoShellSidebar.tsx'
import { cn } from '#/web/lib/cn.ts'
import { WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'
import {
  clampRepoSidebarSizePercent,
  repoSidebarWidthExpression,
  repoSidebarWidthPx,
} from '#/web/components/repo-shell/sidebar-sizing.ts'
import { ResizeHandleLine, resizeHandleClassNames } from '#/web/components/ui/resizable.tsx'
import { useElementInlineSize } from '#/web/hooks/useElementInlineSize.ts'
import { WINDOW_TOPBAR_HEIGHT_PX } from '#/shared/window-chrome.ts'

const FOCUS_SIDEBAR_CLOSE_DELAY_MS = WORKSPACE_PANE_TRANSITION_MS
type ResizeRailState = 'idle' | 'hover' | 'active'

interface FocusModeSidebarRevealState {
  open: boolean
  rendered: boolean
  onTriggerEnter: () => void
  onTriggerLeave: () => void
  onSurfaceEnter: () => void
  onSurfaceLeave: () => void
}

interface FocusModeSidebarRevealProps {
  repoId: string
  open: boolean
  sidebarSize: number
  onSidebarSizeChange: (sidebarSize: number) => void
  onSurfaceEnter: () => void
  onSurfaceLeave: () => void
  onOpenSettings?: () => void
}

interface FocusModeSidebarRevealTriggerProps {
  onMouseEnter: () => void
  onMouseLeave: () => void
}

export function useFocusModeSidebarReveal(active: boolean): FocusModeSidebarRevealState {
  const [open, setOpen] = useState(false)
  const [triggerArmed, setTriggerArmed] = useState(true)
  const closeTimer = useRef<number | null>(null)
  const previousActive = useRef(active)

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current === null) return
    window.clearTimeout(closeTimer.current)
    closeTimer.current = null
  }, [])

  const openSidebar = useCallback(() => {
    clearCloseTimer()
    setTriggerArmed(true)
    setOpen(true)
  }, [clearCloseTimer])

  const closeSoon = useCallback(() => {
    clearCloseTimer()
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      setOpen(false)
    }, FOCUS_SIDEBAR_CLOSE_DELAY_MS)
  }, [clearCloseTimer])

  useEffect(() => {
    const wasActive = previousActive.current
    if (wasActive === active) return
    previousActive.current = active

    clearCloseTimer()
    if (active) {
      setOpen(false)
      setTriggerArmed(false)
      return
    }

    setTriggerArmed(true)
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      setOpen(false)
    }, WORKSPACE_PANE_TRANSITION_MS)
  }, [active, clearCloseTimer])

  useEffect(() => {
    if (active || open) return
    if (!triggerArmed) {
      setTriggerArmed(true)
    }
  }, [active, open, triggerArmed])

  useEffect(() => clearCloseTimer, [clearCloseTimer])

  const onTriggerEnter = useCallback(() => {
    if (!triggerArmed) return
    openSidebar()
  }, [openSidebar, triggerArmed])

  const onTriggerLeave = useCallback(() => {
    setTriggerArmed(true)
    closeSoon()
  }, [closeSoon])

  return {
    open,
    rendered: active || open,
    onTriggerEnter,
    onTriggerLeave,
    onSurfaceEnter: openSidebar,
    onSurfaceLeave: closeSoon,
  }
}

export function FocusModeSidebarRevealTrigger({ onMouseEnter, onMouseLeave }: FocusModeSidebarRevealTriggerProps) {
  return (
    <div
      data-interactive
      data-focus-reveal-surface=""
      data-testid="focus-mode-sidebar-trigger"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <WorkspaceFocusToggle />
    </div>
  )
}

export function FocusModeSidebarReveal({
  repoId,
  open,
  sidebarSize,
  onSidebarSizeChange,
  onSurfaceEnter,
  onSurfaceLeave,
  onOpenSettings,
}: FocusModeSidebarRevealProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const hitAreaRef = useRef<HTMLDivElement | null>(null)
  const resizingRef = useRef(false)
  const resizeDragCleanupRef = useRef<(() => void) | null>(null)
  const lastPointerRef = useRef({ x: 0, y: 0 })
  const [resizeRailState, setResizeRailState] = useState<ResizeRailState>('idle')
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
    transform: open ? 'translateX(0)' : 'translateX(-100%)',
  } as CSSProperties
  const handleResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const rect = focusRevealHostRect(hostRef.current)
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
    [onSidebarSizeChange, onSurfaceEnter, onSurfaceLeave, rootFontSizePx],
  )
  useEffect(() => {
    return () => {
      resizeDragCleanupRef.current?.()
      resizeDragCleanupRef.current = null
      resizingRef.current = false
    }
  }, [])
  const handleSurfaceLeave = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (resizingRef.current) return
    if (isFocusRevealSurfaceTarget(event.relatedTarget, panelRef.current, hitAreaRef.current)) return
    onSurfaceLeave()
  }, [onSurfaceLeave])
  useEffect(() => {
    if (!open) return

    const handlePointerMove = (event: PointerEvent) => {
      if (resizingRef.current) return
      if (isFocusRevealSurfaceTarget(event.target, panelRef.current, hitAreaRef.current)) {
        onSurfaceEnter()
        return
      }
      onSurfaceLeave()
    }

    document.addEventListener('pointermove', handlePointerMove)
    return () => document.removeEventListener('pointermove', handlePointerMove)
  }, [open, onSurfaceEnter, onSurfaceLeave])
  const handleResizeRailMouseEnter = useCallback(() => {
    if (!resizingRef.current) setResizeRailState('hover')
  }, [])
  const handleResizeRailMouseLeave = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (resizingRef.current) return
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && panelRef.current?.contains(nextTarget)) {
      setResizeRailState('idle')
      return
    }
    setResizeRailState('idle')
  }, [])

  return (
    <div
      ref={hostRef}
      data-testid="focus-mode-sidebar-layer"
      className="pointer-events-none absolute inset-y-0 left-0 right-0 z-30"
    >
      <div
        ref={hitAreaRef}
        data-testid="focus-mode-sidebar-hit-area"
        className="pointer-events-auto absolute bottom-0 left-0 w-3"
        style={{ top: WINDOW_TOPBAR_HEIGHT_PX }}
        onMouseEnter={onSurfaceEnter}
        onMouseLeave={onSurfaceLeave}
        aria-hidden
      />
      <div
        ref={panelRef}
        data-testid="focus-mode-sidebar-reveal"
        data-open={open ? 'true' : 'false'}
        aria-hidden={open ? undefined : true}
        inert={open ? undefined : true}
        className={cn(
          'pointer-events-auto absolute inset-y-0 left-0 flex min-w-0 overflow-hidden bg-card transition-[transform,box-shadow,border-color] duration-200 ease-out',
          open ? 'border-r border-border/60 shadow-lg' : 'border-r border-transparent shadow-none',
        )}
        style={style}
        onMouseEnter={onSurfaceEnter}
        onMouseLeave={handleSurfaceLeave}
      >
        <RepoShellSidebar repoId={repoId} compact={false} surface="floating" onOpenSettings={onOpenSettings} />
        <div
          data-interactive
          data-testid="focus-mode-sidebar-resize-handle"
          data-separator={resizeRailState === 'idle' ? undefined : resizeRailState}
          role="separator"
          aria-orientation="vertical"
          className={cn(
            resizeHandleClassNames.hitTarget,
            resizeHandleClassNames.horizontal,
            'absolute inset-y-0 right-0 z-20',
          )}
          onPointerDown={handleResizePointerDown}
          onMouseEnter={handleResizeRailMouseEnter}
          onMouseLeave={handleResizeRailMouseLeave}
        >
          <ResizeHandleLine />
        </div>
      </div>
    </div>
  )
}

function focusRevealHostRect(host: HTMLElement | null): DOMRect | null {
  const rect = host?.getBoundingClientRect()
  if (rect && rect.width > 0) return rect
  const parentRect = host?.parentElement?.getBoundingClientRect()
  return parentRect && parentRect.width > 0 ? parentRect : null
}

function isFocusRevealSurfaceTarget(
  target: EventTarget | null,
  panel: HTMLElement | null,
  hitArea: HTMLElement | null,
): boolean {
  if (!(target instanceof Node)) return false
  if (panel?.contains(target) || hitArea?.contains(target)) return true

  const targetElement = target instanceof Element ? target : target.parentElement
  return !!targetElement?.closest('[data-floating-surface],[data-focus-reveal-surface]')
}

function useRootFontSizePx(): number {
  const [rootFontSizePx, setRootFontSizePx] = useState(16)

  useEffect(() => {
    const next = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize)
    if (Number.isFinite(next) && next > 0) setRootFontSizePx(next)
  }, [])

  return rootFontSizePx
}
