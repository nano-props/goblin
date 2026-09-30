import type { UserSettings } from '#/shared/settings.ts'
import { isColorTheme } from '#/shared/color-theme.ts'
import {
  isBoolean,
  isFetchInterval,
  isLangPref,
  isThemePref,
  type UserSettingsData,
} from '#/server/settings/user-settings-codec.ts'

export type UserSettingsPatch = Partial<UserSettings>

export interface ValidatedUserSettingsPatch {
  lang?: UserSettings['lang']
  theme?: UserSettings['theme']
  colorTheme?: UserSettings['colorTheme']
  fetchIntervalSec?: number
  terminalNotificationsEnabled?: boolean
  shortcutsDisabled?: boolean
}

export interface UserSettingsPatchPlan {
  next: UserSettingsData
  changed: boolean
  fetchIntervalChanged: boolean
}

export function validateUserSettingsPatch(patch: UserSettingsPatch): ValidatedUserSettingsPatch {
  const lang = optionalCommandValue(patch.lang, isLangPref, 'language')
  const theme = optionalCommandValue(patch.theme, isThemePref, 'theme')
  const colorTheme = optionalCommandValue(patch.colorTheme, isColorTheme, 'color theme')
  const fetchIntervalSec = normalizeFetchInterval(
    optionalCommandValue(patch.fetchIntervalSec, isFetchInterval, 'fetch interval'),
  )
  const terminalNotificationsEnabled = optionalCommandValue(
    patch.terminalNotificationsEnabled,
    isBoolean,
    'terminal notifications setting',
  )
  const shortcutsDisabled = optionalCommandValue(patch.shortcutsDisabled, isBoolean, 'shortcuts setting')
  return {
    lang,
    theme,
    colorTheme,
    fetchIntervalSec,
    terminalNotificationsEnabled,
    shortcutsDisabled,
  }
}

export function planUserSettingsPatch(
  data: UserSettingsData,
  patch: ValidatedUserSettingsPatch,
): UserSettingsPatchPlan {
  const next: UserSettingsData = {
    ...data,
    lang: patch.lang ?? data.lang,
    theme: patch.theme ?? data.theme,
    colorTheme: patch.colorTheme ?? data.colorTheme,
    fetchIntervalSec: patch.fetchIntervalSec ?? data.fetchIntervalSec,
    terminalNotificationsEnabled: patch.terminalNotificationsEnabled ?? data.terminalNotificationsEnabled,
    shortcutsDisabled: patch.shortcutsDisabled ?? data.shortcutsDisabled,
  }
  const changed = !sameUserSettings(userSettingsFromData(data), userSettingsFromData(next))
  return {
    next: changed ? next : data,
    changed,
    fetchIntervalChanged: data.fetchIntervalSec !== next.fetchIntervalSec,
  }
}

export function userSettingsFromData(data: UserSettingsData): UserSettings {
  return {
    lang: data.lang,
    theme: data.theme,
    colorTheme: data.colorTheme,
    fetchIntervalSec: data.fetchIntervalSec,
    terminalNotificationsEnabled: data.terminalNotificationsEnabled,
    shortcutsDisabled: data.shortcutsDisabled,
  }
}

function sameUserSettings(left: UserSettings, right: UserSettings): boolean {
  return (
    left.lang === right.lang &&
    left.theme === right.theme &&
    left.colorTheme === right.colorTheme &&
    left.fetchIntervalSec === right.fetchIntervalSec &&
    left.terminalNotificationsEnabled === right.terminalNotificationsEnabled &&
    left.shortcutsDisabled === right.shortcutsDisabled
  )
}

function normalizeFetchInterval(value: number | undefined): number | undefined {
  return value === 0 ? 0 : value
}

function optionalCommandValue<T>(
  value: unknown,
  valid: (candidate: unknown) => candidate is T,
  name: string,
): T | undefined {
  if (value === undefined) return undefined
  if (!valid(value)) throw new TypeError(`invalid ${name}`)
  return value
}
