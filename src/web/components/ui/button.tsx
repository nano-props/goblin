import { cva, type VariantProps } from 'class-variance-authority'
import { Primitive } from 'reka-ui'
import type { ButtonHTMLAttributes, FunctionalComponent } from 'vue'
import { cn } from '#/web/lib/cn.ts'
import { dataActiveRing, focusRing } from '#/web/components/ui/focus.ts'
const buttonVariants = cva(
  cn(
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-xs font-medium whitespace-nowrap transition-colors duration-100 cursor-pointer outline-none disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-danger-border aria-invalid:ring-danger/20 dark:aria-invalid:ring-danger/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
    focusRing,
    dataActiveRing,
  ),
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-control shadow-xs hover:bg-control-hover hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary underline-offset-4 hover:underline',
        'destructive-soft':
          'border bg-danger-surface text-danger shadow-xs hover:bg-danger-surface hover:text-danger border-danger-border',
      },
      size: {
        default: 'h-7 px-2.5 gap-1.5 has-[>svg]:px-2',
        sm: "h-6 gap-1 px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        'icon-xs': "size-5 [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-6',
        icon: 'size-7',
        'icon-lg': 'size-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

type ButtonVariantProps = VariantProps<typeof buttonVariants>

interface ButtonProps extends ButtonHTMLAttributes {
  asChild?: boolean
  variant?: ButtonVariantProps['variant']
  size?: ButtonVariantProps['size']
}

const Button: FunctionalComponent<ButtonProps> = (props, { attrs, slots }) => {
  const variant = props.variant ?? 'default'
  const size = props.size ?? 'default'
  const { class: classValue, ...buttonAttrs } = attrs as ButtonHTMLAttributes
  return (
    <Primitive
      {...buttonAttrs}
      as="button"
      asChild={props.asChild}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      class={cn(buttonVariants({ variant, size }), classValue)}
    >
      {slots.default?.()}
    </Primitive>
  )
}

Button.props = ['asChild', 'variant', 'size']
Button.inheritAttrs = false

export { Button, buttonVariants }
export type { ButtonProps }
