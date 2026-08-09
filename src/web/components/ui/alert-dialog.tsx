import {
  AlertDialogCancel as RekaAlertDialogCancel,
  AlertDialogContent as RekaAlertDialogContent,
  AlertDialogDescription as RekaAlertDialogDescription,
  AlertDialogOverlay as RekaAlertDialogOverlay,
  AlertDialogPortal as RekaAlertDialogPortal,
  AlertDialogTitle as RekaAlertDialogTitle,
} from 'reka-ui'
import { defineComponent } from 'vue'
import type { ButtonHTMLAttributes, FunctionalComponent, HTMLAttributes } from 'vue'
import { cn } from '#/web/lib/cn.ts'
import { Button } from '#/web/components/ui/button.tsx'
import type { ButtonProps } from '#/web/components/ui/button.tsx'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'

type AlertDialogOverlayProps = Omit<InstanceType<typeof RekaAlertDialogOverlay>['$props'], 'class'> & {
  class?: HTMLAttributes['class']
}

const AlertDialogOverlay: FunctionalComponent<AlertDialogOverlayProps> = (props, { slots }) => {
  const { class: classValue, ...overlayProps } = props
  return (
    <RekaAlertDialogOverlay
      {...overlayProps}
      data-slot="alert-dialog-overlay"
      class={cn(
        'fixed inset-0 z-50 bg-[var(--color-overlay-scrim)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
        classValue,
      )}
    >
      {slots.default?.()}
    </RekaAlertDialogOverlay>
  )
}
AlertDialogOverlay.inheritAttrs = false

type AlertDialogContentProps = Omit<InstanceType<typeof RekaAlertDialogContent>['$props'], 'class' | 'size'> & {
  class?: HTMLAttributes['class']
  size?: 'default' | 'sm'
}

export const AlertDialogContent: FunctionalComponent<AlertDialogContentProps> = (props, { slots }) => {
  const { class: classValue, size = 'default', ...contentProps } = props
  return (
    <RekaAlertDialogPortal>
      <AlertDialogOverlay />
      <RekaAlertDialogContent
        {...contentProps}
        data-slot="alert-dialog-content"
        data-size={size}
        class={cn(
          'group/alert-dialog-content fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-3 rounded-lg border bg-card p-4 text-left shadow-lg duration-200 data-[size=sm]:max-w-xs data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[size=default]:sm:max-w-lg',
          classValue,
        )}
      >
        {slots.default?.()}
      </RekaAlertDialogContent>
    </RekaAlertDialogPortal>
  )
}
AlertDialogContent.inheritAttrs = false

export const AlertDialogHeader: FunctionalComponent<HTMLAttributes> = (props, { slots }) => {
  const { class: classValue, ...elementProps } = props
  return (
    <div
      {...elementProps}
      data-slot="alert-dialog-header"
      class={cn(
        'grid grid-rows-[auto_1fr] place-items-start gap-1.5 text-left has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] has-data-[slot=alert-dialog-media]:gap-x-6 sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-left sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]',
        classValue,
      )}
    >
      {slots.default?.()}
    </div>
  )
}
AlertDialogHeader.inheritAttrs = false

export const AlertDialogFooter = defineComponent<HTMLAttributes>({
  name: 'AlertDialogFooter',
  inheritAttrs: false,

  setup(_props, { attrs, slots }) {
    const compact = useIsCompactUi()
    return () => {
      const { class: classValue, ...elementAttrs } = attrs as HTMLAttributes
      return (
        <div
          {...elementAttrs}
          data-slot="alert-dialog-footer"
          class={cn(
            compact.value
              ? 'flex flex-col-reverse gap-2 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2'
              : 'flex flex-row justify-end gap-2',
            classValue,
          )}
        >
          {slots.default?.()}
        </div>
      )
    }
  },
})

type AlertDialogTitleProps = Omit<InstanceType<typeof RekaAlertDialogTitle>['$props'], 'class'> & {
  class?: HTMLAttributes['class']
}

export const AlertDialogTitle: FunctionalComponent<AlertDialogTitleProps> = (props, { slots }) => {
  const { class: classValue, ...titleProps } = props
  return (
    <RekaAlertDialogTitle
      {...titleProps}
      data-slot="alert-dialog-title"
      class={cn(
        'text-sm leading-tight font-semibold sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2',
        classValue,
      )}
    >
      {slots.default?.()}
    </RekaAlertDialogTitle>
  )
}
AlertDialogTitle.inheritAttrs = false

type AlertDialogDescriptionProps = Omit<InstanceType<typeof RekaAlertDialogDescription>['$props'], 'class'> & {
  class?: HTMLAttributes['class']
}

export const AlertDialogDescription: FunctionalComponent<AlertDialogDescriptionProps> = (props, { slots }) => {
  const { class: classValue, ...descriptionProps } = props
  return (
    <RekaAlertDialogDescription
      {...descriptionProps}
      data-slot="alert-dialog-description"
      class={cn('text-sm text-muted-foreground', classValue)}
    >
      {slots.default?.()}
    </RekaAlertDialogDescription>
  )
}
AlertDialogDescription.inheritAttrs = false

type AlertDialogCancelProps = Omit<InstanceType<typeof RekaAlertDialogCancel>['$props'], 'class'> &
  ButtonHTMLAttributes &
  Pick<ButtonProps, 'variant' | 'size'>

export const AlertDialogCancel: FunctionalComponent<AlertDialogCancelProps> = (props, { slots }) => {
  const { class: classValue, size = 'sm', variant = 'outline', ...cancelProps } = props
  return (
    <Button variant={variant} size={size} asChild>
      <RekaAlertDialogCancel {...cancelProps} data-slot="alert-dialog-cancel" class={cn(classValue)}>
        {slots.default?.()}
      </RekaAlertDialogCancel>
    </Button>
  )
}
AlertDialogCancel.inheritAttrs = false

export type { AlertDialogCancelProps, AlertDialogContentProps, AlertDialogDescriptionProps, AlertDialogTitleProps }
