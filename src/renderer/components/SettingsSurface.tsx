import { AppWindow, Bell, Info, Keyboard, Settings2, Shield, SlidersHorizontal, type LucideIcon } from 'lucide-react'
import { GitHubMark } from '#/renderer/components/GitHubMark.tsx'
import { SettingsContentFrame } from '#/renderer/components/settings/SettingsContentFrame.tsx'
import { SettingsSidebar } from '#/renderer/components/settings/SettingsSidebar.tsx'
import { AboutSettings } from '#/renderer/components/settings/pages/AboutSettings.tsx'
import { ExternalAppSettings } from '#/renderer/components/settings/pages/ExternalAppSettings.tsx'
import { GeneralSettings } from '#/renderer/components/settings/pages/GeneralSettings.tsx'
import { GitHubSettings } from '#/renderer/components/settings/pages/GitHubSettings.tsx'
import { KeyboardShortcutSettings } from '#/renderer/components/settings/pages/KeyboardShortcutSettings.tsx'
import { NotificationSettings } from '#/renderer/components/settings/pages/NotificationSettings.tsx'
import { ProxySettings } from '#/renderer/components/settings/pages/ProxySettings.tsx'
import { SyncSettings } from '#/renderer/components/settings/pages/SyncSettings.tsx'
import { useT } from '#/renderer/stores/i18n.ts'
import type { SettingsPage } from '#/shared/rpc.ts'

interface SettingsSurfaceProps {
  page: SettingsPage
  onPageChange: (page: SettingsPage) => void
  topInset?: number
  autoFocusSelected?: boolean
}

const SETTINGS_SURFACE_PAGES = [
  { page: 'general', labelKey: 'settings.group.general', titleKey: 'settings.group.general', Icon: Settings2 },
  { page: 'shortcuts', labelKey: 'settings.nav.shortcuts', titleKey: 'settings.shortcuts', Icon: Keyboard },
  { page: 'notifications', labelKey: 'settings.nav.notifications', titleKey: 'settings.nav.notifications', Icon: Bell },
  { page: 'proxy', labelKey: 'settings.group.proxy', titleKey: 'settings.group.proxy', Icon: Shield },
  { page: 'sync', labelKey: 'settings.nav.refresh', titleKey: 'settings.nav.refresh', Icon: SlidersHorizontal },
  { page: 'apps', labelKey: 'settings.group.apps', titleKey: 'settings.group.apps', Icon: AppWindow },
  { page: 'github', labelKey: 'settings.nav.github', titleKey: 'settings.github.title', Icon: GitHubMark },
  { page: 'about', labelKey: 'settings.about', titleKey: 'settings.about', Icon: Info },
] as const satisfies ReadonlyArray<{
  page: SettingsPage
  labelKey: string
  titleKey: string
  Icon: LucideIcon | typeof GitHubMark
}>

export function SettingsSurface({ page, onPageChange, topInset = 0, autoFocusSelected = true }: SettingsSurfaceProps) {
  const t = useT()
  const pages = SETTINGS_SURFACE_PAGES.map((item) => ({
    page: item.page,
    label: t(item.labelKey),
    title: t(item.titleKey),
    Icon: item.Icon,
  }))
  const active = pages.find((item) => item.page === page) ?? pages[0]

  return (
    <div className="relative flex h-full min-h-0 bg-background">
      {topInset > 0 ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-10 [-webkit-app-region:drag]"
          style={{ height: topInset }}
        />
      ) : null}
      <SettingsSidebar
        page={page}
        items={pages}
        topInset={topInset}
        autoFocusSelected={autoFocusSelected}
        ariaLabel={t('settings.title')}
        onPageChange={onPageChange}
      />
      <SettingsContentFrame title={active.title} topInset={topInset}>
        {page === 'general' && <GeneralSettings />}
        {page === 'github' && <GitHubSettings />}
        {page === 'apps' && <ExternalAppSettings />}
        {page === 'sync' && <SyncSettings />}
        {page === 'proxy' && <ProxySettings />}
        {page === 'shortcuts' && <KeyboardShortcutSettings />}
        {page === 'notifications' && <NotificationSettings />}
        {page === 'about' && <AboutSettings />}
      </SettingsContentFrame>
    </div>
  )
}
