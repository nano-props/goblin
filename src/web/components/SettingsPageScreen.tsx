import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { SettingsSurface } from '#/web/components/SettingsSurface.tsx'
import type { SettingsPage } from '#/shared/settings-pages.ts'

export const SettingsPageScreen = defineComponent<{
  page: SettingsPage
  onBack: () => void
  onPageChange: (page: SettingsPage) => void
}>({
  name: 'SettingsPageScreen',
  props: {
    page: { type: String as PropType<SettingsPage>, required: true },
    onBack: { type: Function as PropType<() => void>, required: true },
    onPageChange: { type: Function as PropType<(page: SettingsPage) => void>, required: true },
  },

  setup(props) {
    return () => (
      <div class="flex h-full min-h-0 min-w-0 bg-background">
        <SettingsSurface page={props.page} onBack={props.onBack} onPageChange={props.onPageChange} />
      </div>
    )
  },
})
