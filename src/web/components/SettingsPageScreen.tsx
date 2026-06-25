import { SettingsSurface } from '#/web/components/SettingsSurface.tsx'
import type { SettingsPage } from '#/shared/settings-pages.ts'
interface SettingsPageScreenProps {
  page: SettingsPage
  onBack: () => void
  onPageChange: (page: SettingsPage) => void
}

export function SettingsPageScreen({ page, onBack, onPageChange }: SettingsPageScreenProps) {
  return (
    <div className="flex h-full min-h-0 min-w-0 bg-background">
      <SettingsSurface page={page} onBack={onBack} onPageChange={onPageChange} />
    </div>
  )
}
