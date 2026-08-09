import { TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui'
import { defineComponent, ref } from 'vue'
import type { PropType, VNodeChild } from 'vue'
import { TooltipContent } from '#/web/components/ui/tooltip.tsx'

type TooltipSide = 'top' | 'right' | 'bottom' | 'left'
type TooltipAlign = 'start' | 'center' | 'end'

export const Tip = defineComponent<{
  label: VNodeChild
  side?: TooltipSide
  align?: TooltipAlign
  delayMs?: number
  collisionPadding?: number | Partial<Record<TooltipSide, number>>
  forceOpen?: boolean
}>({
  name: 'Tip',
  props: {
    label: null,
    side: String as PropType<TooltipSide>,
    align: String as PropType<TooltipAlign>,
    delayMs: Number,
    collisionPadding: [Number, Object] as PropType<number | Partial<Record<TooltipSide, number>>>,
    forceOpen: Boolean,
  },

  setup(props, { slots }) {
    const hoverOpen = ref(false)
    return () => (
      <TooltipProvider delayDuration={props.delayMs ?? 200}>
        <TooltipRoot
          open={!!props.forceOpen || hoverOpen.value}
          onUpdate:open={(open) => {
            hoverOpen.value = open
          }}
        >
          <TooltipTrigger asChild>{slots.default?.()}</TooltipTrigger>
          <TooltipContent
            side={props.side ?? 'bottom'}
            align={props.align ?? 'center'}
            sideOffset={6}
            collisionPadding={props.collisionPadding}
          >
            {props.label}
          </TooltipContent>
        </TooltipRoot>
      </TooltipProvider>
    )
  },
})
