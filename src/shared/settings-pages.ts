export const SETTINGS_PAGES = ['general', 'shortcuts', 'notifications', 'ssh', 'sync', 'apps', 'github', 'about'] as const

export type SettingsPage = (typeof SETTINGS_PAGES)[number]

export function isSettingsPage(value: string | null | undefined): value is SettingsPage {
  return value !== undefined && value !== null && SETTINGS_PAGES.includes(value as SettingsPage)
}
