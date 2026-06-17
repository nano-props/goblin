// Top app bar with embedded tab strip and a three-dot menu.
// The .topbar CSS rule turns this into the OS drag region; child buttons
// opt out via -webkit-app-region: no-drag (set globally on `button` and
// any element with `data-interactive`).

import type { ReactNode } from 'react'
import { MoreVertical, Settings } from 'lucide-react'
import { useT } from '#/web/stores/i18n.ts'
import { Button } from '#/web/components/ui/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/web/components/ui/dropdown-menu.tsx'
import { WINDOW_TOPBAR_HEIGHT_PX } from '#/shared/window-chrome.ts'

interface Props {
  onOpenSettings: () => void
  children: ReactNode
}

export function Topbar({ onOpenSettings, children }: Props) {
  const t = useT()

  return (
    <div
      className="topbar relative flex items-center gap-2 border-b border-separator bg-background text-sm"
      style={{ height: WINDOW_TOPBAR_HEIGHT_PX }}
    >
      {children}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-lg" aria-label={t('topbar.menu')}>
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onOpenSettings()}>
            <Settings className="size-4" />
            <span>{t('topbar.settings')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
