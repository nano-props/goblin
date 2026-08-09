import { ScrollAreaCorner, ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from 'reka-ui'
import type { ScrollAreaRootProps, ScrollAreaScrollbarProps } from 'reka-ui'
import type { FunctionalComponent, HTMLAttributes, Ref } from 'vue'
import { cn } from '#/web/lib/cn.ts'

type Orientation = 'vertical' | 'horizontal' | 'both'
type ScrollbarMode = 'default' | 'compact'
type ViewportRef = Ref<HTMLDivElement | null> | ((element: HTMLDivElement | null) => void)

type ScrollAreaProps = Omit<ScrollAreaRootProps, 'class'> &
  HTMLAttributes & {
    orientation?: Orientation
    scrollbarMode?: ScrollbarMode
    viewportClass?: HTMLAttributes['class']
    viewportRef?: ViewportRef
    viewportOnScroll?: (event: Event) => void
  }

interface ViewportComponentRef {
  $el?: Element
  viewportElement?: HTMLElement
}

function assignViewportRef(target: ViewportRef | undefined, component: unknown): void {
  if (!target) return
  const exposed = component as ViewportComponentRef | null
  const element =
    exposed?.viewportElement instanceof HTMLDivElement
      ? exposed.viewportElement
      : exposed?.$el instanceof HTMLDivElement
        ? exposed.$el
        : null

  if (typeof target === 'function') target(element)
  else target.value = element
}

export const ScrollArea: FunctionalComponent<ScrollAreaProps> = (props, { slots }) => {
  const {
    class: classValue,
    orientation = 'vertical',
    scrollbarMode = 'default',
    scrollHideDelay = 800,
    type = 'hover',
    viewportClass,
    viewportOnScroll,
    viewportRef,
    ...rootProps
  } = props
  const viewportAttributes: HTMLAttributes = {
    onScroll: viewportOnScroll,
    class: cn(
      'min-h-0 w-full flex-1',
      orientation !== 'horizontal' && '[&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full',
      viewportClass,
    ),
  }

  return (
    <ScrollAreaRoot
      {...rootProps}
      type={type}
      scrollHideDelay={scrollHideDelay}
      data-scrollbar-mode={scrollbarMode}
      class={cn('relative flex flex-col overflow-hidden', classValue)}
    >
      <ScrollAreaViewport {...viewportAttributes} ref={(component) => assignViewportRef(viewportRef, component)}>
        {slots.default?.()}
      </ScrollAreaViewport>
      {orientation === 'vertical' || orientation === 'both' ? (
        <ScrollBar orientation="vertical" mode={scrollbarMode} />
      ) : null}
      {orientation === 'horizontal' || orientation === 'both' ? (
        <ScrollBar orientation="horizontal" mode={scrollbarMode} />
      ) : null}
      <ScrollAreaCorner class="bg-transparent" />
    </ScrollAreaRoot>
  )
}
ScrollArea.inheritAttrs = false

type ScrollBarProps = Omit<ScrollAreaScrollbarProps, 'class'> &
  HTMLAttributes & {
    mode?: ScrollbarMode
  }

const ScrollBar: FunctionalComponent<ScrollBarProps> = (props, { slots }) => {
  const { class: classValue, mode = 'default', orientation = 'vertical', ...scrollbarProps } = props
  return (
    <ScrollAreaScrollbar
      {...scrollbarProps}
      orientation={orientation}
      data-title-bar-chrome-region="no-drag"
      class={cn(
        'flex touch-none select-none p-0.5 opacity-0 transition-opacity duration-200 ease-out data-[state=visible]:opacity-100',
        orientation === 'vertical' && 'h-full w-2 border-l border-l-transparent',
        orientation === 'horizontal' && 'h-2 w-full flex-col border-t border-t-transparent',
        classValue,
      )}
    >
      <ScrollAreaThumb
        class={cn(
          'relative flex-1 rounded-full bg-muted-foreground/40 duration-150 ease-out hover:bg-muted-foreground/70 active:bg-muted-foreground/80',
          orientation === 'vertical' && 'mx-auto w-1 transition-[background-color,width] hover:w-1.5',
          orientation === 'horizontal' && 'my-auto h-1 transition-[background-color,height] hover:h-1.5',
          mode === 'default' &&
            'before:absolute before:left-1/2 before:top-1/2 before:min-h-11 before:min-w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[""]',
        )}
      />
      {slots.default?.()}
    </ScrollAreaScrollbar>
  )
}
ScrollBar.inheritAttrs = false

export type { Orientation as ScrollAreaOrientation, ScrollAreaProps, ScrollbarMode }
