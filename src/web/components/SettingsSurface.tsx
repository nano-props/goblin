import { defineComponent } from 'vue'
import type { PropType } from 'vue'
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
export const SettingsSurface = defineComponent(
  (props: {
    page: SettingsPage
    onBack?: () => void
    onPageChange?: (page: SettingsPage) => void
    topInset?: number
    autoFocusSelected?: boolean
  }) =>
    () => (
      <SettingsLayout
        page={props.page}
        onBack={props.onBack}
        onPageChange={props.onPageChange}
        topInset={props.topInset}
        autoFocusSelected={props.autoFocusSelected}
      >
        <SettingsPageContent page={props.page} />
      </SettingsLayout>
    ),
  {
    name: 'SettingsSurface',
    props: {
      page: { type: String as PropType<SettingsPage>, required: true },
      onBack: Function as PropType<() => void>,
      onPageChange: Function as PropType<(page: SettingsPage) => void>,
      topInset: Number,
      autoFocusSelected: { type: Boolean, default: true },
    },
  },
)

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
