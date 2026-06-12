import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { CopyButton } from '#/web/components/CopyButton.tsx'
import { cn } from '#/web/lib/cn.ts'
import { STATUS_TONE_CHIP_CLASS, STATUS_TONE_TEXT_CLASS, type StatusTone } from '#/web/components/ui/status-tones.ts'
export type Tone = StatusTone
export type StatusRowValueLayout = 'inline' | 'fill' | 'chips'

const ROW_CLASS = 'grid h-9 grid-cols-[1.25rem_5.75rem_minmax(0,1fr)] items-center gap-3 px-4'
const ROW_ICON_CLASS = 'flex size-5 items-center justify-center'
const ROW_LABEL_CLASS = 'truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'
const MONO_VALUE_CLASS = 'font-mono'
const INLINE_TRUNCATE_CLASS = 'block min-w-0 flex-1 truncate'
export const STATUS_INLINE_GROUP_CLASS = 'inline-flex max-w-full min-w-0 items-center gap-1.5 align-middle'
export const STATUS_CHIP_CLASS =
  'inline-flex h-5 shrink-0 cursor-default items-center gap-1 rounded-sm border px-1.5 text-[11px] font-medium leading-none'
const ROW_VALUE_CLASS: Record<StatusRowValueLayout, string> = {
  inline: 'min-w-0 max-w-full text-sm text-foreground',
  fill: 'min-w-0 flex-1 text-sm text-foreground',
  chips: 'flex min-w-0 max-w-full flex-wrap items-center gap-1.5 text-sm text-foreground',
}
type StatusChipProps = ComponentPropsWithoutRef<'span'> & {
  tone?: Tone
}

export const StatusChip = forwardRef<HTMLSpanElement, StatusChipProps>(function StatusChip(
  { children, className, tone = 'neutral', ...props },
  ref,
) {
  return (
    <span ref={ref} {...props} className={cn(STATUS_CHIP_CLASS, STATUS_TONE_CHIP_CLASS[tone], className)}>
      {children}
    </span>
  )
})

export function StatusRows({ children }: { children: ReactNode }) {
  return (
    <div role="list" className="divide-y divide-separator border-b border-separator">
      {children}
    </div>
  )
}

type StatusRowProps = Omit<ComponentPropsWithoutRef<'div'>, 'value'> & {
  icon: ReactNode
  label: string
  value: ReactNode
  valueLayout?: StatusRowValueLayout
  after?: ReactNode
  tone?: Tone
}

export const StatusRow = forwardRef<HTMLDivElement, StatusRowProps>(function StatusRow(
  { icon, label, value, valueLayout = 'inline', after, tone = 'neutral', className, ...props },
  ref,
) {
  return (
    <div ref={ref} role="listitem" className={cn(ROW_CLASS, className)} {...props}>
      <span className={cn(ROW_ICON_CLASS, STATUS_TONE_TEXT_CLASS[tone])}>{icon}</span>
      <span className={ROW_LABEL_CLASS}>{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        <div className={ROW_VALUE_CLASS[valueLayout]}>{value}</div>
        {after && <div className="flex shrink-0 items-center gap-1.5">{after}</div>}
      </div>
    </div>
  )
})

export function MonoValue({
  children,
  title,
  tone,
  truncate = false,
}: {
  children: ReactNode
  title?: string
  tone?: Tone
  truncate?: boolean
}) {
  return (
    <span
      className={cn(MONO_VALUE_CLASS, truncate && INLINE_TRUNCATE_CLASS, tone && STATUS_TONE_TEXT_CLASS[tone])}
      title={title}
    >
      {children}
    </span>
  )
}

export function CopyableValue({
  value,
  copyValue = value,
  copyLabel,
  copiedLabel,
}: {
  value: string
  copyValue?: string
  copyLabel: string
  copiedLabel: string
}) {
  return (
    <div className={STATUS_INLINE_GROUP_CLASS}>
      <MonoValue title={value} truncate>
        {value}
      </MonoValue>
      <CopyButton value={copyValue} copyLabel={copyLabel} copiedLabel={copiedLabel} className="shrink-0" />
    </div>
  )
}
