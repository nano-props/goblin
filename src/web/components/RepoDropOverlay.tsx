import { useT } from '#/web/stores/i18n.ts'
import { cn } from '#/web/lib/cn.ts'
interface RepoDropOverlayProps {
  active: boolean
}

export function RepoDropOverlay({ active }: RepoDropOverlayProps) {
  const t = useT()
  return (
    <div
      aria-hidden={!active}
      className={cn(
        'pointer-events-none absolute inset-2 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-brand bg-background/85 shadow-sm backdrop-blur-sm transition-opacity duration-200 ease-in-out',
        active ? 'opacity-100' : 'opacity-0',
      )}
    >
      <div className="rounded-lg border border-border bg-card p-4 text-center shadow-sm">
        <div className="text-sm font-semibold text-foreground">{t('drop.title')}</div>
        <div className="mt-1 text-xs text-muted-foreground">{t('drop.body')}</div>
      </div>
    </div>
  )
}
