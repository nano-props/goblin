import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import type { ReactNode } from 'react'
import { useGroupRef } from 'react-resizable-panels'
import type { Layout } from 'react-resizable-panels'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '#/web/components/ui/resizable.tsx'
import { cn } from '#/web/lib/cn.ts'
import { WORKSPACE_PANE_MOTION_STYLE, WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'

interface SplitPaneProps {
  before: ReactNode
  after: ReactNode
  afterSize: number
  onAfterSizeChange?: (size: number) => void
  className?: string
  beforeClassName?: string
  afterClassName?: string
  beforeMinSize?: number | string
  beforeContentMinSize?: string
  afterMinSize?: number | string
  afterMaxSize?: number | string
  beforeCollapsed?: boolean
  animateBeforeCollapse?: boolean
  disabled?: boolean
}

const BEFORE_PANEL_ID = 'before'
const AFTER_PANEL_ID = 'after'
const RESIZE_TARGET_MINIMUM_SIZE = { fine: 7, coarse: 20 }

export function SplitPane({
  before,
  after,
  afterSize,
  onAfterSizeChange,
  className,
  beforeClassName,
  afterClassName,
  beforeMinSize = '12rem',
  beforeContentMinSize,
  afterMinSize = '12rem',
  afterMaxSize,
  beforeCollapsed = false,
  animateBeforeCollapse = false,
  disabled = false,
}: SplitPaneProps) {
  const groupRef = useGroupRef()
  const splitPaneRef = useRef<HTMLDivElement | null>(null)
  const beforeClipRef = useRef<HTMLDivElement | null>(null)
  const collapseTransitioning = useCollapseTransition(beforeCollapsed, animateBeforeCollapse)
  const measuredBeforeContentSize = useStableBeforeContentSize({
    beforeClipRef,
    splitPaneRef,
    frozen: beforeCollapsed || collapseTransitioning,
  })
  const splitPaneStyle = useMemo<CSSProperties>(() => WORKSPACE_PANE_MOTION_STYLE, [])
  const beforeContentStyle = useMemo<CSSProperties | undefined>(
    () =>
      ({
        '--goblin-split-pane-before-open-size': `${100 - afterSize}cqw`,
        '--goblin-split-pane-before-measured-size':
          measuredBeforeContentSize === null ? undefined : `${measuredBeforeContentSize}px`,
        '--goblin-split-pane-before-min-size':
          beforeContentMinSize ?? (typeof beforeMinSize === 'string' ? beforeMinSize : undefined),
        '--goblin-split-pane-after-min-size': typeof afterMinSize === 'string' ? afterMinSize : undefined,
      }) as CSSProperties,
    [afterMinSize, afterSize, beforeContentMinSize, beforeMinSize, measuredBeforeContentSize],
  )
  const effectiveBeforeMinSize = beforeCollapsed ? 0 : beforeMinSize
  const layout = useMemo<Layout>(
    () =>
      beforeCollapsed
        ? { [BEFORE_PANEL_ID]: 0, [AFTER_PANEL_ID]: 100 }
        : { [BEFORE_PANEL_ID]: 100 - afterSize, [AFTER_PANEL_ID]: afterSize },
    [afterSize, beforeCollapsed],
  )
  const handleLayoutChanged = useCallback(
    (layout: Layout) => {
      if (beforeCollapsed) return
      const next = layout[AFTER_PANEL_ID]
      if (typeof next === 'number') onAfterSizeChange?.(next)
    },
    [beforeCollapsed, onAfterSizeChange],
  )

  useEffect(() => {
    groupRef.current?.setLayout(layout)
  }, [groupRef, layout])

  return (
    <div
      ref={splitPaneRef}
      data-before-collapsed={beforeCollapsed ? 'true' : undefined}
      data-collapse-transition={collapseTransitioning ? 'true' : undefined}
      style={splitPaneStyle}
      className={cn('goblin-split-pane min-h-0 min-w-0', className)}
    >
      <ResizablePanelGroup
        groupRef={groupRef}
        orientation="horizontal"
        disabled={disabled || beforeCollapsed}
        resizeTargetMinimumSize={RESIZE_TARGET_MINIMUM_SIZE}
        defaultLayout={layout}
        onLayoutChanged={handleLayoutChanged}
        className="min-h-0 min-w-0"
      >
        <ResizablePanel
          id={BEFORE_PANEL_ID}
          minSize={effectiveBeforeMinSize}
          aria-hidden={beforeCollapsed || undefined}
          inert={beforeCollapsed || undefined}
          className={cn('flex min-h-0 min-w-0 overflow-hidden', beforeClassName)}
        >
          <div
            ref={beforeClipRef}
            className="goblin-split-pane__before-clip flex min-h-0 min-w-0 flex-1 overflow-hidden"
          >
            <div
              className={cn(
                'goblin-split-pane__before-content flex min-h-0 shrink-0',
                beforeCollapsed && 'goblin-split-pane__before-content--collapsed',
              )}
              style={beforeContentStyle}
            >
              {before}
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle
          disabled={disabled || beforeCollapsed}
          className={cn('goblin-split-pane__handle', beforeCollapsed && 'goblin-split-pane__handle--collapsed')}
        />
        <ResizablePanel
          id={AFTER_PANEL_ID}
          minSize={afterMinSize}
          maxSize={afterMaxSize}
          className={cn('flex min-h-0 min-w-0 overflow-hidden', afterClassName)}
        >
          {after}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}

function useCollapseTransition(collapsed: boolean, enabled: boolean): boolean {
  const previousCollapsedRef = useRef(collapsed)
  const [transitioning, setTransitioning] = useState(false)
  const changedThisRender = enabled && previousCollapsedRef.current !== collapsed

  useEffect(() => {
    if (!enabled) {
      previousCollapsedRef.current = collapsed
      setTransitioning(false)
      return
    }
    if (!changedThisRender) return

    previousCollapsedRef.current = collapsed
    setTransitioning(true)
    const timeout = window.setTimeout(() => setTransitioning(false), WORKSPACE_PANE_TRANSITION_MS)
    return () => window.clearTimeout(timeout)
  }, [collapsed, enabled])

  return enabled && (changedThisRender || transitioning)
}

function useStableBeforeContentSize({
  beforeClipRef,
  splitPaneRef,
  frozen,
}: {
  beforeClipRef: RefObject<HTMLElement | null>
  splitPaneRef: RefObject<HTMLElement | null>
  frozen: boolean
}): number | null {
  const measuredBeforeSize = useMeasuredInlineSize(beforeClipRef, !frozen)
  const splitPaneSize = useMeasuredInlineSize(splitPaneRef, true)
  const measuredAtSplitPaneSizeRef = useRef<number | null>(null)
  const [stableBeforeSize, setStableBeforeSize] = useState<number | null>(null)

  useEffect(() => {
    if (frozen || measuredBeforeSize === null) return
    measuredAtSplitPaneSizeRef.current = splitPaneSize
    setStableBeforeSize(measuredBeforeSize)
  }, [frozen, measuredBeforeSize, splitPaneSize])

  useEffect(() => {
    if (!frozen || splitPaneSize === null) return
    const measuredAt = measuredAtSplitPaneSizeRef.current
    if (measuredAt !== null && Math.abs(measuredAt - splitPaneSize) > 0.5) setStableBeforeSize(null)
  }, [frozen, splitPaneSize])

  return stableBeforeSize
}

function useMeasuredInlineSize(ref: RefObject<HTMLElement | null>, enabled: boolean): number | null {
  const [inlineSize, setInlineSize] = useState<number | null>(null)

  useEffect(() => {
    if (!enabled) return
    const element = ref.current
    if (!element) return
    const update = (next: number) => {
      if (next <= 0) return
      setInlineSize((current) => (current !== null && Math.abs(current - next) <= 0.5 ? current : next))
    }

    update(element.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) update(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [enabled, ref])

  return inlineSize
}
