import { Primitive } from 'reka-ui'
import { defineComponent } from 'vue'

interface InteractiveRegionProps {
  asChild?: boolean
}

export const InteractiveRegion = defineComponent<InteractiveRegionProps>({
  name: 'InteractiveRegion',
  props: ['asChild'],
  inheritAttrs: false,

  setup(props, { attrs, slots }) {
    return () => (
      <Primitive {...attrs} as="div" asChild={props.asChild ?? false} data-interactive>
        {slots.default?.()}
      </Primitive>
    )
  },
})
