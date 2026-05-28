// Top app bar with embedded tab strip. Holds the ambient settings entry.
// The .topbar CSS rule turns this into the OS drag region; child buttons
// opt out via -webkit-app-region: no-drag (set globally on `button` and
// any element with `data-interactive`).

import type { ReactNode } from 'react'
import { Settings } from 'lucide-react'
import { useT } from '#/renderer/stores/i18n.ts'
import { Tip } from '#/renderer/components/Tip.tsx'
import { Button } from '#/renderer/components/ui/button.tsx'
import { SETTINGS_PANEL_CONTENT_ID } from '#/renderer/components/ui/ids.ts'

interface Props {
  onOpenSettings: () => void
  settingsActive?: boolean
  children: ReactNode
}

export function Topbar({ onOpenSettings, settingsActive = false, children }: Props) {
  const t = useT()

  return (
    <div className="topbar relative flex h-10 items-center gap-2 border-b border-separator bg-background text-sm">
      {children}
      <Tip label={t('topbar.settings')}>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onOpenSettings()}
          aria-label={t('topbar.settings')}
          aria-haspopup="dialog"
          aria-controls={settingsActive ? SETTINGS_PANEL_CONTENT_ID : undefined}
          data-active={settingsActive ? 'true' : undefined}
        >
          <Settings />
        </Button>
      </Tip>
    </div>
  )
}
