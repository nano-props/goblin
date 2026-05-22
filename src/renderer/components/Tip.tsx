// Thin wrapper around shadcn/ui Tooltip with the project's preferred
// defaults (200ms open delay, anchor below the trigger). Wrap any
// element that needs a hover label; Radix renders into a portal and
// survives `position: fixed` ancestors. Use this instead of the
// native `title=` attribute for any tooltip we want to style or
// compose with kbd chips.

import { useState, type ComponentProps, type ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '#/renderer/components/ui/tooltip.tsx'

interface Props {
  label: ReactNode
  /** Side of the trigger to anchor against. Default 'bottom'. */
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** Alignment along the chosen side. Default 'center'. */
  align?: 'start' | 'center' | 'end'
  /** ms before tooltip opens. Default 200. */
  delayMs?: number
  collisionPadding?: ComponentProps<typeof TooltipContent>['collisionPadding']
  forceOpen?: boolean
  children: ReactNode
}

export function Tip({
  label,
  side = 'bottom',
  align = 'center',
  delayMs = 200,
  collisionPadding,
  forceOpen = false,
  children,
}: Props) {
  const [hoverOpen, setHoverOpen] = useState(false)

  return (
    <TooltipProvider delayDuration={delayMs}>
      <Tooltip open={forceOpen || hoverOpen} onOpenChange={setHoverOpen}>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side} align={align} sideOffset={6} collisionPadding={collisionPadding}>
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
