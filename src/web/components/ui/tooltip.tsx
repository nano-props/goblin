'use client'

import * as React from 'react'
import { Tooltip as TooltipPrimitive } from 'radix-ui'

import { cn } from '#/web/lib/cn.ts'

const TOOLTIP_SURFACE_CLASS =
  'rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md'
const TOOLTIP_META_TEXT_CLASS = 'text-[11px] text-muted-foreground'
const TOOLTIP_STACK_SM_CLASS = 'space-y-0.5'
const TOOLTIP_STACK_MD_CLASS = 'space-y-1'

function TooltipProvider({ delayDuration = 0, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delayDuration={delayDuration} {...props} />
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  // Project-specific styling: tooltips read as a small popover card
  // (popover-coloured background, bordered, soft shadow) rather than
  // upstream shadcn's reverse-fill (foreground bg + background text).
  // Reverse-fill stands out as a separate visual register from the
  // rest of the floating UI (Popover, Modal), and on a dense tool
  // app the contrast is more shouty than informative.
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          `z-50 w-fit origin-(--radix-tooltip-content-transform-origin) animate-in ${TOOLTIP_SURFACE_CLASS} fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95`,
          className,
        )}
        {...props}
      >
        {children}
        {/* Arrow: a Radix `Arrow` primitive renders an `<svg>` with a
         * `<polygon>` triangle. Radix wraps the svg in a `<span>` whose
         * inline `transform` already orients the arrow toward the
         * trigger (`translateY(100%)` for top, `rotate(180deg)` for
         * bottom, `rotate(±90deg)` for left/right) — so we don't need
         * to rotate/translate the arrow ourselves. We only paint it:
         *   - `fill-popover` matches the content bg
         *   - `stroke-border` matches the content's 1px border
         *   - `stroke-1` keeps it the same width
         * SVG `stroke` paints on the polygon outline, which already
         * traces the visible triangle edges, so the popover border
         * appears continuous through the arrow without any per-side
         * branching. */}
        <TooltipPrimitive.Arrow width={10} height={5} className="z-50 fill-popover stroke-border [stroke-width:1]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  TOOLTIP_META_TEXT_CLASS,
  TOOLTIP_STACK_MD_CLASS,
  TOOLTIP_STACK_SM_CLASS,
  TOOLTIP_SURFACE_CLASS,
}
