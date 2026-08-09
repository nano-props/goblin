import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { Button } from '#/web/components/ui/button.tsx'
import type { ButtonProps } from '#/web/components/ui/button.tsx'
import { useAsyncPending } from '#/web/hooks/useAsyncPending.ts'

interface AsyncButtonState {
  pending: boolean
  busy: boolean
}

type AsyncButtonProps = Omit<ButtonProps, 'onClick'> & {
  loading?: boolean
  action?: (event: MouseEvent) => void | Promise<unknown>
}

export const AsyncButton = defineComponent<AsyncButtonProps>({
  name: 'AsyncButton',
  inheritAttrs: false,
  props: {
    loading: Boolean,
    disabled: Boolean,
    action: Function as PropType<(event: MouseEvent) => void | Promise<unknown>>,
  },

  setup(props, { attrs, slots }) {
    const pendingState = useAsyncPending<'click'>()

    function handleClick(event: MouseEvent): void {
      void pendingState.run('click', () => props.action?.(event))
    }

    return () => {
      const pending = pendingState.isPending.value
      const busy = pending || !!props.loading
      const slotState: AsyncButtonState = { pending, busy }
      return (
        <Button {...attrs} disabled={props.disabled || pending} aria-busy={busy || undefined} onClick={handleClick}>
          {slots.default?.(slotState)}
        </Button>
      )
    }
  },
})
