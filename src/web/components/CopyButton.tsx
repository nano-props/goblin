import { defineComponent, ref, watch } from 'vue'
import type { PropType } from 'vue'
import { toast } from 'vue-sonner'
import { useT } from '#/web/stores/i18n-vue.ts'
import { IconCopyButton } from '#/web/components/IconCopyButton.tsx'
import { useActionFeedback } from '#/web/hooks/useActionFeedback.ts'
import { copyToClipboard } from '#/web/clipboard/clipboard-copy.ts'

export const CopyButton = defineComponent<{
  value: string
  copyLabel: string
  copiedLabel: string
  class?: string
  disabled?: boolean
  side?: 'top' | 'right' | 'bottom' | 'left'
}>({
  name: 'CopyButton',
  props: {
    value: { type: String, required: true },
    copyLabel: { type: String, required: true },
    copiedLabel: { type: String, required: true },
    class: String,
    disabled: Boolean,
    side: String as PropType<'top' | 'right' | 'bottom' | 'left'>,
  },

  setup(props) {
    const feedback = useActionFeedback()
    const copying = ref(false)
    const t = useT()
    let requestId = 0

    // A changed value invalidates the previous clipboard request and its
    // transient success projection; the underlying browser write is not
    // cancellable once admitted.
    watch(
      () => props.value,
      () => {
        requestId += 1
        copying.value = false
        feedback.reset()
      },
    )

    function copy(): void {
      if (copying.value) return
      requestId += 1
      const activeRequestId = requestId
      const copiedValue = props.value
      copying.value = true

      void copyToClipboard(copiedValue)
        .then(() => {
          if (requestId !== activeRequestId || props.value !== copiedValue) return
          feedback.trigger(() => true)
        })
        .catch((error: unknown) => {
          if (requestId !== activeRequestId || props.value !== copiedValue) return
          toast.error(t('action.result-error'), {
            description: error instanceof Error ? error.message : String(error),
          })
        })
        .finally(() => {
          if (requestId === activeRequestId) copying.value = false
        })
    }

    return () => (
      <IconCopyButton
        class={props.class}
        label={feedback.succeeded.value ? props.copiedLabel : props.copyLabel}
        succeeded={feedback.succeeded.value}
        busy={copying.value}
        disabled={props.disabled || copying.value}
        side={props.side}
        onClick={copy}
      />
    )
  },
})
