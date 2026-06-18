import { ArrowLeft } from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { SettingsSurface } from '#/web/components/SettingsSurface.tsx'
import { Tip } from '#/web/components/Tip.tsx'
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
        className="topbar grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-separator/70 bg-background text-sm"
        style={{ height: WINDOW_TOPBAR_HEIGHT_PX }}
      >
        <Tip label={t('settings.back')}>
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className="justify-self-start"
            aria-label={t('settings.back')}
            onClick={onBack}
          >
            <ArrowLeft />
          </Button>
        </Tip>
        <div className="truncate text-center text-sm font-semibold text-foreground">{pageTitle}</div>
        {/* Mirror the left column so the title sits in the topbar's true geometric center. */}
        <div aria-hidden />
      </div>
      <div className="min-h-0 flex-1">
        <SettingsSurface page={page} onPageChange={onPageChange} />
      </div>
    </div>
  )
}
