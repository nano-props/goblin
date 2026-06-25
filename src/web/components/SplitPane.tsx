import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import type { ReactNode } from 'react'
import { useGroupRef } from 'react-resizable-panels'
import type { Layout } from 'react-resizable-panels'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '#/web/components/ui/resizable.tsx'
import { cn } from '#/web/lib/cn.ts'
import { WORKSPACE_PANE_MOTION_STYLE, WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'
import { useElementInlineSize } from '#/web/hooks/useElementInlineSize.ts'

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
type CollapseTransitionDirection = 'collapsing' | 'expanding'

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
  const collapseTransition = useCollapseTransition(beforeCollapsed, animateBeforeCollapse)
  const collapseTransitioning = collapseTransition !== null
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
      data-collapse-transition={collapseTransition ?? undefined}
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
          className={cn(
            'goblin-split-pane__handle',
            beforeCollapsed && !collapseTransitioning && 'goblin-split-pane__handle--collapsed',
          )}
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

function useCollapseTransition(collapsed: boolean, enabled: boolean): CollapseTransitionDirection | null {
  const previousCollapsedRef = useRef(collapsed)
  const [transition, setTransition] = useState<CollapseTransitionDirection | null>(null)
  const changedThisRender = enabled && previousCollapsedRef.current !== collapsed
  const changeDirection: CollapseTransitionDirection | null = changedThisRender
    ? collapsed
      ? 'collapsing'
      : 'expanding'
    : null

  useEffect(() => {
    if (!enabled) {
      previousCollapsedRef.current = collapsed
      setTransition(null)
      return
    }
    if (previousCollapsedRef.current === collapsed) return

    const direction: CollapseTransitionDirection = collapsed ? 'collapsing' : 'expanding'
    previousCollapsedRef.current = collapsed
    setTransition(direction)
    const timeout = window.setTimeout(() => setTransition(null), WORKSPACE_PANE_TRANSITION_MS)
    return () => window.clearTimeout(timeout)
  }, [collapsed, enabled])

  if (!enabled) return null
  return changeDirection ?? transition
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
  const measuredBeforeSize = useElementInlineSize(beforeClipRef, !frozen)
  const splitPaneSize = useElementInlineSize(splitPaneRef, true)
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
