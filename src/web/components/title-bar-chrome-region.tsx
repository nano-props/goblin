import { Primitive } from 'reka-ui'
import { defineComponent } from 'vue'
import type { HTMLAttributes } from 'vue'
import { cn } from '#/web/lib/cn.ts'

interface TitleBarDragRegionProps {
  reserveWindowControls?: boolean
}

export const TitleBarDragRegion = defineComponent<TitleBarDragRegionProps>({
  name: 'TitleBarDragRegion',
  props: ['reserveWindowControls'],
  inheritAttrs: false,

  setup(props, { attrs, slots }) {
    return () => {
      const { class: classValue, ...elementAttrs } = attrs as HTMLAttributes
      return (
        <div
          {...elementAttrs}
          data-title-bar-chrome-region="drag"
          class={cn(props.reserveWindowControls === false ? 'app-drag-region' : 'title-bar-chrome', classValue)}
        >
          {slots.default?.()}
        </div>
      )
    }
  },
})

export const NativeDragPlate = defineComponent<HTMLAttributes>({
  name: 'NativeDragPlate',
  inheritAttrs: false,
  setup(_props, { attrs }) {
    return () => {
      const { class: classValue, ...elementAttrs } = attrs as HTMLAttributes
      return (
        <TitleBarDragRegion
          {...elementAttrs}
          aria-hidden
          reserveWindowControls={false}
          class={cn('pointer-events-auto absolute left-0 top-0 bg-transparent', classValue)}
        />
      )
    }
  },
})

interface TitleBarInteractiveRegionProps {
  asChild?: boolean
}

export const TitleBarInteractiveRegion = defineComponent<TitleBarInteractiveRegionProps>({
  name: 'TitleBarInteractiveRegion',
  props: ['asChild'],
  inheritAttrs: false,

  setup(props, { attrs, slots }) {
    return () => (
      <Primitive
        {...attrs}
        as="div"
        asChild={props.asChild ?? false}
        data-interactive
        data-title-bar-chrome-region="interactive"
      >
        {slots.default?.()}
      </Primitive>
    )
  },
})

export const TitleBarScrollableInteractiveRegion = defineComponent<TitleBarInteractiveRegionProps>({
  name: 'TitleBarScrollableInteractiveRegion',
  props: ['asChild'],
  inheritAttrs: false,

  setup(props, { attrs, slots }) {
    return () => {
      const { class: classValue, ...elementAttrs } = attrs as HTMLAttributes
      return (
        <Primitive
          {...elementAttrs}
          as="div"
          asChild={props.asChild ?? false}
          data-interactive
          data-title-bar-chrome-region="interactive"
          data-title-bar-scroll-region=""
          class={cn('title-bar-scroll-region', classValue)}
        >
          {slots.default?.()}
        </Primitive>
      )
    }
  },
})

export const TitleBarNoDragRegion = defineComponent<TitleBarInteractiveRegionProps>({
  name: 'TitleBarNoDragRegion',
  props: ['asChild'],
  inheritAttrs: false,

  setup(props, { attrs, slots }) {
    return () => (
      <Primitive {...attrs} as="div" asChild={props.asChild ?? false} data-title-bar-chrome-region="no-drag">
        {slots.default?.()}
      </Primitive>
    )
  },
})
