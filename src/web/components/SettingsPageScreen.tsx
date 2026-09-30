import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { SettingsLayout } from '#/web/components/settings/SettingsLayout.tsx'
import type { SettingsPage } from '#/shared/settings-pages.ts'
export const SettingsPageScreen = defineComponent<{
  page: SettingsPage
  onBack?: () => void
  onPageChange?: (page: SettingsPage) => void
  topInset?: number
  autoFocusSelected?: boolean
}>({
  name: 'SettingsPageScreen',
  props: {
    page: { type: String as PropType<SettingsPage>, required: true },
    onBack: Function as PropType<() => void>,
    onPageChange: Function as PropType<(page: SettingsPage) => void>,
    topInset: Number,
    autoFocusSelected: { type: Boolean, default: true },
  },

  setup(props, { slots }) {
    return () => (
      <SettingsLayout
        page={props.page}
        onBack={props.onBack}
        onPageChange={props.onPageChange}
        topInset={props.topInset}
        autoFocusSelected={props.autoFocusSelected}
      >
        {slots.default?.()}
      </SettingsLayout>
    )
  },
})
