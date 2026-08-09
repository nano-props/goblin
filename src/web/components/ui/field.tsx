import type { FunctionalComponent, HTMLAttributes, LabelHTMLAttributes } from 'vue'
import { cn } from '#/web/lib/cn.ts'

export const Field: FunctionalComponent<HTMLAttributes> = (props, { slots }) => {
  const { class: classValue, ...elementProps } = props
  return (
    <div {...elementProps} data-slot="field" class={cn('grid gap-1', classValue)}>
      {slots.default?.()}
    </div>
  )
}
Field.inheritAttrs = false

export const FieldLabel: FunctionalComponent<LabelHTMLAttributes> = (props, { slots }) => {
  const { class: classValue, ...labelProps } = props
  return (
    <label {...labelProps} data-slot="field-label" class={cn('text-sm font-medium text-foreground', classValue)}>
      {slots.default?.()}
    </label>
  )
}
FieldLabel.inheritAttrs = false

type FieldTextProps = HTMLAttributes & {
  reserveHeight?: boolean
}

export const FieldDescription: FunctionalComponent<FieldTextProps> = (props, { slots }) => {
  const { class: classValue, reserveHeight = false, ...elementProps } = props
  return (
    <div
      {...elementProps}
      data-slot="field-description"
      class={cn(reserveHeight && 'min-h-4', 'text-xs leading-4 text-muted-foreground', classValue)}
    >
      {slots.default?.()}
    </div>
  )
}
FieldDescription.inheritAttrs = false

export const FieldError: FunctionalComponent<FieldTextProps> = (props, { slots }) => {
  const { class: classValue, reserveHeight = false, ...elementProps } = props
  return (
    <div
      {...elementProps}
      data-slot="field-error"
      class={cn(reserveHeight && 'min-h-4', 'text-xs leading-4 text-danger', classValue)}
    >
      {slots.default?.()}
    </div>
  )
}
FieldError.inheritAttrs = false
