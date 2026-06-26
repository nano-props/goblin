import { Slot } from 'radix-ui'
import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { cn } from '#/web/lib/cn.ts'

interface WindowChromeDragRegionProps extends ComponentPropsWithoutRef<'div'> {
  reserveWindowControls?: boolean
}

export const WindowChromeDragRegion = forwardRef<HTMLDivElement, WindowChromeDragRegionProps>(
  function WindowChromeDragRegion({ reserveWindowControls = true, className, ...props }, ref) {
    return (
      <div
        ref={ref}
        {...props}
        data-window-chrome-region="drag"
        className={cn(reserveWindowControls ? 'window-chrome' : 'app-drag-region', className)}
      />
    )
  },
)

interface WindowChromeInteractiveRegionProps extends ComponentPropsWithoutRef<'div'> {
  asChild?: boolean
}

export const WindowChromeInteractiveRegion = forwardRef<HTMLDivElement, WindowChromeInteractiveRegionProps>(
  function WindowChromeInteractiveRegion({ asChild = false, ...props }, ref) {
    const Comp = asChild ? Slot.Root : 'div'
    return <Comp ref={ref} {...props} data-interactive data-window-chrome-region="interactive" />
  },
)
