import {
  PopoverContent as RekaPopoverContent,
  PopoverPortal as RekaPopoverPortal,
  PopoverRoot as RekaPopoverRoot,
} from 'reka-ui'
import { computed, defineComponent, ref } from 'vue'
import type { FunctionalComponent, HTMLAttributes } from 'vue'
import { floatingContentClass } from '#/web/components/ui/floating-content.tsx'
import {
  floatingSurfaceBoundaryIsActive,
  useFloatingSurfaceBoundaryPin,
} from '#/web/components/ui/floating-surface-boundary.tsx'

type RekaPopoverRootProps = InstanceType<typeof RekaPopoverRoot>['$props']
type PopoverProps = Omit<RekaPopoverRootProps, 'onUpdate:open'> & {
  onOpenChange?: (open: boolean) => void
}

export const Popover = defineComponent<PopoverProps>({
  name: 'Popover',
  props: ['open', 'defaultOpen', 'modal', 'onOpenChange'],

  setup(props, { slots }) {
    const internalOpen = ref(props.defaultOpen ?? false)
    const effectiveOpen = computed(() => props.open ?? internalOpen.value)

    function handleOpenChange(nextOpen: boolean): void {
      if (props.open === undefined) internalOpen.value = nextOpen
      props.onOpenChange?.(nextOpen)
    }

    useFloatingSurfaceBoundaryPin(effectiveOpen, () => handleOpenChange(false))

    return () => (
      <RekaPopoverRoot open={effectiveOpen.value} modal={props.modal} onUpdate:open={handleOpenChange}>
        {slots.default?.()}
      </RekaPopoverRoot>
    )
  },
})

type PopoverContentProps = Omit<InstanceType<typeof RekaPopoverContent>['$props'], 'class'> &
  HTMLAttributes & {
    class?: HTMLAttributes['class']
  }
export const PopoverContent: FunctionalComponent<PopoverContentProps> = (props, { slots }) => {
  if (!floatingSurfaceBoundaryIsActive()) return null

  const { align = 'center', class: classValue, sideOffset = 4, ...contentProps } = props

  return (
    <RekaPopoverPortal>
      <RekaPopoverContent
        {...contentProps}
        align={align}
        sideOffset={sideOffset}
        data-slot="popover-content"
        data-floating-surface=""
        class={floatingContentClass('--reka-popover-content-transform-origin', classValue)}
      >
        {slots.default?.()}
      </RekaPopoverContent>
    </RekaPopoverPortal>
  )
}
PopoverContent.inheritAttrs = false
export type { PopoverProps }
