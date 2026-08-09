import { defineComponent } from 'vue'
import { Laptop, Moon, Sun } from '@lucide/vue'
import type { LucideIcon } from '@lucide/vue'
import {
  SettingsGroup,
  SettingsCard,
  SettingsList,
  SettingsRow,
  SettingsSelect,
} from '#/web/components/settings/SettingsPrimitives.tsx'
import { useT } from '#/web/stores/i18n-vue.ts'
import { themeStore } from '#/web/stores/theme.ts'
import { i18nStore } from '#/web/stores/i18n.ts'
import { COLOR_THEMES, isColorTheme } from '#/shared/color-theme.ts'
import type { ColorTheme } from '#/shared/color-theme.ts'
import type { LangPref, ThemePref } from '#/shared/settings.ts'
import { useStoreSelector } from '#/web/stores/store-selector.ts'

export const GeneralSettings = defineComponent({
  name: 'GeneralSettings',
  setup() {
    const t = useT()
    const theme = useStoreSelector(themeStore, (state) => ({ pref: state.pref, colorTheme: state.colorTheme }))
    const langPref = useStoreSelector(i18nStore, (state) => state.pref)
    const { setPref: setThemePref, setColorTheme } = themeStore.getState()
    const setLangPref = i18nStore.getState().setPref
    const appearanceOptions: { value: ThemePref; labelKey: string; icon: LucideIcon }[] = [
      { value: 'auto', labelKey: 'settings.appearance.auto', icon: Laptop },
      { value: 'light', labelKey: 'settings.appearance.light', icon: Sun },
      { value: 'dark', labelKey: 'settings.appearance.dark', icon: Moon },
    ]
    const themePresetOptions: { value: ColorTheme; labelKey: string }[] = COLOR_THEMES.map((value) => ({
      value,
      labelKey: `settings.theme-preset.${value}`,
    }))
    const langOptions: { value: LangPref; labelKey: string; emoji: string }[] = [
      { value: 'auto', labelKey: 'settings.lang.auto', emoji: '🌐' },
      { value: 'en', labelKey: 'settings.lang.en', emoji: '🇺🇸' },
      { value: 'zh', labelKey: 'settings.lang.zh', emoji: '🇨🇳' },
      { value: 'ko', labelKey: 'settings.lang.ko', emoji: '🇰🇷' },
      { value: 'ja', labelKey: 'settings.lang.ja', emoji: '🇯🇵' },
    ]
    return () => (
      <>
        <SettingsGroup label={t('settings.group.general')}>
          <SettingsList>
            <SettingsRow
              controlId="settings-theme-preset"
              label={t('settings.theme-preset')}
              control={
                <SettingsSelect
                  id="settings-theme-preset"
                  value={theme.value.colorTheme}
                  options={themePresetOptions.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
                  onChange={(value) => {
                    if (typeof value === 'string' && isColorTheme(value)) void setColorTheme(value)
                  }}
                />
              }
            />
            <SettingsRow
              controlId="settings-appearance"
              label={t('settings.appearance')}
              control={
                <SettingsSelect
                  id="settings-appearance"
                  value={theme.value.pref}
                  options={appearanceOptions.map((o) => ({ value: o.value, label: t(o.labelKey), icon: o.icon }))}
                  onChange={(value) => {
                    if (value === 'auto' || value === 'light' || value === 'dark') void setThemePref(value)
                  }}
                />
              }
            />
            <SettingsRow
              controlId="settings-language"
              label={t('settings.lang')}
              control={
                <SettingsSelect
                  id="settings-language"
                  value={langPref.value}
                  options={langOptions.map((o) => {
                    const languageLabel = t(o.labelKey)
                    return { value: o.value, label: `${o.emoji} ${languageLabel}` }
                  })}
                  onChange={(value) => {
                    if (value === 'auto' || value === 'en' || value === 'zh' || value === 'ko' || value === 'ja') {
                      void setLangPref(value)
                    }
                  }}
                />
              }
            />
          </SettingsList>
        </SettingsGroup>
        <SettingsGroup
          label={t('settings.general.open-from-terminal-title')}
          hint={t('settings.general.open-from-terminal-body')}
        >
          <SettingsCard>
            <div class="px-4 py-3">
              <pre class="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-snug text-muted-foreground">
                {t('settings.general.open-from-terminal-command')}
              </pre>
            </div>
          </SettingsCard>
        </SettingsGroup>
      </>
    )
  },
})
