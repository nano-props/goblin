// iOS-style segmented control: a recessed track containing N items;
// the selected item renders as a brand-tinted pill matching the
// dropdown menu's "selected" treatment (bg-selected /
// text-selected-foreground) — see `dropdown-menu.tsx`
// `SelectedDropdownMenuItem` for the same visual idiom.
//
// Why `[aria-checked=true]:` instead of `data-[state=on]:`?
// BranchViewModeControl wraps each Item in `Tip` (Radix
// TooltipTrigger with `asChild`). TooltipTrigger forwards its own
// props to the child and *overrides* the `data-state` attribute —
// the merged button ends up with `data-state="closed"`
// (TooltipTrigger's disclosure state) instead of `"on"`
// (ToggleGroupPrimitive.Item's selection state). A
// `data-[state=on]:*` selector therefore never matches when an
// Item is wrapped in `Tip`. `aria-checked="true"` is set by Radix
// ToggleGroup's selection logic and is *not* overridden by
// TooltipTrigger, so `[aria-checked=true]:bg-selected` is a
// reliable selector across both wrapped and unwrapped call sites.
//
// Why a dedicated primitive instead of the existing
// `toggle-group.tsx` wrapper? That wrapper's built-in
// `data-[spacing=0]:*` styles are tuned for the outline-variant
// "independent toggles" use case — they strip per-item shadows and
// round only the outer corners, so the seam between items doesn't
// read as a stepped edge. That style fights the filled-thumb look
// here, so SegmentedControl composes Radix ToggleGroup primitives
// directly and ships its own styling, staying out of the wrapper's
// way.
//
// The compound shape (`SegmentedControl.Root` + `SegmentedControl.Item`)
// follows Radix Themes' organization so call sites read the same
// way as any other Radix-based component in this design system.

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui'
import { cn } from '#/web/lib/cn.ts'
import { focusRing } from '#/web/components/ui/focus.ts'

type SingleToggleGroupProps = ToggleGroupPrimitive.ToggleGroupSingleProps

const segmentedControlRootVariants = cva(
  'inline-flex w-fit shrink-0 items-center rounded-md bg-segmented-track p-0.5',
  {
    variants: {
      size: {
        sm: 'h-6',
        md: 'h-7',
        lg: 'h-8',
      },
      fullWidth: {
        true: 'flex w-full',
        false: 'inline-flex w-fit',
      },
    },
    defaultVariants: {
      size: 'md',
      fullWidth: false,
    },
  },
)

const segmentedControlItemVariants = cva(
  cn(
    "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-sm text-muted-foreground transition-[background-color,color,box-shadow] outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
    focusRing,
  ),
  {
    variants: {
      size: {
        sm: 'h-5 px-2 text-xs gap-1 [&_svg:not([class*="size-"])]:size-3',
        md: 'h-6 px-2.5 text-sm gap-1.5 [&_svg:not([class*="size-"])]:size-3.5',
        lg: 'h-7 px-3 text-sm gap-2 [&_svg:not([class*="size-"])]:size-4',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
)

type SegmentedControlRootProps = Omit<SingleToggleGroupProps, 'type'> &
  VariantProps<typeof segmentedControlRootVariants>

function SegmentedControlRoot({
  className,
  size,
  fullWidth,
  children,
  ...props
}: SegmentedControlRootProps) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="segmented-control"
      data-size={size}
      type="single"
      className={cn(segmentedControlRootVariants({ size, fullWidth }), className)}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Root>
  )
}

type SegmentedControlItemProps = React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof segmentedControlItemVariants>

const SegmentedControlItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  SegmentedControlItemProps
>(({ className, size, ...props }, ref) => (
  <ToggleGroupPrimitive.Item
    ref={ref}
    data-slot="segmented-control-item"
    data-size={size}
    className={cn(
      segmentedControlItemVariants({ size }),
      // Hover brightens the icon only; the recessed track already
      // signals interactivity, so a hover bg change is redundant
      // visual noise.
      'hover:text-foreground',
      // Selected state. See the file header for why
      // `[aria-checked=true]:` instead of `data-[state=on]:` —
      // short version: Radix TooltipTrigger (with asChild)
      // overrides data-state, but leaves aria-checked alone.
      // 'bg-selected' / 'text-selected-foreground' / 'shadow-xs'
      // match the dropdown menu's selected item treatment for
      // visual coherence.
      '[aria-checked=true]:bg-selected [aria-checked=true]:text-selected-foreground [aria-checked=true]:shadow-xs',
      className,
    )}
    {...props}
  />
))
SegmentedControlItem.displayName = 'SegmentedControl.Item'

const SegmentedControl = { Root: SegmentedControlRoot, Item: SegmentedControlItem }

export { SegmentedControl, segmentedControlRootVariants, segmentedControlItemVariants }