// One-pixel divider primitive shared across the app.
//
// All inline 1px separators (vertical seams between toolbar siblings,
// horizontal rules between popover sections) used to be hand-rolled
// `<div className="h-px bg-separator">` / `<span className="border-l
// border-separator">` strings. They drifted in height (h-4 vs h-5) and
// implementation (background fill vs left/right border) across files —
// this primitive consolidates them.
//
// Variants are kept narrow on purpose: this is *only* the 1px line
// between two sibling elements. Larger surface dividers (the workspace
// toolbar's own `border-b`, the sidebar's `border-r`, list `divide-y`) continue
// to use Tailwind border utilities — they belong to the surrounding
// container's box, not to a separate child element.
//
// Orientation:
//   • horizontal (default): h-px w-full. Use between stacked groups
//     inside popovers/menus. Matches the SelectSeparator and
//     DropdownMenuSeparator rendering — they remain Radix-wrapped
//     because they participate in those primitives' keyboard nav.
//   • vertical: w-px h-<size>. Use as an inline seam between toolbar
//     siblings. Most callers wrap the rendered element in a `relative`
//     parent and add `absolute left-0|right-0 top-1/2 -translate-y-1/2`
//     via `className` to overlay the seam without consuming layout width.
//
// Size:
//   • sm (default): vertical = h-4 (16px). Matches the tab-strip /
//     leading-action chrome height (h-7 / h-8 wrappers) across
//     RepoPicker, WorkspacePane, and the Focus Mode seam.
//   • md: vertical = h-5 (20px). Reserved for any future 40px+
//     toolbar that needs a chunkier seam — no current caller.
//
// The element renders `aria-hidden="true"` because separators here are
// decorative chrome — surrounding labels carry the actual semantics, and
// AT skips `aria-hidden` subtrees regardless of any `role` set on them.
// Tests should query for `[data-slot="separator"]` (and
// `[data-orientation="vertical"|"horizontal"]` when orientation matters)
// rather than asserting on implementation-detail class strings.

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '#/web/lib/cn.ts'

const separatorVariants = cva('pointer-events-none shrink-0 bg-separator', {
  variants: {
    orientation: {
      horizontal: 'w-full',
      vertical: 'w-px',
    },
    size: {
      sm: '',
      md: '',
    },
  },
  compoundVariants: [
    { orientation: 'horizontal', size: 'sm', class: 'h-px' },
    { orientation: 'horizontal', size: 'md', class: 'h-px' },
    { orientation: 'vertical', size: 'sm', class: 'h-4' },
    { orientation: 'vertical', size: 'md', class: 'h-5' },
  ],
  defaultVariants: {
    orientation: 'horizontal',
    size: 'sm',
  },
})

function Separator({
  className,
  orientation = 'horizontal',
  size = 'sm',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof separatorVariants>) {
  // `aria-hidden` is intentional: separators here are decorative chrome
  // (the surrounding labels carry the semantics). Skipping `role="separator"`
  // / `aria-orientation` keeps the ARIA story consistent — both would be
  // ignored by AT under aria-hidden anyway.
  //
  // `data-orientation` / `data-size` fall back to the resolved variant so
  // the data attributes stay in sync with the applied CVA classes even
  // when a caller passes the prop as `null` (the destructure default
  // already covers `undefined`; CVA's `VariantProps` type permits both).
  const resolvedOrientation = orientation ?? 'horizontal'
  const resolvedSize = size ?? 'sm'
  return (
    <div
      aria-hidden="true"
      data-slot="separator"
      data-orientation={resolvedOrientation}
      data-size={resolvedSize}
      className={cn(separatorVariants({ orientation: resolvedOrientation, size: resolvedSize, className }))}
      {...props}
    />
  )
}

export { Separator, separatorVariants }
