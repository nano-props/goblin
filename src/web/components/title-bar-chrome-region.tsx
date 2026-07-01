import { Slot } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '#/web/lib/cn.ts'

// Electron folds app-region rectangles in DOM order: drag rectangles are
// unioned, then later no-drag rectangles are subtracted. Render broad drag
// surfaces before interactive controls that must cut through them.

interface TitleBarDragRegionProps extends ComponentProps<'div'> {
  reserveWindowControls?: boolean
}

export function TitleBarDragRegion({
  reserveWindowControls = true,
  className,
  ref,
  ...props
}: TitleBarDragRegionProps) {
  return (
    <div
      ref={ref}
      {...props}
      data-title-bar-chrome-region="drag"
      className={cn(reserveWindowControls ? 'title-bar-chrome' : 'app-drag-region', className)}
    />
  )
}

interface TitleBarInteractiveRegionProps extends ComponentProps<'div'> {
  asChild?: boolean
}

export function TitleBarInteractiveRegion({ asChild = false, ref, ...props }: TitleBarInteractiveRegionProps) {
  const Comp = asChild ? Slot.Root : 'div'
  return <Comp ref={ref} {...props} data-interactive data-title-bar-chrome-region="interactive" />
}

export function TitleBarScrollableInteractiveRegion({
  asChild = false,
  className,
  ref,
  ...props
}: TitleBarInteractiveRegionProps) {
  const Comp = asChild ? Slot.Root : 'div'
  return (
    <Comp
      ref={ref}
      {...props}
      data-interactive
      data-title-bar-chrome-region="interactive"
      data-title-bar-scroll-region=""
      className={cn('title-bar-scroll-region', className)}
    />
  )
}

interface TitleBarNoDragRegionProps extends ComponentProps<'div'> {
  asChild?: boolean
}

export function TitleBarNoDragRegion({ asChild = false, ref, ...props }: TitleBarNoDragRegionProps) {
  const Comp = asChild ? Slot.Root : 'div'
  return <Comp ref={ref} {...props} data-title-bar-chrome-region="no-drag" />
}
