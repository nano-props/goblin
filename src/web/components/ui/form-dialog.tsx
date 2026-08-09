import { DialogDescription, DialogRoot, DialogTitle } from 'reka-ui'
import { defineComponent } from 'vue'
import type { VNodeChild } from 'vue'
import { DialogContent, DialogHeader, type DialogContentProps } from '#/web/components/ui/dialog.tsx'

type FormDialogProps = Omit<DialogContentProps, 'title'> & {
  open: boolean
  onOpenChange?: (open: boolean) => void
  title: VNodeChild
  description?: VNodeChild
}

export const FormDialog = defineComponent<FormDialogProps>({
  name: 'FormDialog',
  inheritAttrs: false,
  props: ['open', 'onOpenChange', 'title', 'description'],

  setup(props, { attrs, slots }) {
    return () => (
      <DialogRoot open={props.open} onUpdate:open={props.onOpenChange}>
        <DialogContent {...attrs}>
          <DialogHeader>
            <DialogTitle class="text-sm leading-tight font-semibold">{props.title}</DialogTitle>
            {props.description ? (
              <DialogDescription class="text-sm text-muted-foreground">{props.description}</DialogDescription>
            ) : null}
          </DialogHeader>
          {slots.default?.()}
        </DialogContent>
      </DialogRoot>
    )
  },
})

export type { FormDialogProps }
