import * as React from 'react'
import * as ResizablePrimitive from 'react-resizable-panels'
import { cn } from '#/web/lib/cn.ts'
type ResizeDirection = 'horizontal' | 'vertical'
type ResizableHandleProps = React.ComponentProps<typeof ResizablePrimitive.Separator> & {
  orientation?: ResizeDirection
}

// Keep the drag hit target and the visible splitter line separate: the
// target stays transparent, while the 1px line paints the separator. This
// avoids double-painting semi-transparent border tokens on light themes.
const resizeHandle = {
  hitTarget: [
    'group relative z-10 flex shrink-0 items-center justify-center bg-transparent outline-none',
    'before:absolute before:z-10 before:content-[""]',
  ].join(' '),
  horizontal: 'h-full w-px cursor-col-resize before:inset-y-0 before:left-1/2 before:w-2 before:-translate-x-1/2',
  vertical: 'h-px w-full cursor-row-resize before:inset-x-0 before:top-1/2 before:h-2 before:-translate-y-1/2',
  visibleLine: [
    'pointer-events-none absolute z-20 rounded-full bg-separator/70',
    'transition-[background-color,opacity,width,height] duration-100',
    'opacity-100 group-data-[separator=hover]:bg-brand group-data-[separator=hover]:opacity-60',
    'group-focus-visible:bg-brand group-focus-visible:opacity-100 group-data-[separator=active]:bg-brand group-data-[separator=active]:opacity-100',
  ].join(' '),
  lineHorizontal:
    'inset-y-0 left-1/2 w-px -translate-x-1/2 group-data-[separator=hover]:w-0.5 group-focus-visible:w-0.5 group-data-[separator=active]:w-0.5',
  lineVertical:
    'inset-x-0 top-1/2 h-px -translate-y-1/2 group-data-[separator=hover]:h-0.5 group-focus-visible:h-0.5 group-data-[separator=active]:h-0.5',
} as const

function ResizablePanelGroup({ className, ...props }: React.ComponentProps<typeof ResizablePrimitive.Group>) {
  return (
    <ResizablePrimitive.Group data-slot="resizable-panel-group" className={cn('h-full w-full', className)} {...props} />
  )
}

function ResizablePanel(props: React.ComponentProps<typeof ResizablePrimitive.Panel>) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({ className, orientation = 'horizontal', ...props }: ResizableHandleProps) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(resizeHandle.hitTarget, resizeHandle[orientation], className)}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          resizeHandle.visibleLine,
          orientation === 'horizontal' ? resizeHandle.lineHorizontal : resizeHandle.lineVertical,
        )}
      />
    </ResizablePrimitive.Separator>
  )
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
