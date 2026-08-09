import { SelectValue as RekaSelectValue } from 'reka-ui'
import { defineComponent } from 'vue'

interface SelectValueProps {
  placeholder?: string
}

export const SelectValue = defineComponent<SelectValueProps>({
  name: 'SelectValue',
  inheritAttrs: false,
  props: {
    placeholder: { type: String, required: false },
  },
  setup(props, { attrs, slots }) {
    return () =>
      slots.default ? (
        <RekaSelectValue {...attrs} placeholder={props.placeholder} data-slot="select-value">
          {slots.default()}
        </RekaSelectValue>
      ) : (
        <RekaSelectValue {...attrs} placeholder={props.placeholder} data-slot="select-value" />
      )
  },
})
