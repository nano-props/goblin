import type { LucideIcon } from 'lucide-react'
import { cn } from '#/web/lib/cn.ts'

export type DashboardTone = 'default' | 'attention' | 'success'

export const DASHBOARD_CARD_CLASS_NAME =
  'rounded-lg border border-border/60 bg-card shadow-[var(--shadow-inset-highlight)]'

export function DashboardMetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'default',
}: {
  icon: LucideIcon
  label: string
  value: string | number
  detail: string
  tone?: DashboardTone
}) {
  return (
    <div className={cn(DASHBOARD_CARD_CLASS_NAME, 'flex min-h-14 items-center gap-2 px-2.5 py-2')}>
      <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted/45">
        <Icon size={14} className={metricToneClass(tone)} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <div className="truncate text-xs font-medium text-muted-foreground">{label}</div>
          <div className="shrink-0 text-lg font-semibold leading-none text-foreground">{value}</div>
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{detail}</div>
      </div>
    </div>
  )
}

function metricToneClass(tone: DashboardTone) {
  if (tone === 'attention') return 'text-attention'
  if (tone === 'success') return 'text-success'
  return 'text-brand-text'
}
