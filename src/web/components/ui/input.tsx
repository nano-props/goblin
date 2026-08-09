import type { FunctionalComponent, InputHTMLAttributes } from 'vue'
import { cn } from '#/web/lib/cn.ts'
import { focusRingInset } from '#/web/components/ui/focus.ts'

type InputProps = InputHTMLAttributes

const Input: FunctionalComponent<InputProps> = (_props, { attrs }) => {
  const { class: classValue, ...inputAttrs } = attrs as InputHTMLAttributes
  return (
    <input
      {...inputAttrs}
      data-slot="input"
      class={cn(
        'h-9 w-full rounded-md border border-input bg-control px-3 py-2 text-sm focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger-border aria-invalid:ring-danger/20 dark:aria-invalid:ring-danger/40',
        focusRingInset,
        classValue,
      )}
    />
  )
}

Input.inheritAttrs = false

export { Input }
export type { InputProps }
