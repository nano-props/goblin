import { useEffect, useRef, type ComponentType } from 'react'
import { Button } from '#/web/components/ui/button.tsx'
import { cn } from '#/web/lib/cn.ts'
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
  onPageChange: (page: TPage) => void
}

export function SettingsSidebar<TPage extends string>({
  page,
  items,
  topInset = 0,
  autoFocusSelected = true,
  ariaLabel,
  onPageChange,
}: SettingsSidebarProps<TPage>) {
  const selectedPageButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!autoFocusSelected) return
    selectedPageButtonRef.current?.focus()
  }, [autoFocusSelected, page])

  return (
    <aside
      className="flex w-48 shrink-0 flex-col border-r border-separator bg-muted/30 px-3 pb-3"
      style={{ paddingTop: topInset > 0 ? topInset + 12 : 12 }}
    >
      <nav className="space-y-1.5" aria-label={ariaLabel}>
        {items.map((item) => (
          <Button
            key={item.page}
            ref={page === item.page ? selectedPageButtonRef : undefined}
            type="button"
            data-interactive
            variant="ghost"
            onClick={() => onPageChange(item.page)}
            className={cn(
              'h-9 w-full justify-start gap-2 px-2.5 text-left text-sm font-normal',
              page === item.page
                ? 'bg-selected text-selected-foreground hover:bg-selected'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
            aria-current={page === item.page ? 'page' : undefined}
          >
            <item.Icon
              className={cn(
                'size-4 shrink-0',
                page === item.page ? 'text-selected-foreground' : 'text-muted-foreground',
              )}
            />
            <span className={cn('truncate', page === item.page ? 'font-medium' : 'font-normal')}>{item.label}</span>
          </Button>
        ))}
      </nav>

      <div className="mt-auto" />
    </aside>
  )
}
