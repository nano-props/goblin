import { defineComponent } from 'vue'
import type { HTMLAttributes, PropType, Ref, VNodeChild } from 'vue'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { TitleBarDragRegion, TitleBarScrollableInteractiveRegion } from '#/web/components/title-bar-chrome-region.tsx'
import { cn } from '#/web/lib/cn.ts'

interface ToolbarTabStripProps {
  compact: boolean
  compactContent: VNodeChild
  scrollContent: VNodeChild
  viewportRef?: Ref<HTMLDivElement | null> | ((element: HTMLDivElement | null) => void)
  viewportOnScroll?: (event: Event) => void
}

export const ToolbarTabStrip = defineComponent<ToolbarTabStripProps>({
  name: 'ToolbarTabStrip',
  props: {
    compact: { type: Boolean, required: true },
    compactContent: { type: null, required: true },
    scrollContent: { type: null, required: true },
    viewportRef: [Object, Function] as PropType<ToolbarTabStripProps['viewportRef']>,
    viewportOnScroll: Function as PropType<(event: Event) => void>,
  },

  setup(props) {
    return () => {
      if (props.compact) {
        return <div class="flex h-full min-w-0 flex-1 items-center">{props.compactContent}</div>
      }

      return (
        <div class="flex h-full min-w-0 flex-1 items-center">
          <TitleBarScrollableInteractiveRegion asChild>
            <ScrollArea
              orientation="horizontal"
              scrollbarMode="compact"
              class="h-full min-w-0 max-w-full flex-none w-fit"
              viewportClass="[&>div]:h-full"
              viewportRef={props.viewportRef}
              viewportOnScroll={props.viewportOnScroll}
            >
              {props.scrollContent}
            </ScrollArea>
          </TitleBarScrollableInteractiveRegion>
          <TitleBarDragRegion reserveWindowControls={false} class="min-w-0 flex-1 self-stretch" aria-hidden="true" />
        </div>
      )
    }
  },
})

type ToolbarTabStripBodyProps = HTMLAttributes & { scroll?: boolean }

export const ToolbarTabStripBody = defineComponent<ToolbarTabStripBodyProps>({
  name: 'ToolbarTabStripBody',
  inheritAttrs: false,
  props: { scroll: Boolean },

  setup(props, { slots, attrs }) {
    return () => {
      const { class: classValue, ...elementAttrs } = attrs as HTMLAttributes
      return (
        <div
          {...elementAttrs}
          class={cn('flex h-full min-w-0 items-center gap-1', props.scroll && 'w-max min-w-full', classValue)}
        >
          {slots.default?.()}
        </div>
      )
    }
  },
})

export const ToolbarTabList = defineComponent<HTMLAttributes>({
  name: 'ToolbarTabList',
  inheritAttrs: false,
  setup(_props, { slots, attrs }) {
    return () => {
      const { class: classValue, ...elementAttrs } = attrs as HTMLAttributes
      return (
        <div {...elementAttrs} class={cn('flex h-full min-w-0 items-center gap-1', classValue)}>
          {slots.default?.()}
        </div>
      )
    }
  },
})
