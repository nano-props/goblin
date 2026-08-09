import { Check, Copy, Loader2 } from '@lucide/vue'
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { Button } from '#/web/components/ui/button.tsx'
import { Tip } from '#/web/components/Tip.tsx'
import { cn } from '#/web/lib/cn.ts'

export const IconCopyButton = defineComponent<{
  label: string
  succeeded: boolean
  busy?: boolean
  disabled?: boolean
  side?: 'top' | 'right' | 'bottom' | 'left'
  class?: string
  onClick: () => void
}>({
  name: 'IconCopyButton',
  props: {
    label: { type: String, required: true },
    succeeded: { type: Boolean, required: true },
    busy: Boolean,
    disabled: Boolean,
    side: String as PropType<'top' | 'right' | 'bottom' | 'left'>,
    class: String,
    onClick: { type: Function as PropType<() => void>, required: true },
  },

  setup(props) {
    return () => (
      <Tip label={props.label} side={props.side ?? 'right'} forceOpen={props.succeeded}>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={props.disabled}
          aria-busy={props.busy || undefined}
          aria-label={props.label}
          onClick={props.onClick}
          class={cn('text-muted-foreground hover:text-foreground', props.class)}
        >
          {props.busy ? (
            <Loader2 size={12} class="animate-spin" />
          ) : props.succeeded ? (
            <Check size={12} />
          ) : (
            <Copy size={12} />
          )}
        </Button>
      </Tip>
    )
  },
})
