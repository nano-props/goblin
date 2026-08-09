import { Loader2 } from '@lucide/vue'
import { AlertDialogRoot } from 'reka-ui'
import { defineComponent } from 'vue'
import type { PropType, VNodeChild } from 'vue'
import {
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/web/components/ui/alert-dialog.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { useT } from '#/web/stores/i18n-vue.ts'
import { useAsyncPending } from '#/web/hooks/useAsyncPending.ts'

export const ConfirmDialog = defineComponent<{
  open: boolean
  title: string
  message: VNodeChild
  confirmLabel: string
  destructive?: boolean
  onCancel: () => void
  onConfirm: () => void | Promise<unknown>
}>({
  name: 'ConfirmDialog',
  props: {
    open: { type: Boolean, required: true },
    title: { type: String, required: true },
    message: null,
    confirmLabel: { type: String, required: true },
    destructive: Boolean,
    onCancel: { type: Function as PropType<() => void>, required: true },
    onConfirm: { type: Function as PropType<() => void | Promise<unknown>>, required: true },
  },

  setup(props) {
    const t = useT()
    const pendingState = useAsyncPending<'confirm'>()

    return () => {
      const pending = pendingState.isPending.value
      return (
        <AlertDialogRoot
          open={props.open}
          onUpdate:open={(open) => {
            if (!open && !pending) props.onCancel()
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{props.title}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div class="text-sm leading-relaxed text-muted-foreground">{props.message}</div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>{t('dialog.cancel')}</AlertDialogCancel>
              <Button
                size="sm"
                variant={props.destructive ? 'destructive' : 'default'}
                disabled={pending}
                aria-busy={pending || undefined}
                onClick={() => {
                  void pendingState.run('confirm', props.onConfirm)
                }}
              >
                {pending ? <Loader2 aria-hidden="true" class="animate-spin" /> : null}
                {props.confirmLabel}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogRoot>
      )
    }
  },
})
