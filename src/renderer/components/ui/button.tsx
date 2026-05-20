import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '#/renderer/lib/cn.ts'

const buttonVariants = cva(
  // Base text size collapsed to text-xs to match the desktop tool's
  // density (upstream shadcn defaults to text-sm = 14px). lg bumps
  // back up to text-sm. duration-100 over the upstream default ~150ms
  // gives a snappier hover response that suits a frequently-clicked
  // tool — taken from the deck-app reference.
  // cursor-pointer overrides Tailwind v4's preflight (which sets
  // `cursor: default` on buttons). Desktop-tool feel — the user expects
  // a hand cursor on every clickable Button.
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-xs font-medium whitespace-nowrap transition-colors duration-100 cursor-pointer outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40',
        outline:
          'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary underline-offset-4 hover:underline',
        // Project extension: tinted-outline armed-confirm state. Used
        // by destructive confirmation flows — keeps the outline shape so the motion from
        // "neutral outline" → "armed" stays small while flagging that
        // the next click commits.
        'destructive-soft':
          'border bg-danger-surface text-destructive shadow-xs hover:bg-danger-surface hover:text-destructive border-danger-border',
      },
      // Sizes calibrated for desktop-tool information density (VS Code
      // / Tower / Sourcetree). Two steps smaller than upstream shadcn,
      // which targets web app comfort at 16px+ row heights. h-7 is the
      // workhorse default; h-6 covers tighter inline rows.
      //
      // Only the sizes the app actually uses are kept. If `shadcn add`
      // pulls in a new component that wants xs/lg/icon-xs/icon-sm/
      // icon-lg, add it back at that point — declaring sizes nobody
      // calls hides the small range we actually care about.
      size: {
        // base sets text-xs + svg size-3.5 + gap-2; sizes only override
        // gap / padding / height to keep the variant table readable.
        default: 'h-7 px-2.5 gap-1.5 has-[>svg]:px-2',
        sm: "h-6 gap-1 px-2 text-[11px] has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        icon: 'size-7',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
