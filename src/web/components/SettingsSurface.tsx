import { SettingsLayout } from '#/web/components/settings/SettingsLayout.tsx'
import { AboutSettings } from '#/web/components/settings/pages/AboutSettings.tsx'
import { ExternalAppSettings } from '#/web/components/settings/pages/ExternalAppSettings.tsx'
import { GeneralSettings } from '#/web/components/settings/pages/GeneralSettings.tsx'
import { GitHubSettings } from '#/web/components/settings/pages/GitHubSettings.tsx'
import { KeyboardShortcutSettings } from '#/web/components/settings/pages/KeyboardShortcutSettings.tsx'
import { NotificationSettings } from '#/web/components/settings/pages/NotificationSettings.tsx'
import { SshRemoteSettings } from '#/web/components/settings/pages/SshRemoteSettings.tsx'
import { SyncSettings } from '#/web/components/settings/pages/SyncSettings.tsx'
import { useT } from '#/web/stores/i18n.ts'
import type { SettingsPage } from '#/shared/rpc.ts'
interface SettingsSurfaceProps {
  page: SettingsPage
  onPageChange?: (page: SettingsPage) => void
  topInset?: number
  autoFocusSelected?: boolean
}
export function SettingsSurface({ page, onPageChange, topInset = 0, autoFocusSelected = true }: SettingsSurfaceProps) {
  useT()

  return (
    <SettingsLayout page={page} onPageChange={onPageChange} topInset={topInset} autoFocusSelected={autoFocusSelected}>
      <>
        {page === 'general' && <GeneralSettings />}
        {page === 'github' && <GitHubSettings />}
        {page === 'apps' && <ExternalAppSettings />}
        {page === 'sync' && <SyncSettings />}
        {page === 'ssh' && <SshRemoteSettings />}
        {page === 'shortcuts' && <KeyboardShortcutSettings />}
        {page === 'notifications' && <NotificationSettings />}
        {page === 'about' && <AboutSettings />}
      </>
    </SettingsLayout>
  )
}
