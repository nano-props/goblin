import {
  TooltipArrow as RekaTooltipArrow,
  TooltipContent as RekaTooltipContent,
  TooltipPortal as RekaTooltipPortal,
} from 'reka-ui'
import type { FunctionalComponent, HTMLAttributes } from 'vue'
import { cn } from '#/web/lib/cn.ts'

export const TOOLTIP_SURFACE_CLASS =
  'rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md'
export const TOOLTIP_META_TEXT_CLASS = 'text-[11px] text-muted-foreground'
export const TOOLTIP_STACK_SM_CLASS = 'space-y-0.5'
export const TOOLTIP_STACK_MD_CLASS = 'space-y-1'

type TooltipContentProps = Omit<InstanceType<typeof RekaTooltipContent>['$props'], 'class'> & {
  class?: HTMLAttributes['class']
}

export const TooltipContent: FunctionalComponent<TooltipContentProps> = (props, { slots }) => {
  const { class: classValue, sideOffset = 0, ...contentProps } = props

  return (
    <RekaTooltipPortal>
      <RekaTooltipContent
        {...contentProps}
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        class={cn(
          `z-50 w-fit origin-(--reka-tooltip-content-transform-origin) animate-in ${TOOLTIP_SURFACE_CLASS} fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95`,
          classValue,
        )}
      >
        {slots.default?.()}
        <RekaTooltipArrow width={10} height={5} class="z-50 fill-popover stroke-border [stroke-width:1]" />
      </RekaTooltipContent>
    </RekaTooltipPortal>
  )
}
TooltipContent.inheritAttrs = false
