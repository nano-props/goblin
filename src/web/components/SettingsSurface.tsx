import { SettingsLayout } from '#/web/components/settings/SettingsLayout.tsx'
import { AboutSettings } from '#/web/components/settings/pages/AboutSettings.tsx'
import { ExternalAppSettings } from '#/web/components/settings/pages/ExternalAppSettings.tsx'
import { GeneralSettings } from '#/web/components/settings/pages/GeneralSettings.tsx'
import { GitHubSettings } from '#/web/components/settings/pages/GitHubSettings.tsx'
import { KeyboardShortcutSettings } from '#/web/components/settings/pages/KeyboardShortcutSettings.tsx'
import { NotificationSettings } from '#/web/components/settings/pages/NotificationSettings.tsx'
import { SshRemoteSettings } from '#/web/components/settings/pages/SshRemoteSettings.tsx'
import { SyncSettings } from '#/web/components/settings/pages/SyncSettings.tsx'
import { WebSettings } from '#/web/components/settings/pages/WebSettings.tsx'
import type { SettingsPage } from '#/shared/settings-pages.ts'
interface SettingsSurfaceProps {
  page: SettingsPage
  onBack?: () => void
  onPageChange?: (page: SettingsPage) => void
  topInset?: number
  autoFocusSelected?: boolean
}
export function SettingsSurface({
  page,
  onBack,
  onPageChange,
  topInset = 0,
  autoFocusSelected = true,
}: SettingsSurfaceProps) {
  return (
    <SettingsLayout
      page={page}
      onBack={onBack}
      onPageChange={onPageChange}
      topInset={topInset}
      autoFocusSelected={autoFocusSelected}
    >
      <SettingsPageContent page={page} />
    </SettingsLayout>
  )
}

function SettingsPageContent({ page }: { page: SettingsPage }) {
  switch (page) {
    case 'general':
      return <GeneralSettings />
    case 'github':
      return <GitHubSettings />
    case 'apps':
      return <ExternalAppSettings />
    case 'sync':
      return <SyncSettings />
    case 'ssh':
      return <SshRemoteSettings />
    case 'shortcuts':
      return <KeyboardShortcutSettings />
    case 'notifications':
      return <NotificationSettings />
    case 'web':
      return <WebSettings />
    case 'about':
      return <AboutSettings />
  }
}
