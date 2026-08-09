import { Primitive } from 'reka-ui'
import { defineComponent } from 'vue'
import type { HTMLAttributes } from 'vue'
import { cn } from '#/web/lib/cn.ts'

interface TitleBarDragRegionProps {
  reserveWindowControls?: boolean
}

export const TitleBarDragRegion = defineComponent(
  (props: TitleBarDragRegionProps, { attrs, slots }) =>
    () => {
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
    },
  {
    name: 'TitleBarDragRegion',
    props: ['reserveWindowControls'],
    inheritAttrs: false,
  },
)

export const NativeDragPlate = defineComponent(
  (_props, { attrs }) =>
    () => {
      const { class: classValue, ...elementAttrs } = attrs as HTMLAttributes
      return (
        <TitleBarDragRegion
          {...elementAttrs}
          aria-hidden
          reserveWindowControls={false}
          class={cn('pointer-events-auto absolute left-0 top-0 bg-transparent', classValue)}
        />
      )
    },
  { name: 'NativeDragPlate', inheritAttrs: false },
)

interface TitleBarInteractiveRegionProps {
  asChild?: boolean
}

export const TitleBarInteractiveRegion = defineComponent(
  (props: TitleBarInteractiveRegionProps, { attrs, slots }) =>
    () => (
      <Primitive
        {...attrs}
        as="div"
        asChild={props.asChild ?? false}
        data-interactive
        data-title-bar-chrome-region="interactive"
      >
        {slots.default?.()}
      </Primitive>
    ),
  {
    name: 'TitleBarInteractiveRegion',
    props: ['asChild'],
    inheritAttrs: false,
  },
)

export const TitleBarScrollableInteractiveRegion = defineComponent(
  (props: TitleBarInteractiveRegionProps, { attrs, slots }) =>
    () => {
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
    },
  {
    name: 'TitleBarScrollableInteractiveRegion',
    props: ['asChild'],
    inheritAttrs: false,
  },
)

export const TitleBarNoDragRegion = defineComponent(
  (props: TitleBarInteractiveRegionProps, { attrs, slots }) =>
    () => (
      <Primitive {...attrs} as="div" asChild={props.asChild ?? false} data-title-bar-chrome-region="no-drag">
        {slots.default?.()}
      </Primitive>
    ),
  {
    name: 'TitleBarNoDragRegion',
    props: ['asChild'],
    inheritAttrs: false,
  },
)
