// Shared visual styling for Radix-anchored floating surfaces (Popover,
// HoverCard, …). Each Radix primitive publishes its own
// `--radix-{name}-content-transform-origin` CSS variable, so callers
// pass that name in via `transformOriginVar` rather than baking one
// primitive's variable into the shared chrome.
//
// Wraps the supplied Radix Content element with the shared className
// and forwards all remaining props (`align`, `sideOffset`, collision
// paddings, event handlers, etc.) so each consumer can stay a thin
// shim around its primitive.

import { type ElementType, type ReactNode } from 'react'
import { cn } from '#/web/lib/cn.ts'

const FLOATING_CONTENT_BASE_CLASS =
  'z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden ' +
  'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 ' +
  'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ' +
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 ' +
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95'

interface FloatingContentProps {
  /** Radix Content component to render (e.g. `PopoverPrimitive.Content`). */
  as: ElementType
  /** `data-slot` value for css/js targeting (e.g. `'popover-content'`). */
  slot: string
  /** CSS custom property name for the transform origin (e.g.
   *  `'--radix-popover-content-transform-origin'`). */
  transformOriginVar: string
  className?: string
  children?: ReactNode
}

export function FloatingContent({
  as: Component,
  slot,
  transformOriginVar,
  className,
  children,
  ...rest
}: FloatingContentProps & Record<string, unknown>) {
  return (
    <Component
      data-slot={slot}
      data-floating-surface=""
      className={cn(FLOATING_CONTENT_BASE_CLASS, `origin-(${transformOriginVar})`, className)}
      {...rest}
    >
      {children}
    </Component>
  )
}
