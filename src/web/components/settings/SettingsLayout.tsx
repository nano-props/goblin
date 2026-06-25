import type { ReactNode } from 'react'
import { SettingsContentFrame } from '#/web/components/settings/SettingsContentFrame.tsx'
import { SettingsSidebar } from '#/web/components/settings/SettingsSidebar.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { SETTINGS_PAGE_CONFIG, SETTINGS_PAGES } from '#/shared/settings-pages.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import { GitHubMark } from '#/web/components/GitHubMark.tsx'
import {
  AppWindow,
  Bell,
  Info,
  Keyboard,
  Router,
  Settings2,
  Shield,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react'

const SETTINGS_PAGE_ICONS = {
  general: Settings2,
  shortcuts: Keyboard,
  notifications: Bell,
  ssh: Shield,
  sync: SlidersHorizontal,
  apps: AppWindow,
  github: GitHubMark,
  web: Router,
  about: Info,
} as const satisfies Record<SettingsPage, LucideIcon | typeof GitHubMark>

interface SettingsLayoutProps {
  page: SettingsPage
  topInset?: number
  autoFocusSelected?: boolean
  children: ReactNode
  onBack?: () => void
  onPageChange?: (page: SettingsPage) => void
}

export function SettingsLayout({
  page,
  topInset = 0,
  autoFocusSelected = true,
  children,
  onBack,
  onPageChange,
}: SettingsLayoutProps) {
  const t = useT()
  const items = SETTINGS_PAGES.map((pageKey) => {
    const config = SETTINGS_PAGE_CONFIG[pageKey]
    return {
      page: pageKey,
      label: t(config.labelKey),
      title: t(config.titleKey),
      Icon: SETTINGS_PAGE_ICONS[pageKey],
    }
  })
  const active = items.find((item) => item.page === page) ?? items[0]

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 flex-1 bg-background">
      <SettingsSidebar
        page={page}
        items={items}
        topInset={topInset}
        autoFocusSelected={autoFocusSelected}
        ariaLabel={t('settings.title')}
        onBack={onBack}
        onPageChange={(nextPage) => {
          onPageChange?.(nextPage)
        }}
      />
      <SettingsContentFrame topInset={topInset} title={active.title}>
        {children}
      </SettingsContentFrame>
    </div>
  )
}
