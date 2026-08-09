import { defineComponent } from 'vue'

export const WorkspacePanePanelFrame = defineComponent<{
  id: string
  labelledById?: string
  label?: string
  busy?: boolean
}>({
  name: 'WorkspacePanePanelFrame',
  props: {
    id: { type: String, required: true },
    labelledById: String,
    label: String,
    busy: Boolean,
  },

  setup(props, { slots }) {
    return () => (
      <div
        id={props.id}
        role="tabpanel"
        aria-busy={props.busy || undefined}
        aria-labelledby={props.labelledById}
        aria-label={props.labelledById ? undefined : props.label}
        class="flex min-h-0 flex-1 flex-col"
      >
        {slots.default?.()}
      </div>
    )
  },
})
