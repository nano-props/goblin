import type { UserSettings } from '#/shared/settings.ts'
import { parseAllowedGlobalShortcut } from '#/shared/accelerator.ts'
import { isColorTheme } from '#/shared/color-theme.ts'
import {
  isBoolean,
  isFetchInterval,
  isLangPref,
  isThemePref,
  type UserSettingsData,
} from '#/server/modules/user-settings-codec.ts'

export type UserSettingsPatch = Partial<UserSettings>

export interface ValidatedUserSettingsPatch {
  lang?: UserSettings['lang']
  theme?: UserSettings['theme']
  colorTheme?: UserSettings['colorTheme']
  fetchIntervalSec?: number
  terminalNotificationsEnabled?: boolean
  shortcutsDisabled?: boolean
  globalShortcutDisabled?: boolean
  globalShortcut?: string
  lanEnabled?: boolean
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
  const globalShortcutDisabled = optionalCommandValue(
    patch.globalShortcutDisabled,
    isBoolean,
    'global shortcut disabled setting',
  )
  const globalShortcut =
    patch.globalShortcut === undefined ? undefined : parseAllowedGlobalShortcut(patch.globalShortcut)
  if (patch.globalShortcut !== undefined && globalShortcut === null) {
    throw new TypeError('invalid global shortcut')
  }
  const lanEnabled = optionalCommandValue(patch.lanEnabled, isBoolean, 'LAN setting')
  return {
    lang,
    theme,
    colorTheme,
    fetchIntervalSec,
    terminalNotificationsEnabled,
    shortcutsDisabled,
    globalShortcutDisabled,
    globalShortcut: globalShortcut ?? undefined,
    lanEnabled,
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
    globalShortcutDisabled: patch.globalShortcutDisabled ?? data.globalShortcutDisabled,
    globalShortcut: patch.globalShortcut ?? data.globalShortcut,
    lanEnabled: patch.lanEnabled ?? data.lanEnabled,
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
    globalShortcutDisabled: data.globalShortcutDisabled,
    globalShortcut: data.globalShortcut,
    lanEnabled: data.lanEnabled,
  }
}

function sameUserSettings(left: UserSettings, right: UserSettings): boolean {
  return (
    left.lang === right.lang &&
    left.theme === right.theme &&
    left.colorTheme === right.colorTheme &&
    left.fetchIntervalSec === right.fetchIntervalSec &&
    left.terminalNotificationsEnabled === right.terminalNotificationsEnabled &&
    left.shortcutsDisabled === right.shortcutsDisabled &&
    left.globalShortcutDisabled === right.globalShortcutDisabled &&
    left.globalShortcut === right.globalShortcut &&
    left.lanEnabled === right.lanEnabled
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
