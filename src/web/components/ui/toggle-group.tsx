import { cva, type VariantProps } from 'class-variance-authority'
import { ToggleGroupItem as RekaToggleGroupItem, ToggleGroupRoot } from 'reka-ui'
import type { AcceptableValue, ToggleGroupItemProps as RekaToggleGroupItemProps, ToggleGroupRootProps } from 'reka-ui'
import { computed, defineComponent, inject, provide } from 'vue'
import type { ComputedRef, CSSProperties, HTMLAttributes, InjectionKey } from 'vue'
import { cn } from '#/web/lib/cn.ts'
import { focusRing } from '#/web/components/ui/focus.ts'

export const toggleVariants = cva(
  cn(
    "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-[color,box-shadow] outline-none hover:bg-muted hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-danger-border aria-invalid:ring-danger/20 data-[state=on]:bg-selected data-[state=on]:text-selected-foreground dark:aria-invalid:ring-danger/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    focusRing,
  ),
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline: 'border border-input bg-control shadow-xs hover:bg-control-hover hover:text-accent-foreground',
      },
      size: {
        default: 'h-9 min-w-9 px-2',
        sm: 'h-8 min-w-8 px-1.5',
        'icon-sm': "size-6 px-0 gap-0 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-10 min-w-10 px-2.5',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

type ToggleVariantProps = VariantProps<typeof toggleVariants>

interface ToggleGroupContextValue {
  variant: ComputedRef<ToggleVariantProps['variant']>
  size: ComputedRef<ToggleVariantProps['size']>
  spacing: ComputedRef<number>
}

const toggleGroupKey: InjectionKey<ToggleGroupContextValue> = Symbol('toggle-group')

type ToggleGroupProps = Omit<ToggleGroupRootProps, 'class' | 'modelValue'> &
  HTMLAttributes &
  ToggleVariantProps & {
    modelValue?: AcceptableValue | AcceptableValue[]
    spacing?: number
    'onUpdate:modelValue'?: (value: AcceptableValue | AcceptableValue[]) => void
  }

export const ToggleGroup = defineComponent<ToggleGroupProps>({
  name: 'ToggleGroup',
  inheritAttrs: false,
  props: [
    'as',
    'asChild',
    'type',
    'modelValue',
    'defaultValue',
    'rovingFocus',
    'disabled',
    'orientation',
    'dir',
    'loop',
    'name',
    'required',
    'variant',
    'size',
    'spacing',
    'onUpdate:modelValue',
  ],

  setup(props, { attrs, slots }) {
    const variant = computed(() => props.variant ?? 'default')
    const size = computed(() => props.size ?? 'default')
    const spacing = computed(() => props.spacing ?? 0)
    provide(toggleGroupKey, { variant, size, spacing })

    return () => {
      const { class: classValue, style: styleValue, ...rootAttrs } = attrs as HTMLAttributes
      return (
        <ToggleGroupRoot
          {...rootAttrs}
          as={props.as}
          asChild={props.asChild}
          type={props.type}
          modelValue={props.modelValue}
          defaultValue={props.defaultValue}
          rovingFocus={props.rovingFocus}
          disabled={props.disabled}
          orientation={props.orientation}
          dir={props.dir}
          loop={props.loop}
          name={props.name}
          required={props.required}
          onUpdate:modelValue={props['onUpdate:modelValue']}
          data-slot="toggle-group"
          data-variant={variant.value}
          data-size={size.value}
          data-spacing={spacing.value}
          style={[{ '--gap': spacing.value } as CSSProperties, styleValue]}
          class={cn(
            'group/toggle-group flex w-fit items-center gap-[--spacing(var(--gap))] rounded-md data-[spacing=default]:data-[variant=outline]:shadow-xs',
            classValue,
          )}
        >
          {slots.default?.()}
        </ToggleGroupRoot>
      )
    }
  },
})

type ToggleGroupItemProps = Omit<RekaToggleGroupItemProps, 'class'> & HTMLAttributes & ToggleVariantProps

export const ToggleGroupItem = defineComponent<ToggleGroupItemProps>({
  name: 'ToggleGroupItem',
  inheritAttrs: false,
  props: ['as', 'asChild', 'value', 'disabled', 'variant', 'size'],

  setup(props, { attrs, slots }) {
    const context = inject(toggleGroupKey, null)

    return () => {
      const variant = context?.variant.value ?? props.variant ?? 'default'
      const size = context?.size.value ?? props.size ?? 'default'
      const spacing = context?.spacing.value ?? 0
      const { class: classValue, ...itemAttrs } = attrs as HTMLAttributes

      return (
        <RekaToggleGroupItem
          {...itemAttrs}
          as={props.as}
          asChild={props.asChild}
          value={props.value}
          disabled={props.disabled}
          data-slot="toggle-group-item"
          data-variant={variant}
          data-size={size}
          data-spacing={spacing}
          class={cn(
            toggleVariants({ variant, size }),
            'min-w-0 shrink-0 focus:z-10 focus-visible:z-10',
            'data-[size=default]:w-auto data-[size=sm]:w-auto data-[size=lg]:w-auto',
            'data-[spacing=0]:rounded-none data-[spacing=0]:shadow-none data-[spacing=0]:first:rounded-l-md data-[spacing=0]:last:rounded-r-md data-[spacing=0]:data-[variant=outline]:border-l-0 data-[spacing=0]:data-[variant=outline]:first:border-l',
            classValue,
          )}
        >
          {slots.default?.()}
        </RekaToggleGroupItem>
      )
    }
  },
})
