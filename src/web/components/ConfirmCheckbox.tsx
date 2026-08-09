import { defineComponent, useId } from 'vue'
import type { PropType } from 'vue'
import { Checkbox } from '#/web/components/ui/checkbox.tsx'
import { cn } from '#/web/lib/cn.ts'

export const ConfirmCheckbox = defineComponent<{
  checked: boolean
  describedBy?: string
  destructive?: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
  title?: string
}>({
  name: 'ConfirmCheckbox',
  props: {
    checked: { type: Boolean, required: true },
    describedBy: String,
    destructive: Boolean,
    disabled: Boolean,
    onCheckedChange: { type: Function as PropType<(checked: boolean) => void>, required: true },
    title: String,
  },

  setup(props, { slots }) {
    const id = useId()
    return () => (
      <div
        class={cn(
          'flex items-center gap-2 select-none',
          props.disabled ? 'cursor-not-allowed text-muted-foreground' : 'text-foreground',
        )}
        title={props.title}
      >
        <Checkbox
          id={id}
          modelValue={props.checked}
          disabled={props.disabled}
          aria-describedby={props.describedBy}
          variant={props.destructive ? 'destructive' : 'default'}
          onUpdate:modelValue={(next) => props.onCheckedChange(next === true)}
        />
        <label for={id} class={props.disabled ? 'cursor-not-allowed' : 'cursor-pointer'}>
          {slots.default?.()}
        </label>
      </div>
    )
  },
})
