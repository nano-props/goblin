import { type ReactNode } from 'react'
import { Laptop, Moon, PanelLeft, PanelTop, Sun } from 'lucide-react'
import { Switch } from '#/web/components/ui/switch.tsx'
import {
  SettingsGroup,
  SettingsCard,
  SettingsList,
  SettingsRow,
  SettingsSelect,
} from '#/web/components/settings/SettingsPrimitives.tsx'
import { useRuntimeGeneralSettings } from '#/web/runtime-settings-general.ts'
import { useGeneralSettingsController } from '#/web/runtime-settings-general.ts'
import { useT } from '#/web/stores/i18n.ts'
import { useThemeStore } from '#/web/stores/theme.ts'
import { useI18nStore } from '#/web/stores/i18n.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { COLOR_THEMES } from '#/shared/color-theme.ts'
import type { ColorTheme } from '#/shared/color-theme.ts'
import { WORKSPACE_LAYOUT_LABEL_KEYS, WORKSPACE_LAYOUTS } from '#/shared/workspace-layout.ts'
import type { WorkspaceLayout } from '#/shared/workspace-layout.ts'
import type { LangPref, ThemePref } from '#/shared/api-types.ts'

export function GeneralSettings() {
  const t = useT()
  const themePref = useThemeStore((s) => s.pref)
  const colorTheme = useThemeStore((s) => s.colorTheme)
  const setThemePref = useThemeStore((s) => s.setPref)
  const setColorTheme = useThemeStore((s) => s.setColorTheme)
  const langPref = useI18nStore((s) => s.pref)
  const setLangPref = useI18nStore((s) => s.setPref)
  const workspaceLayout = useReposStore((s) => s.workspaceLayout)
  const setWorkspaceLayout = useReposStore((s) => s.setWorkspaceLayout)
  const { toggleDetailOnActionBarBlankClick } = useRuntimeGeneralSettings()
  const { setToggleDetailOnActionBarBlankClick } = useGeneralSettingsController()
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
  const layoutIcons: Record<WorkspaceLayout, ReactNode> = {
    'left-right': <PanelLeft className="size-4" />,
    'top-bottom': <PanelTop className="size-4" />,
  }
  const workspaceLayoutOptions = WORKSPACE_LAYOUTS.map((value) => ({
    value,
    labelKey: WORKSPACE_LAYOUT_LABEL_KEYS[value],
    icon: layoutIcons[value],
  }))
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
                onChange={(v) => void setColorTheme(v)}
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
                onChange={(v) => void setThemePref(v)}
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
                onChange={(v) => void setLangPref(v)}
              />
            }
          />
          <SettingsRow
            controlId="settings-workspace-layout"
            label={t('settings.workspace-layout')}
            hint={t('settings.workspace-layout-hint')}
            control={
              <SettingsSelect
                id="settings-workspace-layout"
                value={workspaceLayout}
                options={workspaceLayoutOptions.map((o) => ({ value: o.value, label: t(o.labelKey), icon: o.icon }))}
                onChange={setWorkspaceLayout}
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
                onCheckedChange={(enabled) => void setToggleDetailOnActionBarBlankClick(enabled)}
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
