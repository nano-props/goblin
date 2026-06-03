import { useCallback, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useGroupRef } from 'react-resizable-panels'
import type { Layout } from 'react-resizable-panels'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '#/web/components/ui/resizable.tsx'
import { cn } from '#/web/lib/cn.ts'
type SplitPaneOrientation = 'horizontal' | 'vertical'

interface SplitPaneProps {
  before: ReactNode
  after: ReactNode
  afterSize: number
  onAfterSizeChange?: (size: number) => void
  orientation?: SplitPaneOrientation
  className?: string
  beforeClassName?: string
  afterClassName?: string
  beforeMinSize?: number | string
  afterMinSize?: number | string
  afterMaxSize?: number | string
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
  orientation = 'horizontal',
  className,
  beforeClassName,
  afterClassName,
  beforeMinSize = '12rem',
  afterMinSize = '12rem',
  afterMaxSize,
  disabled = false,
}: SplitPaneProps) {
  const groupRef = useGroupRef()
  const layout = useMemo<Layout>(
    () => ({ [BEFORE_PANEL_ID]: 100 - afterSize, [AFTER_PANEL_ID]: afterSize }),
    [afterSize],
  )
  const handleLayoutChanged = useCallback(
    (layout: Layout) => {
      const next = layout[AFTER_PANEL_ID]
      if (typeof next === 'number') onAfterSizeChange?.(next)
    },
    [onAfterSizeChange],
  )

  useEffect(() => {
    groupRef.current?.setLayout(layout)
  }, [groupRef, layout])

  return (
    <ResizablePanelGroup
      groupRef={groupRef}
      orientation={orientation}
      disabled={disabled}
      resizeTargetMinimumSize={RESIZE_TARGET_MINIMUM_SIZE}
      defaultLayout={layout}
      onLayoutChanged={handleLayoutChanged}
      className={cn('min-h-0 min-w-0', className)}
    >
      <ResizablePanel
        id={BEFORE_PANEL_ID}
        minSize={beforeMinSize}
        className={cn('flex min-h-0 min-w-0 overflow-hidden', beforeClassName)}
      >
        {before}
      </ResizablePanel>
      <ResizableHandle orientation={orientation} disabled={disabled} />
      <ResizablePanel
        id={AFTER_PANEL_ID}
        minSize={afterMinSize}
        maxSize={afterMaxSize}
        className={cn('flex min-h-0 min-w-0 overflow-hidden', afterClassName)}
      >
        {after}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
