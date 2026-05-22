import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { CopyButton } from '#/renderer/components/CopyButton.tsx'
import { cn } from '#/renderer/lib/cn.ts'

export type Tone = 'neutral' | 'success' | 'warning' | 'brand'

const ROW_CLASS = 'grid h-9 grid-cols-[1.25rem_5.75rem_minmax(0,1fr)] items-center gap-3 px-4'
const ROW_ICON_CLASS = 'flex size-5 items-center justify-center'
const ROW_LABEL_CLASS = 'truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'
const ROW_VALUE_CLASS = 'min-w-0 flex-1 text-sm text-foreground'
const MONO_VALUE_CLASS = 'font-mono'
const INLINE_TRUNCATE_CLASS = 'block min-w-0 flex-1 truncate'
const TONE_TEXT_CLASS: Record<Tone, string> = {
  neutral: 'text-muted-foreground',
  success: 'text-success',
  warning: 'text-warning',
  brand: 'text-brand-text',
}
const TONE_SURFACE_CLASS: Record<Tone, string> = {
  neutral: 'border-border bg-muted text-muted-foreground',
  success: 'border-success/25 bg-success-surface text-success',
  warning: 'border-warning/25 bg-warning-surface text-warning',
  brand: 'border-brand/25 bg-brand-surface text-brand-text',
}

type StatusChipProps = ComponentPropsWithoutRef<'span'> & {
  tone?: Tone
}

export const StatusChip = forwardRef<HTMLSpanElement, StatusChipProps>(function StatusChip(
  { children, className, tone = 'neutral', ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      {...props}
      className={cn(
        'inline-flex h-5 shrink-0 cursor-default items-center gap-1 rounded-sm border px-1.5 text-[11px] font-medium leading-none',
        TONE_SURFACE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  )
})

export function StatusRows({ children }: { children: ReactNode }) {
  return (
    <div role="list" className="divide-y divide-border border-b border-border">
      {children}
    </div>
  )
}

type StatusRowProps = Omit<ComponentPropsWithoutRef<'div'>, 'value'> & {
  icon: ReactNode
  label: string
  value: ReactNode
  after?: ReactNode
  tone?: Tone
}

export const StatusRow = forwardRef<HTMLDivElement, StatusRowProps>(function StatusRow(
  { icon, label, value, after, tone = 'neutral', className, ...props },
  ref,
) {
  return (
    <div ref={ref} role="listitem" className={cn(ROW_CLASS, className)} {...props}>
      <span className={cn(ROW_ICON_CLASS, TONE_TEXT_CLASS[tone])}>{icon}</span>
      <span className={ROW_LABEL_CLASS}>{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        <div className={ROW_VALUE_CLASS}>{value}</div>
        {after && <div className="flex shrink-0 items-center gap-1.5">{after}</div>}
      </div>
    </div>
  )
})

export function MonoValue({
  children,
  title,
  tone,
  fill = false,
}: {
  children: ReactNode
  title?: string
  tone?: Tone
  fill?: boolean
}) {
  return (
    <span className={cn(MONO_VALUE_CLASS, fill && INLINE_TRUNCATE_CLASS, tone && TONE_TEXT_CLASS[tone])} title={title}>
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
    <div className="flex min-w-0 items-center gap-1.5">
      <MonoValue title={value} fill>
        {value}
      </MonoValue>
      <CopyButton value={copyValue} copyLabel={copyLabel} copiedLabel={copiedLabel} className="shrink-0" />
    </div>
  )
}
