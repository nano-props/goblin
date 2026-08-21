import { cva, type VariantProps } from 'class-variance-authority'
import { Primitive } from 'reka-ui'
import type { FunctionalComponent, HTMLAttributes } from 'vue'
import { cn } from '#/web/lib/cn.ts'
import { focusRingVisibleInset } from '#/web/components/ui/focus.ts'
import { STATUS_TONE_CHIP_CLASS } from '#/web/components/ui/status-tones.ts'

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
        destructive: STATUS_TONE_CHIP_CLASS.danger,
        outline: 'border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        ghost: '[a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 [a&]:hover:underline',
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

type BadgeVariantProps = VariantProps<typeof badgeVariants>

interface BadgeProps extends HTMLAttributes {
  asChild?: boolean
  variant?: BadgeVariantProps['variant']
  size?: BadgeVariantProps['size']
}

const Badge: FunctionalComponent<BadgeProps> = (props, { attrs, slots }) => {
  const variant = props.variant ?? 'default'
  const size = props.size ?? 'xs'
  const { class: classValue, ...badgeAttrs } = attrs as HTMLAttributes
  return (
    <Primitive
      {...badgeAttrs}
      as="span"
      asChild={props.asChild}
      data-slot="badge"
      data-variant={variant}
      class={cn(badgeVariants({ variant, size }), classValue)}
    >
      {slots.default?.()}
    </Primitive>
  )
}

Badge.props = ['asChild', 'variant', 'size']
Badge.inheritAttrs = false

export { Badge, badgeVariants }
export type { BadgeProps }
