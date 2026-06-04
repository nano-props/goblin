import { type ReactNode } from 'react'
import { Laptop, Moon, Sun } from 'lucide-react'
import { Switch } from '#/web/components/ui/switch.tsx'
import {
  SettingsGroup,
  SettingsCard,
  SettingsList,
  SettingsRow,
  SettingsSelect,
} from '#/web/components/settings/SettingsPrimitives.tsx'
import { useSetToggleDetailOnActionBarBlankClickMutation, useSettingsSnapshotQuery } from '#/web/settings-queries.ts'
import { useThemeStore } from '#/web/stores/theme.ts'
import { useI18nStore, useT } from '#/web/stores/i18n.ts'
import { COLOR_THEMES } from '#/shared/color-theme.ts'
import type { ColorTheme } from '#/shared/color-theme.ts'
import type { LangPref, ThemePref } from '#/shared/rpc.ts'
export function GeneralSettings() {
  const t = useT()
  const themePref = useThemeStore((s) => s.pref)
  const setThemePref = useThemeStore((s) => s.setPref)
  const colorTheme = useThemeStore((s) => s.colorTheme)
  const setColorTheme = useThemeStore((s) => s.setColorTheme)
  const langPref = useI18nStore((s) => s.pref)
  const setLangPref = useI18nStore((s) => s.setPref)
  const { data } = useSettingsSnapshotQuery()
  if (!data) return null
  const toggleDetailOnActionBarBlankClick = data.toggleDetailOnActionBarBlankClick
  const setToggleDetailOnActionBarBlankClick = useSetToggleDetailOnActionBarBlankClickMutation()
  const appearanceOptions: { value: ThemePref; labelKey: string; icon: ReactNode }[] = [
    { value: 'auto', labelKey: 'settings.appearance.auto', icon: <Laptop className="size-4" /> },
    { value: 'light', labelKey: 'settings.appearance.light', icon: <Sun className="size-4" /> },
    { value: 'dark', labelKey: 'settings.appearance.dark', icon: <Moon className="size-4" /> },
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
  const save = (fn: () => Promise<unknown>, label: string) => {
    void fn().catch((err) => console.warn(`[settings] ${label} update failed`, err))
  }

  return (
    <>
      <SettingsGroup label={t('settings.group.general')}>
        <SettingsList>
          <SettingsRow
            controlId="settings-theme-preset"
            label={t('settings.theme-preset')}
            control={
              <SettingsSelect
                id="settings-theme-preset"
                value={colorTheme}
                options={themePresetOptions.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
                onChange={(v) => save(() => setColorTheme(v), 'theme preset')}
              />
            }
          />
          <SettingsRow
            controlId="settings-appearance"
            label={t('settings.appearance')}
            control={
              <SettingsSelect
                id="settings-appearance"
                value={themePref}
                options={appearanceOptions.map((o) => ({ value: o.value, label: t(o.labelKey), icon: o.icon }))}
                onChange={(v) => save(() => setThemePref(v), 'appearance')}
              />
            }
          />
          <SettingsRow
            controlId="settings-language"
            label={t('settings.lang')}
            control={
              <SettingsSelect
                id="settings-language"
                value={langPref}
                options={langOptions.map((o) => ({ value: o.value, label: `${o.emoji} ${t(o.labelKey)}` }))}
                onChange={(v) => save(() => setLangPref(v), 'language')}
              />
            }
          />
          <SettingsRow
            controlId="settings-action-bar-blank-toggle"
            label={t('settings.action-bar-blank-toggle')}
            hint={t('settings.action-bar-blank-toggle-hint')}
            control={
              <Switch
                id="settings-action-bar-blank-toggle"
                checked={toggleDetailOnActionBarBlankClick}
                onCheckedChange={(enabled) =>
                  save(() => setToggleDetailOnActionBarBlankClick.mutateAsync(enabled), 'action bar blank toggle')
                }
                aria-label={t('settings.action-bar-blank-toggle')}
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
          <div className="px-4 py-3">
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-snug text-muted-foreground">
              {t('settings.general.open-from-terminal-command')}
            </pre>
          </div>
        </SettingsCard>
      </SettingsGroup>
    </>
  )
}
