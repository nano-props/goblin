import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '#/renderer/lib/cn.ts'

// Calibrated for the desktop tool's chip density: small caps on
// inline list rows, not pill-shaped contact-list avatars. Square
// corners (rounded-sm) and a tighter type scale (text-[10px]) match
// the rest of the inline UI furniture (status codes, two-letter
// X/Y codes from `git status`, commit shortHash).
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center overflow-hidden rounded-sm border border-transparent font-medium leading-tight whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90',
        // We override upstream shadcn's `destructive` (solid red fill)
        // with a translucent tint that matches success/warning/brand
        // below. Status chips ("conflict", "deleted") read in dense
        // lists, where a saturated fill reads as a screaming pill —
        // the tint conveys the same semantic at the right intensity.
        destructive: 'border-transparent bg-danger-surface text-destructive',
        outline: 'border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        ghost: '[a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 [a&]:hover:underline',
        // Project extensions — shadcn has no warning/success/brand
        // slot. Same translucent-tint treatment as destructive above
        // so the four semantic chips read as one family.
        success: 'border-transparent bg-success-surface text-success',
        warning: 'border-transparent bg-warning-surface text-warning',
        brand: 'border-transparent bg-brand-surface text-brand-text',
      },
      size: {
        xs: 'px-1.5 py-0 text-[10px] [&>svg]:size-3',
        sm: 'px-1.5 py-0.5 text-xs [&>svg]:size-3.5',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'xs',
    },
  },
)

function Badge({
  className,
  variant = 'default',
  size = 'xs',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span'

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  )
}

// Re-export the variant union as a named type so call sites that
// compute the variant dynamically (e.g. status code → variant) can
// be type-checked.
export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>

export { Badge, badgeVariants }
