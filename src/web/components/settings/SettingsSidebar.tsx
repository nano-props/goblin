import { useEffect, useRef, type ComponentType } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '#/web/components/ui/button.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { useResponsiveUiMode } from '#/web/hooks/useResponsiveUiMode.tsx'
import { cn } from '#/web/lib/cn.ts'
import { useT } from '#/web/stores/i18n.ts'
import { WINDOW_TOPBAR_HEIGHT_PX } from '#/shared/window-chrome.ts'
import { SidebarRowButton } from '#/web/components/ui/sidebar-row-button.tsx'

export interface SettingsSidebarItem<TPage extends string> {
  page: TPage
  label: string
  Icon: ComponentType<{ className?: string }>
}

interface SettingsSidebarProps<TPage extends string> {
  page: TPage
  items: readonly SettingsSidebarItem<TPage>[]
  topInset?: number
  autoFocusSelected?: boolean
  ariaLabel: string
  onBack?: () => void
  onPageChange: (page: TPage) => void
}

export function SettingsSidebar<TPage extends string>({
  page,
  items,
  topInset = 0,
  autoFocusSelected = true,
  ariaLabel,
  onBack,
  onPageChange,
}: SettingsSidebarProps<TPage>) {
  const t = useT()
  const uiMode = useResponsiveUiMode()
  const compact = uiMode === 'compact'
  const selectedPageButtonRef = useRef<HTMLButtonElement | null>(null)
  const chromeHeight = topInset > 0 ? topInset : WINDOW_TOPBAR_HEIGHT_PX

  useEffect(() => {
    if (!autoFocusSelected) return
    selectedPageButtonRef.current?.focus()
  }, [autoFocusSelected, page])

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-r border-border/60 bg-card pb-3',
        compact ? 'w-16 px-2' : 'w-64 px-3',
      )}
    >
      <div className="app-drag-region shrink-0" aria-hidden style={{ height: chromeHeight }} />
      {onBack ? (
        <Button
          type="button"
          variant="ghost"
          size={compact ? 'icon-lg' : 'default'}
          className={cn(
            'mb-3 text-muted-foreground',
            compact ? 'mx-auto size-9' : 'h-9 w-full justify-start gap-2 px-2.5',
          )}
          aria-label={t('settings.back')}
          onClick={onBack}
        >
          <ArrowLeft />
          <span className={compact ? 'hidden' : 'truncate'}>{t('settings.back')}</span>
        </Button>
      ) : null}

      <ScrollArea className="min-h-0 flex-1" scrollbarMode="compact">
        <nav className="space-y-1.5 pb-3" aria-label={ariaLabel}>
          {items.map((item) => (
            <SidebarRowButton
              key={item.page}
              ref={page === item.page ? selectedPageButtonRef : undefined}
              onClick={() => onPageChange(item.page)}
              selected={page === item.page}
              size={compact ? 'icon' : 'compact'}
              className={cn('font-normal', compact ? 'mx-auto' : 'justify-start')}
              contentClassName={cn(compact ? 'hidden' : 'truncate', page === item.page ? 'font-medium' : 'font-normal')}
              leading={
                <item.Icon
                  className={cn(
                    'size-4 shrink-0',
                    page === item.page ? 'text-selected-foreground' : 'text-muted-foreground',
                  )}
                />
              }
              aria-label={item.label}
              aria-current={page === item.page ? 'page' : undefined}
            >
              {item.label}
            </SidebarRowButton>
          ))}
        </nav>
      </ScrollArea>
    </aside>
  )
}
