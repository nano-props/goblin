import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import { createPortal } from 'react-dom'
import { tildify } from '#/renderer/lib/paths.ts'
import type { RepoTabSummary } from '#/renderer/components/repo-tabs/types.ts'

interface TooltipState {
  repo: RepoTabSummary
  rect: {
    left: number
    top: number
    width: number
    height: number
  }
}

interface TabTooltipLayerProps extends ComponentPropsWithoutRef<'div'> {
  repos: RepoTabSummary[]
  delayMs?: number
}

const TAB_TOOLTIP_SELECTOR = '[data-repo-tab-tooltip-id]'
const DEFAULT_DELAY_MS = 700
const MAX_WIDTH = 320
const MARGIN = 8

export function TabTooltipLayer({ repos, delayMs = DEFAULT_DELAY_MS, children, ...props }: TabTooltipLayerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const timerRef = useRef<number | null>(null)
  const reposRef = useRef(repos)
  const delayRef = useRef(delayMs)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  reposRef.current = repos
  delayRef.current = delayMs

  function clearTimer() {
    if (timerRef.current === null) return
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }

  function hideTooltip() {
    clearTimer()
    setTooltip(null)
  }

  useEffect(() => {
    const root = rootRef.current
    if (!root) return clearTimer

    function tabElementFromTarget(target: EventTarget | null): HTMLElement | null {
      return target instanceof Element ? target.closest<HTMLElement>(TAB_TOOLTIP_SELECTOR) : null
    }

    function repoFromElement(element: HTMLElement): RepoTabSummary | null {
      const id = element.dataset.repoTabTooltipId
      if (!id) return null
      return reposRef.current.find((repo) => repo.id === id) ?? null
    }

    function showTooltipAfterDelay(element: HTMLElement, repo: RepoTabSummary) {
      hideTooltip()
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return
        setTooltip({
          repo,
          rect: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          },
        })
      }, delayRef.current)
    }

    function handlePointerOver(event: PointerEvent) {
      const nextElement = tabElementFromTarget(event.target)
      const prevElement = tabElementFromTarget(event.relatedTarget)
      if (!nextElement || nextElement === prevElement) return
      const repo = repoFromElement(nextElement)
      if (!repo) return
      showTooltipAfterDelay(nextElement, repo)
    }

    function handlePointerOut(event: PointerEvent) {
      const prevElement = tabElementFromTarget(event.target)
      const nextElement = tabElementFromTarget(event.relatedTarget)
      if (!prevElement || prevElement === nextElement) return
      hideTooltip()
    }

    function handleFocusIn(event: FocusEvent) {
      const nextElement = tabElementFromTarget(event.target)
      const prevElement = tabElementFromTarget(event.relatedTarget)
      if (!nextElement || nextElement === prevElement) return
      const repo = repoFromElement(nextElement)
      if (!repo) return
      showTooltipAfterDelay(nextElement, repo)
    }

    function handleFocusOut(event: FocusEvent) {
      const prevElement = tabElementFromTarget(event.target)
      const nextElement = tabElementFromTarget(event.relatedTarget)
      if (!prevElement || prevElement === nextElement) return
      hideTooltip()
    }

    root.addEventListener('pointerover', handlePointerOver)
    root.addEventListener('pointerout', handlePointerOut)
    root.addEventListener('focusin', handleFocusIn)
    root.addEventListener('focusout', handleFocusOut)
    root.addEventListener('pointerdown', hideTooltip, true)
    root.addEventListener('wheel', hideTooltip, true)
    root.addEventListener('scroll', hideTooltip, true)
    window.addEventListener('blur', hideTooltip)
    return () => {
      root.removeEventListener('pointerover', handlePointerOver)
      root.removeEventListener('pointerout', handlePointerOut)
      root.removeEventListener('focusin', handleFocusIn)
      root.removeEventListener('focusout', handleFocusOut)
      root.removeEventListener('pointerdown', hideTooltip, true)
      root.removeEventListener('wheel', hideTooltip, true)
      root.removeEventListener('scroll', hideTooltip, true)
      window.removeEventListener('blur', hideTooltip)
      clearTimer()
    }
  }, [])

  useEffect(() => {
    hideTooltip()
  }, [repos])

  return (
    <>
      <div ref={rootRef} {...props}>
        {children}
      </div>
      {tooltip && <RepoTabTooltip tooltip={tooltip} />}
    </>
  )
}

function RepoTabTooltip({ tooltip }: { tooltip: TooltipState }) {
  const [visible, setVisible] = useState(false)
  const anchorX = tooltip.rect.left + tooltip.rect.width / 2
  const minX = MARGIN + MAX_WIDTH / 2
  const maxX = Math.max(minX, window.innerWidth - MARGIN - MAX_WIDTH / 2)
  const x = Math.min(Math.max(anchorX, minX), maxX)
  const y = tooltip.rect.top + tooltip.rect.height + 6

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setVisible(true))
    return () => window.cancelAnimationFrame(id)
  }, [])

  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 w-max max-w-80 rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md transition-opacity duration-100 ease-out"
      style={{ left: x, top: y, opacity: visible ? 1 : 0, transform: 'translateX(-50%)' }}
    >
      <div className="font-medium text-popover-foreground">{tooltip.repo.name}</div>
      <div className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">{tildify(tooltip.repo.id)}</div>
    </div>,
    document.body,
  )
}
