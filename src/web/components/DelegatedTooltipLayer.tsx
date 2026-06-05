import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '#/web/lib/cn.ts'
import { TOOLTIP_SURFACE_CLASS } from '#/web/components/ui/tooltip.tsx'

interface AnchorRect {
  left: number
  top: number
  width: number
  height: number
}

interface TooltipState<T> {
  item: T
  rect: AnchorRect
}

type DelegatedTooltipPlacement = 'bottom-start' | 'left'

interface DelegatedTooltipLayerProps<T> extends ComponentPropsWithoutRef<'div'> {
  items: readonly T[]
  selector: string
  attributeName: string
  getItemId: (item: T) => string
  renderTooltip: (item: T) => ReactNode
  delayMs?: number
  graceMs?: number
  placement?: DelegatedTooltipPlacement
  maxWidth?: number
  margin?: number
  offset?: number
  tooltipClassName?: string
}

export const DELEGATED_TOOLTIP_DEFAULTS = {
  delayMs: 700,
  graceMs: 100,
  margin: 8,
  offset: 6,
  maxWidth: 420,
} as const

export const DELEGATED_TOOLTIP_TRANSITIONS = {
  fade: 'opacity 100ms ease-out',
  slideBottomStart: 'left 150ms ease-out, opacity 100ms ease-out',
  slideLeft: 'top 150ms ease-out, opacity 100ms ease-out',
} as const

export function DelegatedTooltipLayer<T>({
  items,
  selector,
  attributeName,
  getItemId,
  renderTooltip,
  delayMs = DELEGATED_TOOLTIP_DEFAULTS.delayMs,
  graceMs = DELEGATED_TOOLTIP_DEFAULTS.graceMs,
  placement = 'bottom-start',
  maxWidth = DELEGATED_TOOLTIP_DEFAULTS.maxWidth,
  margin = DELEGATED_TOOLTIP_DEFAULTS.margin,
  offset = DELEGATED_TOOLTIP_DEFAULTS.offset,
  tooltipClassName,
  children,
  ...props
}: DelegatedTooltipLayerProps<T>) {
  const { rootRef, tooltip } = useDelegatedTooltipStateMachine({
    items,
    selector,
    attributeName,
    getItemId,
    delayMs,
    graceMs,
  })

  return (
    <>
      <div ref={rootRef} {...props}>
        {children}
      </div>
      {tooltip && (
        <DelegatedTooltipPopup
          tooltip={tooltip}
          renderTooltip={renderTooltip}
          placement={placement}
          maxWidth={maxWidth}
          margin={margin}
          offset={offset}
          tooltipClassName={tooltipClassName}
        />
      )}
    </>
  )
}

function useDelegatedTooltipStateMachine<T>(input: {
  items: readonly T[]
  selector: string
  attributeName: string
  getItemId: (item: T) => string
  delayMs: number
  graceMs: number
}): {
  rootRef: React.RefObject<HTMLDivElement | null>
  tooltip: TooltipState<T> | null
} {
  const { items, selector, attributeName, getItemId, delayMs, graceMs } = input
  const rootRef = useRef<HTMLDivElement | null>(null)
  const activeItemIdRef = useRef<string | null>(null)
  const showTimerRef = useRef<number | null>(null)
  const graceTimerRef = useRef<number | null>(null)
  const warmRef = useRef(false)
  const [tooltip, setTooltip] = useState<TooltipState<T> | null>(null)
  const itemsById = useMemo(() => new Map(items.map((item) => [getItemId(item), item])), [getItemId, items])
  const liveStateRef = useRef({ itemsById, getItemId })

  useLayoutEffect(() => {
    liveStateRef.current = { itemsById, getItemId }
  }, [getItemId, itemsById])

  const clearShowTimer = useCallback(() => {
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current)
      showTimerRef.current = null
    }
  }, [])

  const clearGraceTimer = useCallback(() => {
    if (graceTimerRef.current !== null) {
      window.clearTimeout(graceTimerRef.current)
      graceTimerRef.current = null
    }
  }, [])

  const hide = useCallback(() => {
    clearShowTimer()
    clearGraceTimer()
    warmRef.current = false
    activeItemIdRef.current = null
    setTooltip(null)
  }, [clearGraceTimer, clearShowTimer])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return () => {}
    const container = root

    function itemElementFromTarget(target: EventTarget | null): HTMLElement | null {
      return findClosestItemElement(target, selector)
    }

    function showTooltip(nextTooltip: TooltipState<T>) {
      warmRef.current = true
      activeItemIdRef.current = liveStateRef.current.getItemId(nextTooltip.item)
      setTooltip(nextTooltip)
    }

    function showItemElement(el: HTMLElement) {
      const nextTooltip = resolveTooltipStateFromElement(el, attributeName, liveStateRef.current.itemsById)
      if (!nextTooltip) return
      showTooltip(nextTooltip)
    }

    function showItemById(id: string) {
      const nextTooltip = resolveTooltipStateById(
        container,
        selector,
        attributeName,
        liveStateRef.current.itemsById,
        id,
      )
      if (!nextTooltip) return
      showTooltip(nextTooltip)
    }

    function startGrace() {
      if (!warmRef.current) return
      clearGraceTimer()
      graceTimerRef.current = window.setTimeout(() => {
        graceTimerRef.current = null
        warmRef.current = false
        activeItemIdRef.current = null
        setTooltip(null)
      }, graceMs)
    }

    function handleEnter(next: EventTarget | null, prev: EventTarget | null) {
      const nextEl = itemElementFromTarget(next)
      if (!nextEl || nextEl === itemElementFromTarget(prev)) return
      clearGraceTimer()
      clearShowTimer()
      if (warmRef.current) {
        showItemElement(nextEl)
        return
      }
      const itemId = readItemId(nextEl, attributeName)
      if (!itemId) return
      showTimerRef.current = window.setTimeout(() => {
        showTimerRef.current = null
        showItemById(itemId)
      }, delayMs)
    }

    function handlePointerItemLeave(e: PointerEvent) {
      const prevEl = itemElementFromTarget(e.target)
      const nextEl = itemElementFromTarget(e.relatedTarget)
      if (!prevEl || prevEl === nextEl) return
      clearShowTimer()
      if (nextEl || isEventTargetWithin(container, e.relatedTarget)) return
      startGrace()
    }

    function handleContainerLeave(e: PointerEvent) {
      clearShowTimer()
      if (isPointerWithin(container, e)) return
      startGrace()
    }

    function handleFocusLeave(e: FocusEvent) {
      const prevEl = itemElementFromTarget(e.target)
      if (!prevEl || prevEl === itemElementFromTarget(e.relatedTarget)) return
      clearShowTimer()
      startGrace()
    }

    const onPointerOver = (e: PointerEvent) => handleEnter(e.target, e.relatedTarget)
    const onFocusIn = (e: FocusEvent) => handleEnter(e.target, e.relatedTarget)

    container.addEventListener('pointerover', onPointerOver)
    container.addEventListener('pointerout', handlePointerItemLeave)
    container.addEventListener('pointerleave', handleContainerLeave)
    container.addEventListener('focusin', onFocusIn)
    container.addEventListener('focusout', handleFocusLeave)
    container.addEventListener('pointerdown', hide, true)
    container.addEventListener('wheel', hide, true)
    container.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      container.removeEventListener('pointerover', onPointerOver)
      container.removeEventListener('pointerout', handlePointerItemLeave)
      container.removeEventListener('pointerleave', handleContainerLeave)
      container.removeEventListener('focusin', onFocusIn)
      container.removeEventListener('focusout', handleFocusLeave)
      container.removeEventListener('pointerdown', hide, true)
      container.removeEventListener('wheel', hide, true)
      container.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
      clearShowTimer()
      clearGraceTimer()
    }
  }, [attributeName, clearGraceTimer, clearShowTimer, delayMs, graceMs, hide, selector])

  useEffect(() => {
    const activeItemId = activeItemIdRef.current
    if (!activeItemId) return
    const activeTooltip = resolveTooltipStateById(rootRef.current, selector, attributeName, itemsById, activeItemId)
    if (!activeTooltip) {
      hide()
      return
    }
    setTooltip((current) =>
      current && liveStateRef.current.getItemId(current.item) === activeItemId
        ? { item: activeTooltip.item, rect: activeTooltip.rect ?? current.rect }
        : current,
    )
  }, [attributeName, hide, itemsById, selector])

  return { rootRef, tooltip }
}

function DelegatedTooltipPopup<T>({
  tooltip,
  renderTooltip,
  placement,
  maxWidth,
  margin,
  offset,
  tooltipClassName,
}: {
  tooltip: TooltipState<T>
  renderTooltip: (item: T) => ReactNode
  placement: DelegatedTooltipPlacement
  maxWidth: number
  margin: number
  offset: number
  tooltipClassName?: string
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [mounted, setMounted] = useState(false)
  const [size, setSize] = useState({ width: maxWidth, height: 0 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setSize({ width: el.offsetWidth, height: el.offsetHeight })
  }, [tooltip.item, maxWidth])

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setMounted(true))
    return () => window.cancelAnimationFrame(id)
  }, [])

  const position = tooltipPosition(tooltip.rect, size, { placement, maxWidth, margin, offset })
  const transition =
    placement === 'left' ? DELEGATED_TOOLTIP_TRANSITIONS.slideLeft : DELEGATED_TOOLTIP_TRANSITIONS.slideBottomStart

  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className={cn('pointer-events-none fixed z-50 w-max shadow-lg', TOOLTIP_SURFACE_CLASS, tooltipClassName)}
      style={{
        left: position.left,
        top: position.top,
        maxWidth,
        opacity: mounted ? 1 : 0,
        transform: position.transform,
        transition: mounted ? transition : DELEGATED_TOOLTIP_TRANSITIONS.fade,
      }}
    >
      {renderTooltip(tooltip.item)}
    </div>,
    document.body,
  )
}

function readAnchorRect(el: HTMLElement): AnchorRect | null {
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
    ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    : null
}

function readItemId(el: HTMLElement, attributeName: string): string | null {
  return el.getAttribute(attributeName)
}

function findClosestItemElement(target: EventTarget | null, selector: string): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(selector) : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function isPointerWithin(container: HTMLElement, e: PointerEvent): boolean {
  const rect = container.getBoundingClientRect()
  return e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom
}

function isEventTargetWithin(container: HTMLElement, target: EventTarget | null): boolean {
  return target instanceof Node && container.contains(target)
}

function findItemElement(root: HTMLElement, selector: string, attributeName: string, id: string): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>(selector)) {
    if (readItemId(el, attributeName) === id) return el
  }
  return null
}

function resolveTooltipStateFromElement<T>(
  el: HTMLElement,
  attributeName: string,
  itemsById: Map<string, T>,
): TooltipState<T> | null {
  const id = readItemId(el, attributeName)
  if (!id) return null
  const item = itemsById.get(id)
  const rect = readAnchorRect(el)
  return item && rect ? { item, rect } : null
}

function resolveTooltipStateById<T>(
  root: HTMLElement | null,
  selector: string,
  attributeName: string,
  itemsById: Map<string, T>,
  id: string,
): TooltipState<T> | null {
  if (!root) return null
  const item = itemsById.get(id)
  const el = findItemElement(root, selector, attributeName, id)
  const rect = el ? readAnchorRect(el) : null
  return item && rect ? { item, rect } : null
}

function tooltipPosition(
  rect: AnchorRect,
  size: { width: number; height: number },
  options: { placement: DelegatedTooltipPlacement; margin: number; offset: number; maxWidth: number },
): { left: number; top: number; transform?: string } {
  const { placement, margin, offset } = options
  if (placement === 'left') {
    return {
      left: clamp(rect.left - offset, margin + size.width, Math.max(margin + size.width, window.innerWidth - margin)),
      top: clamp(
        rect.top + rect.height / 2 - size.height / 2,
        margin,
        Math.max(margin, window.innerHeight - margin - size.height),
      ),
      transform: 'translateX(-100%)',
    }
  }
  return {
    left: clamp(rect.left, margin, Math.max(margin, window.innerWidth - margin - size.width)),
    top: clamp(rect.top + rect.height + offset, margin, Math.max(margin, window.innerHeight - margin - size.height)),
  }
}
