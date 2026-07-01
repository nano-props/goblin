import * as React from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { FloatingContent } from '#/web/components/ui/floating-content.tsx'
import { useFloatingSurfaceBoundaryPin } from '#/web/components/ui/floating-surface-boundary.tsx'
import { cn } from '#/web/lib/cn.ts'
function Popover({ open, defaultOpen, onOpenChange, ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  const controlled = open !== undefined
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false)
  const effectiveOpen = controlled ? open : internalOpen

  useFloatingSurfaceBoundaryPin(effectiveOpen)

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!controlled) setInternalOpen(nextOpen)
      onOpenChange?.(nextOpen)
    },
    [controlled, onOpenChange],
  )

  return <PopoverPrimitive.Root data-slot="popover" open={effectiveOpen} onOpenChange={handleOpenChange} {...props} />
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <FloatingContent
        as={PopoverPrimitive.Content}
        slot="popover-content"
        transformOriginVar="--radix-popover-content-transform-origin"
        align={align}
        sideOffset={sideOffset}
        className={className}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

function PopoverHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="popover-header" className={cn('flex flex-col gap-1 text-sm', className)} {...props} />
}

function PopoverTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <div data-slot="popover-title" className={cn('font-medium', className)} {...props} />
}

function PopoverDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p data-slot="popover-description" className={cn('text-muted-foreground', className)} {...props} />
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor, PopoverHeader, PopoverTitle, PopoverDescription }
