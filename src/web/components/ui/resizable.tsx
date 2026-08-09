import { SplitterGroup, SplitterResizeHandle } from 'reka-ui'
import type { SplitterGroupProps, SplitterResizeHandleProps } from 'reka-ui'
import type { FunctionalComponent, HTMLAttributes } from 'vue'
import { cn } from '#/web/lib/cn.ts'

const resizeHandleClassNames = {
  hitTarget: [
    'group relative z-10 flex shrink-0 items-center justify-center bg-transparent outline-none',
    'before:absolute before:z-10 before:content-[""]',
  ].join(' '),
  horizontal: 'h-full w-px cursor-col-resize before:inset-y-0 before:left-1/2 before:w-2 before:-translate-x-1/2',
  visibleLine: [
    'pointer-events-none absolute z-20 rounded-full bg-separator/70',
    'transition-[background-color,opacity,width,height] duration-100',
    'opacity-100 group-data-[state=hover]:bg-brand group-data-[state=hover]:opacity-60',
    'group-focus-visible:bg-brand group-focus-visible:opacity-100 group-data-[state=drag]:bg-brand group-data-[state=drag]:opacity-100',
  ].join(' '),
  lineHorizontal:
    'inset-y-0 left-1/2 w-px -translate-x-1/2 group-data-[state=hover]:w-0.5 group-focus-visible:w-0.5 group-data-[state=drag]:w-0.5',
} as const

type ResizablePanelGroupProps = Omit<SplitterGroupProps, 'keyboardResizeBy'> &
  HTMLAttributes & {
    onLayout?: (layout: number[]) => void
  }

export const ResizablePanelGroup: FunctionalComponent<ResizablePanelGroupProps> = (props, { slots }) => {
  const { class: classValue, ...groupProps } = props
  return (
    <SplitterGroup
      {...groupProps}
      keyboardResizeBy={5}
      data-slot="resizable-panel-group"
      class={cn('h-full w-full', classValue)}
    >
      {slots.default?.()}
    </SplitterGroup>
  )
}
ResizablePanelGroup.inheritAttrs = false

type ResizableHandleProps = SplitterResizeHandleProps & HTMLAttributes

export const ResizableHandle: FunctionalComponent<ResizableHandleProps> = (props, { slots }) => {
  const { class: classValue, ...handleProps } = props
  return (
    <SplitterResizeHandle
      {...handleProps}
      aria-orientation="vertical"
      data-slot="resizable-handle"
      class={cn(resizeHandleClassNames.hitTarget, resizeHandleClassNames.horizontal, classValue)}
    >
      <ResizeHandleLine />
      {slots.default?.()}
    </SplitterResizeHandle>
  )
}
ResizableHandle.inheritAttrs = false

export function ResizeHandleLine() {
  return (
    <span aria-hidden="true" class={cn(resizeHandleClassNames.visibleLine, resizeHandleClassNames.lineHorizontal)} />
  )
}

export { resizeHandleClassNames }
