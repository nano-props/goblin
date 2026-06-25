import type { ReactNode } from 'react'
import { Settings } from 'lucide-react'
import { useT } from '#/web/stores/i18n.ts'
import { Button } from '#/web/components/ui/button.tsx'
import { WINDOW_TOPBAR_HEIGHT_PX } from '#/shared/window-chrome.ts'
import { Tip } from '#/web/components/Tip.tsx'

interface Props {
  onOpenSettings: () => void
  children: ReactNode
}

export function Topbar({ onOpenSettings, children }: Props) {
  return (
    <div
      className="topbar relative flex items-center gap-2 border-b border-border/60 bg-card text-sm"
      style={{ height: WINDOW_TOPBAR_HEIGHT_PX }}
    >
      {children}
      <div className="flex-1" />
      <SettingsButton onClick={onOpenSettings} />
    </div>
  )
}

function SettingsButton({ onClick }: { onClick: () => void }) {
  const t = useT()
  return (
    <Tip label={t('topbar.settings-tooltip')}>
      <Button variant="ghost" size="icon-lg" aria-label={t('topbar.settings')} onClick={onClick}>
        <Settings />
      </Button>
    </Tip>
  )
}
