import * as React from 'react'
import { HoverCard as HoverCardPrimitive } from 'radix-ui'
import { FloatingContent } from '#/web/components/ui/floating-content.tsx'

function HoverCard({ ...props }: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />
}

function HoverCardTrigger({ ...props }: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
}

function HoverCardPortal({ ...props }: React.ComponentProps<typeof HoverCardPrimitive.Portal>) {
  return <HoverCardPrimitive.Portal data-slot="hover-card-portal" {...props} />
}

function HoverCardContent({
  className,
  align = 'center',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal>
      <FloatingContent
        as={HoverCardPrimitive.Content}
        slot="hover-card-content"
        transformOriginVar="--radix-hover-card-content-transform-origin"
        align={align}
        sideOffset={sideOffset}
        className={className}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardTrigger, HoverCardPortal, HoverCardContent }
