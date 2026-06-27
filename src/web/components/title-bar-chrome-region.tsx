import { Slot } from 'radix-ui'
import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { cn } from '#/web/lib/cn.ts'

// Electron folds app-region rectangles in DOM order: drag rectangles are
// unioned, then later no-drag rectangles are subtracted. Render broad drag
// surfaces before interactive controls that must cut through them.

interface TitleBarDragRegionProps extends ComponentPropsWithoutRef<'div'> {
  reserveWindowControls?: boolean
}

export const TitleBarDragRegion = forwardRef<HTMLDivElement, TitleBarDragRegionProps>(function TitleBarDragRegion(
  { reserveWindowControls = true, className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      {...props}
      data-title-bar-chrome-region="drag"
      className={cn(reserveWindowControls ? 'title-bar-chrome' : 'app-drag-region', className)}
    />
  )
})

interface TitleBarInteractiveRegionProps extends ComponentPropsWithoutRef<'div'> {
  asChild?: boolean
}

export const TitleBarInteractiveRegion = forwardRef<HTMLDivElement, TitleBarInteractiveRegionProps>(
  function TitleBarInteractiveRegion({ asChild = false, ...props }, ref) {
    const Comp = asChild ? Slot.Root : 'div'
    return <Comp ref={ref} {...props} data-interactive data-title-bar-chrome-region="interactive" />
  },
)

interface TitleBarNoDragRegionProps extends ComponentPropsWithoutRef<'div'> {
  asChild?: boolean
}

export const TitleBarNoDragRegion = forwardRef<HTMLDivElement, TitleBarNoDragRegionProps>(function TitleBarNoDragRegion(
  { asChild = false, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : 'div'
  return <Comp ref={ref} {...props} data-title-bar-chrome-region="no-drag" />
})
