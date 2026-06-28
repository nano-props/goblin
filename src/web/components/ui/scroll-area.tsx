import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef, type Ref, type UIEventHandler } from 'react'
import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui'
import { cn } from '#/web/lib/cn.ts'
type Orientation = 'vertical' | 'horizontal' | 'both'
// 'compact' omits the 11×11 transparent hit-target applied in the
// 'default' mode; use it for popovers and short lists where the
// scrollbar should feel lighter, and 'default' for persistent panes
// that the user scrolls often.
type ScrollbarMode = 'default' | 'compact'

interface ScrollAreaProps extends ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> {
  orientation?: Orientation
  scrollbarMode?: ScrollbarMode
  className?: string
  viewportClassName?: string
  viewportRef?: Ref<HTMLDivElement>
  viewportOnScroll?: UIEventHandler<HTMLDivElement>
}

export const ScrollArea = forwardRef<ComponentRef<typeof ScrollAreaPrimitive.Root>, ScrollAreaProps>(
  function ScrollArea(
    {
      className,
      viewportClassName,
      viewportRef,
      viewportOnScroll,
      children,
      orientation = 'vertical',
      scrollbarMode = 'default',
      type = 'hover',
      scrollHideDelay = 800,
      ...props
    },
    ref,
  ) {
    return (
      <ScrollAreaPrimitive.Root
        ref={ref}
        type={type}
        scrollHideDelay={scrollHideDelay}
        data-scrollbar-mode={scrollbarMode}
        className={cn('relative overflow-hidden flex flex-col', className)}
        {...props}
      >
        <ScrollAreaPrimitive.Viewport
          ref={viewportRef}
          onScroll={viewportOnScroll}
          className={cn(
            'flex-1 min-h-0 w-full',
            orientation !== 'horizontal' && '[&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full',
            viewportClassName,
          )}
        >
          {children}
        </ScrollAreaPrimitive.Viewport>
        {(orientation === 'vertical' || orientation === 'both') && (
          <ScrollBar orientation="vertical" mode={scrollbarMode} />
        )}
        {(orientation === 'horizontal' || orientation === 'both') && (
          <ScrollBar orientation="horizontal" mode={scrollbarMode} />
        )}
        <ScrollAreaPrimitive.Corner className="bg-transparent" />
      </ScrollAreaPrimitive.Root>
    )
  },
)

interface ScrollBarProps extends ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar> {
  orientation?: 'vertical' | 'horizontal'
  mode?: ScrollbarMode
}

const ScrollBar = forwardRef<ComponentRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>, ScrollBarProps>(
  function ScrollBar({ className, orientation = 'vertical', mode = 'default', ...props }, ref) {
    return (
      <ScrollAreaPrimitive.Scrollbar
        ref={ref}
        orientation={orientation}
        data-title-bar-chrome-region="no-drag"
        className={cn(
          'flex touch-none select-none p-0.5 opacity-0 transition-opacity duration-200 ease-out data-[state=visible]:opacity-100',
          orientation === 'vertical' && 'h-full w-2 border-l border-l-transparent',
          orientation === 'horizontal' && 'h-2 w-full flex-col border-t border-t-transparent',
          className,
        )}
        {...props}
      >
        <ScrollAreaPrimitive.Thumb
          className={cn(
            'relative flex-1 rounded-full bg-muted-foreground/40 transition-[background-color,width,height] duration-150 ease-out hover:bg-muted-foreground/70 active:bg-muted-foreground/80',
            orientation === 'vertical' && 'mx-auto w-1 hover:w-1.5',
            orientation === 'horizontal' && 'my-auto h-1 hover:h-1.5',
            mode === 'default' &&
              'before:absolute before:left-1/2 before:top-1/2 before:min-h-11 before:min-w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[""]',
          )}
        />
      </ScrollAreaPrimitive.Scrollbar>
    )
  },
)
