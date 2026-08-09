import { CheckIcon } from '@lucide/vue'
import { CheckboxIndicator, CheckboxRoot } from 'reka-ui'
import type { CheckboxRootProps } from 'reka-ui'
import type { FunctionalComponent, HTMLAttributes } from 'vue'
import { cn } from '#/web/lib/cn.ts'
import { focusRingVisibleInset } from '#/web/components/ui/focus.ts'

type CheckboxProps = Omit<CheckboxRootProps<boolean>, 'class'> &
  HTMLAttributes & {
    variant?: 'default' | 'destructive'
    'onUpdate:modelValue'?: (value: boolean | 'indeterminate') => void
  }

export const Checkbox: FunctionalComponent<CheckboxProps> = (props) => {
  const { class: classValue, variant = 'default', ...rootProps } = props
  return (
    <CheckboxRoot
      {...rootProps}
      data-slot="checkbox"
      data-variant={variant}
      class={cn(
        'peer size-4 shrink-0 rounded-sm border border-input bg-control shadow-xs transition-[color,background-color,border-color,box-shadow] duration-100 outline-none focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger-border aria-invalid:ring-danger/20 dark:aria-invalid:ring-danger/40',
        focusRingVisibleInset,
        variant === 'destructive'
          ? 'data-[state=checked]:border-destructive data-[state=checked]:bg-destructive data-[state=checked]:text-destructive-foreground'
          : 'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
        classValue,
      )}
    >
      <CheckboxIndicator data-slot="checkbox-indicator" class="flex items-center justify-center">
        <CheckIcon class="size-3" />
      </CheckboxIndicator>
    </CheckboxRoot>
  )
}
Checkbox.inheritAttrs = false
