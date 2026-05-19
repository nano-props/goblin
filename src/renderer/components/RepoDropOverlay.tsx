import { useT } from '#/renderer/stores/i18n.ts'

export function RepoDropOverlay() {
  const t = useT()
  return (
    <div className="pointer-events-none absolute inset-2 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-brand bg-background/85 shadow-sm backdrop-blur-sm">
      <div className="rounded-lg border border-border bg-card px-5 py-4 text-center shadow-sm">
        <div className="text-sm font-semibold text-foreground">{t('drop.title')}</div>
        <div className="mt-1 text-xs text-muted-foreground">{t('drop.body')}</div>
      </div>
    </div>
  )
}
