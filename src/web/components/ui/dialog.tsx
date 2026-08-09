import { XIcon } from '@lucide/vue'
import {
  DialogClose as RekaDialogClose,
  DialogContent as RekaDialogContent,
  DialogOverlay as RekaDialogOverlay,
  DialogPortal as RekaDialogPortal,
} from 'reka-ui'
import { defineComponent } from 'vue'
import type { FunctionalComponent, HTMLAttributes } from 'vue'
import { cn } from '#/web/lib/cn.ts'
import { focusRingInset } from '#/web/components/ui/focus.ts'
import { Button } from '#/web/components/ui/button.tsx'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { useT } from '#/web/stores/i18n-vue.ts'

type DialogOverlayProps = Omit<InstanceType<typeof RekaDialogOverlay>['$props'], 'class'> & {
  class?: HTMLAttributes['class']
}

const DialogOverlay: FunctionalComponent<DialogOverlayProps> = (props, { slots }) => {
  const { class: classValue, ...overlayProps } = props
  return (
    <RekaDialogOverlay
      {...overlayProps}
      data-slot="dialog-overlay"
      class={cn(
        'fixed inset-0 z-50 bg-[var(--color-overlay-scrim)] [-webkit-app-region:no-drag] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
        classValue,
      )}
    >
      {slots.default?.()}
    </RekaDialogOverlay>
  )
}
DialogOverlay.inheritAttrs = false

type DialogContentProps = Omit<InstanceType<typeof RekaDialogContent>['$props'], 'class'> & {
  class?: HTMLAttributes['class']
  showCloseButton?: boolean
}

export const DialogContent = defineComponent<DialogContentProps>({
  name: 'DialogContent',
  inheritAttrs: false,
  props: ['showCloseButton'],

  setup(props, { attrs, slots }) {
    return () => {
      const { class: classValue, ...contentAttrs } = attrs as HTMLAttributes
      return (
        <RekaDialogPortal>
          <DialogOverlay />
          <RekaDialogContent
            {...contentAttrs}
            data-slot="dialog-content"
            class={cn(
              'fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-3 rounded-lg border bg-card p-4 text-left shadow-lg [-webkit-app-region:no-drag] duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg',
              classValue,
            )}
          >
            {slots.default?.()}
            {props.showCloseButton !== false ? (
              <RekaDialogClose
                data-slot="dialog-close"
                class={cn(
                  "absolute top-3 right-3 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
                  focusRingInset,
                )}
              >
                <XIcon />
                <span class="sr-only">Close</span>
              </RekaDialogClose>
            ) : null}
          </RekaDialogContent>
        </RekaDialogPortal>
      )
    }
  },
})

export const DialogHeader: FunctionalComponent<HTMLAttributes> = (props, { slots }) => {
  const { class: classValue, ...elementProps } = props
  return (
    <div {...elementProps} data-slot="dialog-header" class={cn('flex flex-col gap-2 text-left', classValue)}>
      {slots.default?.()}
    </div>
  )
}
DialogHeader.inheritAttrs = false

type DialogFooterProps = HTMLAttributes & {
  showCloseButton?: boolean
}

export const DialogFooter = defineComponent<DialogFooterProps>({
  name: 'DialogFooter',
  inheritAttrs: false,
  props: ['showCloseButton'],

  setup(props, { attrs, slots }) {
    const compact = useIsCompactUi()
    const t = useT()

    return () => {
      const { class: classValue, ...elementAttrs } = attrs as HTMLAttributes
      return (
        <div
          {...elementAttrs}
          data-slot="dialog-footer"
          class={cn(compact.value ? 'flex flex-col-reverse gap-2' : 'flex flex-row justify-end gap-2', classValue)}
        >
          {slots.default?.()}
          {props.showCloseButton ? (
            <RekaDialogClose asChild>
              <Button variant="outline">{t('dialog.close')}</Button>
            </RekaDialogClose>
          ) : null}
        </div>
      )
    }
  },
})

export type { DialogContentProps, DialogFooterProps }
