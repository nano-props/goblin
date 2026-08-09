import type { LucideIcon } from '@lucide/vue'
import type { FunctionalComponent } from 'vue'
import { cn } from '#/web/lib/cn.ts'

export type DashboardTone = 'default' | 'attention' | 'success'

export const DASHBOARD_CARD_CLASS = 'rounded-lg border border-border/60 bg-card shadow-xs'

interface DashboardMetricCardProps {
  icon: LucideIcon
  label: string
  value: string | number
  valueClass?: string
  valueTitle?: string
  detail?: string
  tone?: DashboardTone
}

export const DashboardMetricCard: FunctionalComponent<DashboardMetricCardProps> = (props) => {
  const Icon = props.icon
  return (
    <div class={cn(DASHBOARD_CARD_CLASS, 'flex min-h-14 items-center gap-2 px-2.5 py-2')}>
      <div class="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted/45">
        <Icon size={14} class={metricToneClass(props.tone ?? 'default')} />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-baseline gap-2">
          <div class="truncate text-xs font-medium text-muted-foreground">{props.label}</div>
          <div
            class={cn('shrink-0 text-lg font-semibold leading-none text-foreground', props.valueClass)}
            title={props.valueTitle}
          >
            {props.value}
          </div>
        </div>
        <div class="mt-0.5 min-h-4 truncate text-[11px] text-muted-foreground">{props.detail}</div>
      </div>
    </div>
  )
}

DashboardMetricCard.props = ['icon', 'label', 'value', 'valueClass', 'valueTitle', 'detail', 'tone']

interface DashboardSectionProps {
  title: string
  description: string
}

export const DashboardSection: FunctionalComponent<DashboardSectionProps> = (props, { slots }) => (
  <section class={cn(DASHBOARD_CARD_CLASS, 'overflow-hidden')}>
    <div class="flex min-w-0 flex-col gap-0.5 border-b border-separator px-3 py-2.5 sm:flex-row sm:items-baseline sm:gap-2">
      <h2 class="shrink-0 text-[13px] font-semibold text-foreground">{props.title}</h2>
      <div class="min-w-0 truncate text-[11px] text-muted-foreground">{props.description}</div>
    </div>
    {slots.default?.()}
  </section>
)

DashboardSection.props = ['title', 'description']

interface DashboardEmptySectionProps {
  icon: LucideIcon
  label: string
}

export const DashboardEmptySection: FunctionalComponent<DashboardEmptySectionProps> = (props) => {
  const Icon = props.icon
  return (
    <div class="flex min-h-24 flex-col items-center justify-center gap-2 px-4 py-6 text-center text-sm text-muted-foreground">
      <Icon size={16} />
      <span>{props.label}</span>
    </div>
  )
}

DashboardEmptySection.props = ['icon', 'label']

function metricToneClass(tone: DashboardTone): string {
  if (tone === 'attention') return 'text-attention'
  if (tone === 'success') return 'text-success'
  return 'text-brand-text'
}
