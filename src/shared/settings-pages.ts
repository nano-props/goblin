export const SETTINGS_PAGES = ['general', 'shortcuts', 'notifications', 'ssh', 'sync', 'apps', 'github', 'about'] as const

export type SettingsPage = (typeof SETTINGS_PAGES)[number]

export function isSettingsPage(value: string | null | undefined): value is SettingsPage {
  return value !== undefined && value !== null && SETTINGS_PAGES.includes(value as SettingsPage)
}

export const SETTINGS_PAGE_CONFIG = {
  general: { titleKey: 'settings.group.general', labelKey: 'settings.group.general' },
  shortcuts: { titleKey: 'settings.shortcuts', labelKey: 'settings.nav.shortcuts' },
  notifications: { titleKey: 'settings.nav.notifications', labelKey: 'settings.nav.notifications' },
  ssh: { titleKey: 'settings.ssh.title', labelKey: 'settings.nav.ssh' },
  sync: { titleKey: 'settings.nav.refresh', labelKey: 'settings.nav.refresh' },
  apps: { titleKey: 'settings.group.apps', labelKey: 'settings.group.apps' },
  github: { titleKey: 'settings.github.title', labelKey: 'settings.nav.github' },
  about: { titleKey: 'settings.about', labelKey: 'settings.about' },
} as const satisfies Record<SettingsPage, { titleKey: string; labelKey: string }>
