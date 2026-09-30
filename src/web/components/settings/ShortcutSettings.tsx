import { defineComponent } from 'vue'
import { Switch } from '#/web/components/ui/switch.tsx'
import { SettingsCard, SettingsListItem } from '#/web/components/settings/SettingsPrimitives.tsx'
import { useShortcutSettingsController, useShortcutSettings } from '#/web/settings/runtime-shortcuts.ts'
import { useT } from '#/web/stores/i18n-vue.ts'

export const ShortcutSettings = defineComponent({
  name: 'ShortcutSettings',
  setup() {
    const t = useT()
    const settings = useShortcutSettings()
    const { setShortcutsDisabled } = useShortcutSettingsController()
    return () => (
      <SettingsCard>
        <SettingsListItem size="md">
          <label for="shortcuts-disabled-switch" class="min-w-0 cursor-pointer select-none text-sm text-foreground">
            {t('settings.shortcuts-disable-app')}
          </label>
          <Switch
            id="shortcuts-disabled-switch"
            modelValue={settings.value.shortcutsDisabled}
            onUpdate:modelValue={(disabled) => setShortcutsDisabled(disabled)}
            aria-label={t('settings.shortcuts-disable-app')}
          />
        </SettingsListItem>
      </SettingsCard>
    )
  },
})
