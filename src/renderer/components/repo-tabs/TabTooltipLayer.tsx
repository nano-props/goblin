import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import { createPortal } from 'react-dom'
import { tildify } from '#/renderer/lib/paths.ts'
import type { RepoTabSummary } from '#/renderer/components/repo-tabs/types.ts'

// --- Types ----------------------------------------------------------------

interface AnchorRect {
  left: number
  top: number
  height: number
}

interface TooltipState {
  repo: RepoTabSummary
  rect: AnchorRect
}

interface TabTooltipLayerProps extends ComponentPropsWithoutRef<'div'> {
  repos: RepoTabSummary[]
  delayMs?: number
}

// --- Constants ------------------------------------------------------------

const TAB_TOOLTIP_SELECTOR = '[data-repo-tab-tooltip-id]'
const DEFAULT_DELAY_MS = 700
/** Grace period before hiding after the pointer leaves the tab strip. */
const GRACE_MS = 100
const MAX_WIDTH = 320
const MARGIN = 8
const OFFSET_Y = 6
const FADE_TRANSITION = 'opacity 100ms ease-out'
const SLIDE_TRANSITION = 'left 150ms ease-out, opacity 100ms ease-out'

// --- Helpers --------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function closestTabElement(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(TAB_TOOLTIP_SELECTOR) : null
}

function readAnchorRect(el: HTMLElement): AnchorRect | null {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, height: r.height } : null
}

// --- TabTooltipLayer ------------------------------------------------------
// Custom tooltip layer for repo tabs. Standard Radix Tooltip wraps each
// trigger in its own Root, which conflicts with dnd-kit sortable layout
// and adds per-item overhead for a dynamic list. This component uses event
// delegation on a single root instead: one pointerover/focusin listener
// resolves the hovered tab via `data-repo-tab-tooltip-id`, shows a
// portal-rendered tooltip after a delay, and dismisses on interaction or
// blur — all without extra DOM wrappers around each tab.
//
// The tooltip follows a warm/cold state machine inspired by Chrome tabs:
// - Cold: no tooltip visible. Entering a tab starts a delay timer.
// - Warm: tooltip visible. Entering a different tab immediately slides
//   the tooltip to the new anchor (no delay). Moving through gaps
//   between tabs keeps the tooltip warm — only leaving the entire strip
//   container (pointerleave) starts a short grace period.

export function TabTooltipLayer({ repos, delayMs = DEFAULT_DELAY_MS, children, ...props }: TabTooltipLayerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const showTimerRef = useRef<number | null>(null)
  const graceTimerRef = useRef<number | null>(null)
  const warmRef = useRef(false)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

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
    setTooltip(null)
  }, [clearShowTimer, clearGraceTimer])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return () => { clearShowTimer(); clearGraceTimer() }

    function repoFromElement(el: HTMLElement): RepoTabSummary | undefined {
      const id = el.dataset.repoTabTooltipId
      return id ? repos.find((r) => r.id === id) : undefined
    }

    function show(el: HTMLElement, repo: RepoTabSummary) {
      const rect = readAnchorRect(el)
      if (!rect) return
      warmRef.current = true
      setTooltip({ repo, rect })
    }

    function startGrace() {
      if (!warmRef.current) return
      clearGraceTimer()
      graceTimerRef.current = window.setTimeout(() => {
        graceTimerRef.current = null
        warmRef.current = false
        setTooltip(null)
      }, GRACE_MS)
    }

    function handleEnter(next: EventTarget | null, prev: EventTarget | null) {
      const nextEl = closestTabElement(next)
      if (!nextEl || nextEl === closestTabElement(prev)) return
      const repo = repoFromElement(nextEl)
      if (!repo) return

      clearGraceTimer()
      clearShowTimer()

      if (warmRef.current) {
        // Already showing — slide immediately to the new tab.
        show(nextEl, repo)
      } else {
        // Cold start — apply the hover delay.
        showTimerRef.current = window.setTimeout(() => {
          showTimerRef.current = null
          show(nextEl, repo)
        }, delayMs)
      }
    }

    // Pointer left a tab but may still be inside the strip (gap area).
    // Cancel any pending cold-start timer; the tooltip stays warm.
    function handlePointerTabLeave(e: PointerEvent) {
      const prevEl = closestTabElement(e.target)
      if (!prevEl || prevEl === closestTabElement(e.relatedTarget)) return
      clearShowTimer()
    }

    // Pointer left the entire strip container → start grace period.
    // `pointerleave` does not fire when moving between children, only
    // when the pointer truly exits the root bounds.
    function handleStripLeave() {
      clearShowTimer()
      startGrace()
    }

    // Focus can jump anywhere, so treat focusout as a full leave.
    function handleFocusLeave(e: FocusEvent) {
      const prevEl = closestTabElement(e.target)
      if (!prevEl || prevEl === closestTabElement(e.relatedTarget)) return
      clearShowTimer()
      startGrace()
    }

    const onPointerOver = (e: PointerEvent) => handleEnter(e.target, e.relatedTarget)
    const onFocusIn = (e: FocusEvent) => handleEnter(e.target, e.relatedTarget)

    root.addEventListener('pointerover', onPointerOver)
    root.addEventListener('pointerout', handlePointerTabLeave)
    root.addEventListener('pointerleave', handleStripLeave)
    root.addEventListener('focusin', onFocusIn)
    root.addEventListener('focusout', handleFocusLeave)
    root.addEventListener('pointerdown', hide, true)
    root.addEventListener('wheel', hide, true)
    root.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      root.removeEventListener('pointerover', onPointerOver)
      root.removeEventListener('pointerout', handlePointerTabLeave)
      root.removeEventListener('pointerleave', handleStripLeave)
      root.removeEventListener('focusin', onFocusIn)
      root.removeEventListener('focusout', handleFocusLeave)
      root.removeEventListener('pointerdown', hide, true)
      root.removeEventListener('wheel', hide, true)
      root.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
      clearShowTimer()
      clearGraceTimer()
    }
  }, [clearShowTimer, clearGraceTimer, delayMs, hide, repos])

  useEffect(() => {
    hide()
  }, [hide, repos])

  return (
    <>
      <div ref={rootRef} {...props}>
        {children}
      </div>
      {tooltip && <RepoTabTooltip tooltip={tooltip} />}
    </>
  )
}

// --- RepoTabTooltip -------------------------------------------------------
// Positioned below the anchor tab, left-aligned (bottom-start). When the
// tooltip would overflow the right viewport edge, it shifts inward (clamped)
// so edge tabs still get a nicely placed tooltip. The component stays
// mounted while the user moves between tabs — CSS transition on `left`
// produces the sliding effect, and only the initial appearance fades in.

function RepoTabTooltip({ tooltip }: { tooltip: TooltipState }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [mounted, setMounted] = useState(false)
  const [tipWidth, setTipWidth] = useState(MAX_WIDTH)

  // Re-measure intrinsic width before paint whenever the displayed repo
  // changes (different name/path → different width).
  useLayoutEffect(() => {
    const el = ref.current
    if (el) setTipWidth(el.offsetWidth)
  }, [tooltip.repo.id])

  // Fade in on initial mount only; subsequent slides stay fully opaque.
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setMounted(true))
    return () => window.cancelAnimationFrame(id)
  }, [])

  const x = clamp(tooltip.rect.left, MARGIN, Math.max(MARGIN, window.innerWidth - MARGIN - tipWidth))
  const y = tooltip.rect.top + tooltip.rect.height + OFFSET_Y

  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none fixed z-50 w-max rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
      style={{ left: x, top: y, maxWidth: MAX_WIDTH, opacity: mounted ? 1 : 0, transition: mounted ? SLIDE_TRANSITION : FADE_TRANSITION }}
    >
      <div className="font-medium text-popover-foreground">{tooltip.repo.name}</div>
      <div className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">{tildify(tooltip.repo.id)}</div>
    </div>,
    document.body,
  )
}
