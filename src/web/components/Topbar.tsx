// Top app bar with embedded tab strip and a three-dot menu.
// The .topbar CSS rule turns this into the OS drag region; child buttons
// opt out via -webkit-app-region: no-drag (set globally on `button` and
// any element with `data-interactive`).

import type { ReactNode } from 'react'
import { MoreVertical, PanelLeft, PanelTop, Settings, type LucideIcon } from 'lucide-react'
import { useT } from '#/web/stores/i18n.ts'
import { Button } from '#/web/components/ui/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/web/components/ui/dropdown-menu.tsx'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { RepoWorkspaceLayout } from '#/web/stores/repos/types.ts'
import { WINDOW_TOPBAR_HEIGHT_PX } from '#/shared/window-chrome.ts'

interface Props {
  onOpenSettings: () => void
  children: ReactNode
}

const LAYOUT_OPTIONS: { id: RepoWorkspaceLayout; icon: LucideIcon; labelKey: string }[] = [
  { id: 'top-bottom', icon: PanelTop, labelKey: 'topbar.layout.top-bottom' },
  { id: 'left-right', icon: PanelLeft, labelKey: 'topbar.layout.left-right' },
]

export function Topbar({ onOpenSettings, children }: Props) {
  const t = useT()
  const workspaceLayout = useReposStore((s) => s.workspaceLayout)
  const setWorkspaceLayout = useReposStore((s) => s.setWorkspaceLayout)

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
          {LAYOUT_OPTIONS.map((option) => {
            const Icon = option.icon
            const active = workspaceLayout === option.id
            return (
              <DropdownMenuItem
                key={option.id}
                onSelect={() => setWorkspaceLayout(option.id)}
                className={active ? 'bg-selected text-selected-foreground' : undefined}
              >
                <Icon className="size-4" />
                <span>{t(option.labelKey)}</span>
              </DropdownMenuItem>
            )
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onOpenSettings()}>
            <Settings className="size-4" />
            <span>{t('topbar.settings')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
