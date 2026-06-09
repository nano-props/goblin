import { useSetToggleDetailOnActionBarBlankClickMutation } from '#/web/settings-queries.ts'
import { readRuntimeGeneralSettings, useRuntimeSettingsSnapshot } from '#/web/runtime-settings-snapshot.ts'
import { runSettingsControllerAction } from '#/web/runtime-settings-controller.ts'
import { useI18nStore } from '#/web/stores/i18n.ts'
import { useThemeStore } from '#/web/stores/theme.ts'
import type { ColorTheme } from '#/shared/color-theme.ts'
import type { LangPref, ThemePref } from '#/shared/rpc.ts'

export function useRuntimeGeneralSettings() {
  const themePref = useThemeStore((s) => s.pref)
  const setThemePref = useThemeStore((s) => s.setPref)
  const colorTheme = useThemeStore((s) => s.colorTheme)
  const setColorTheme = useThemeStore((s) => s.setColorTheme)
  const langPref = useI18nStore((s) => s.pref)
  const setLangPref = useI18nStore((s) => s.setPref)
  const runtimeSettings = useRuntimeSettingsSnapshot()
  return {
    themePref,
    setThemePref,
    colorTheme,
    setColorTheme,
    langPref,
    setLangPref,
    ...readRuntimeGeneralSettings(runtimeSettings),
  }
}

export function useGeneralSettingsController() {
  const setThemePref = useThemeStore((s) => s.setPref)
  const setColorTheme = useThemeStore((s) => s.setColorTheme)
  const setLangPref = useI18nStore((s) => s.setPref)
  const setToggleDetailOnActionBarBlankClick = useSetToggleDetailOnActionBarBlankClickMutation()
  return {
    async setThemePref(pref: ThemePref): Promise<void> {
      await runSettingsControllerAction('appearance update', async () => {
        await setThemePref(pref)
      })
    },
    async setColorTheme(colorTheme: ColorTheme): Promise<void> {
      await runSettingsControllerAction('theme preset update', async () => {
        await setColorTheme(colorTheme)
      })
    },
    async setLangPref(pref: LangPref): Promise<void> {
      await runSettingsControllerAction('language update', async () => {
        await setLangPref(pref)
      })
    },
    async setToggleDetailOnActionBarBlankClick(enabled: boolean): Promise<void> {
      await runSettingsControllerAction('action bar blank toggle update', async () => {
        await setToggleDetailOnActionBarBlankClick.mutateAsync(enabled)
      })
    },
  }
}
