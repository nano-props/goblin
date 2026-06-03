import { ArrowLeft } from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { SettingsSurface } from '#/web/components/SettingsSurface.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { SETTINGS_PAGE_CONFIG } from '#/shared/settings-pages.ts'
import type { SettingsPage } from '#/shared/settings-pages.ts'
import { WINDOW_TOPBAR_HEIGHT_PX } from '#/shared/window-chrome.ts'
interface SettingsPageScreenProps {
  page: SettingsPage
  onBack: () => void
  onPageChange: (page: SettingsPage) => void
}

export function SettingsPageScreen({ page, onBack, onPageChange }: SettingsPageScreenProps) {
  const t = useT()
  const pageTitle = t(SETTINGS_PAGE_CONFIG[page].titleKey)

  return (
    <div className="flex h-full flex-col bg-background">
      <div
        className="topbar flex shrink-0 items-center gap-2 border-b border-separator/70 bg-background text-sm"
        style={{ height: WINDOW_TOPBAR_HEIGHT_PX }}
      >
        <Button type="button" variant="ghost" size="sm" className="gap-1.5 px-2" onClick={onBack}>
          <ArrowLeft className="size-4" />
          {t('settings.back')}
        </Button>
        <div className="flex-1 text-center text-sm font-semibold text-foreground">{pageTitle}</div>
      </div>
      <div className="min-h-0 flex-1">
        <SettingsSurface page={page} onPageChange={onPageChange} />
      </div>
    </div>
  )
}
