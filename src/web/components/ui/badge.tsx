import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import { cn } from '#/web/lib/cn.ts'
import { focusRingVisibleInset } from '#/web/components/ui/focus.ts'
import { STATUS_TONE_CHIP_CLASS } from '#/web/components/ui/status-tones.ts'

// Calibrated for the desktop tool's chip density: small caps on
// inline list rows, not pill-shaped contact-list avatars. Square
// corners (rounded-sm) and a tighter type scale (text-[10px]) match
// the rest of the inline UI furniture (status codes, two-letter
// X/Y codes from `git status`, commit shortHash).
const badgeVariants = cva(
  cn(
    'inline-flex w-fit shrink-0 items-center justify-center overflow-hidden rounded-sm border border-transparent font-medium leading-tight whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring aria-invalid:border-danger-border aria-invalid:ring-danger/20 dark:aria-invalid:ring-danger/40 [&>svg]:pointer-events-none',
    focusRingVisibleInset,
  ),
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
        destructive: STATUS_TONE_CHIP_CLASS.danger,
        outline: 'border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        ghost: '[a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 [a&]:hover:underline',
        // Project extensions — shadcn has no warning/success/brand
        // slot. Same translucent-tint treatment as destructive above
        // so the semantic chips read as one family.
        success: STATUS_TONE_CHIP_CLASS.success,
        attention: STATUS_TONE_CHIP_CLASS.attention,
        warning: STATUS_TONE_CHIP_CLASS.warning,
        danger: STATUS_TONE_CHIP_CLASS.danger,
        brand: STATUS_TONE_CHIP_CLASS.brand,
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
