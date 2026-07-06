import { Slot } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '#/web/lib/cn.ts'

// Electron folds app-region rectangles in DOM order: drag rectangles are
// unioned, then later no-drag rectangles are subtracted. Render broad drag
// surfaces before interactive controls that must cut through them.

interface TitleBarDragRegionProps extends ComponentProps<'div'> {
  reserveWindowControls?: boolean
}

type NativeDragPlateProps = Omit<TitleBarDragRegionProps, 'reserveWindowControls'>

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

export function NativeDragPlate({ className, ref, ...props }: NativeDragPlateProps) {
  // Electron app-region hit-testing is native region composition, not normal
  // DOM hit-testing. Use this for final transparent drag surfaces that must sit
  // above layered no-drag UI such as tab strips, floating panels, or overlays.
  return (
    <TitleBarDragRegion
      ref={ref}
      aria-hidden
      {...props}
      reserveWindowControls={false}
      className={cn('pointer-events-auto absolute left-0 top-0 bg-transparent', className)}
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
