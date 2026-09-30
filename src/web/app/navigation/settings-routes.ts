import type { RouteRecordRaw } from 'vue-router'
import { SETTINGS_PAGES } from '#/shared/settings-pages.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'

const settingsPages = {
  general: () =>
    import('#/web/components/settings/pages/GeneralSettings.tsx').then(({ GeneralSettings }) => GeneralSettings),
  shortcuts: () =>
    import('#/web/components/settings/pages/KeyboardShortcutSettings.tsx').then(
      ({ KeyboardShortcutSettings }) => KeyboardShortcutSettings,
    ),
  notifications: () =>
    import('#/web/components/settings/pages/NotificationSettings.tsx').then(
      ({ NotificationSettings }) => NotificationSettings,
    ),
  ssh: () =>
    import('#/web/components/settings/pages/SshRemoteSettings.tsx').then(({ SshRemoteSettings }) => SshRemoteSettings),
  sync: () => import('#/web/components/settings/pages/SyncSettings.tsx').then(({ SyncSettings }) => SyncSettings),
  apps: () =>
    import('#/web/components/settings/pages/ExternalAppSettings.tsx').then(
      ({ ExternalAppSettings }) => ExternalAppSettings,
    ),
  github: () =>
    import('#/web/components/settings/pages/GitHubSettings.tsx').then(({ GitHubSettings }) => GitHubSettings),
  web: () => import('#/web/components/settings/pages/WebSettings.tsx').then(({ WebSettings }) => WebSettings),
  about: () => import('#/web/components/settings/pages/AboutSettings.tsx').then(({ AboutSettings }) => AboutSettings),
} satisfies Record<SettingsPage, RouteRecordRaw['component']>

export const settingsRoute: RouteRecordRaw = {
  path: 'settings',
  name: 'settings',
  component: () =>
    import('#/web/app/navigation/settings-route-view.tsx').then(({ SettingsRouteView }) => SettingsRouteView),
  children: [
    { path: '', name: 'settings-index', redirect: '/settings/general' },
    ...SETTINGS_PAGES.map((page) => ({
      path: page,
      name: `settings-${page}`,
      component: settingsPages[page],
    })),
    { path: ':page', redirect: '/settings/general' },
  ],
}
