import type { ComponentProps, ReactNode } from 'react'
import { CopyButton } from '#/web/components/CopyButton.tsx'
import { cn } from '#/web/lib/cn.ts'
import { STATUS_TONE_CHIP_CLASS, STATUS_TONE_TEXT_CLASS, type StatusTone } from '#/web/components/ui/status-tones.ts'
export type Tone = StatusTone
export type StatusRowValueLayout = 'inline' | 'fill' | 'chips'

const ROW_CLASS = 'grid h-9 grid-cols-[1.25rem_5.75rem_minmax(0,1fr)] items-center gap-3 px-4'
const ROW_ICON_CLASS = 'flex size-5 items-center justify-center text-muted-foreground/75'
const ROW_LABEL_CLASS = 'truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/75'
const MONO_VALUE_CLASS = 'font-mono'
const INLINE_TRUNCATE_CLASS = 'block min-w-0 flex-1 truncate'
export const STATUS_INLINE_GROUP_CLASS = 'inline-flex max-w-full min-w-0 items-center gap-1.5 align-middle'
export const STATUS_CHIP_CLASS =
  'inline-flex h-5 shrink-0 cursor-default items-center gap-1 rounded-sm border px-1.5 text-[11px] font-normal leading-none'
const STATUS_ACTION_BASE_CLASS = 'rounded-sm cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/60'
const STATUS_TEXT_LINK_CLASS = 'hover:underline underline-offset-2'
const ROW_VALUE_CLASS: Record<StatusRowValueLayout, string> = {
  inline: 'min-w-0 max-w-full text-sm text-foreground',
  fill: 'min-w-0 flex-1 text-sm text-foreground',
  chips: 'flex min-w-0 max-w-full flex-wrap items-center gap-1.5 text-sm text-foreground',
}
type StatusChipProps = ComponentProps<'span'> & {
  tone?: Tone
}

export function StatusChip({ children, className, tone = 'neutral', ref, ...props }: StatusChipProps) {
  return (
    <span ref={ref} {...props} className={cn(STATUS_CHIP_CLASS, STATUS_TONE_CHIP_CLASS[tone], className)}>
      {children}
    </span>
  )
}

type StatusActionProps = Omit<ComponentProps<'button'>, 'type'> & {
  tone?: Tone
  mono?: boolean
  truncate?: boolean
  variant?: 'text' | 'chip'
}

export function StatusAction({
  children,
  className,
  tone,
  mono = false,
  truncate = false,
  variant = 'text',
  ref,
  ...props
}: StatusActionProps) {
  return (
    <button
      ref={ref}
      type="button"
      {...props}
      className={cn(
        STATUS_ACTION_BASE_CLASS,
        mono && MONO_VALUE_CLASS,
        truncate && INLINE_TRUNCATE_CLASS,
        variant === 'text' && STATUS_TEXT_LINK_CLASS,
        variant === 'text' && tone && STATUS_TONE_TEXT_CLASS[tone],
        variant === 'chip' && STATUS_CHIP_CLASS,
        variant === 'chip' && STATUS_TONE_CHIP_CLASS[tone],
        variant === 'chip' && 'cursor-pointer',
        className,
      )}
    >
      {children}
    </button>
  )
}

type ClickableStatusChipProps = Omit<StatusActionProps, 'variant' | 'mono' | 'truncate'>

export function ClickableStatusChip(props: ClickableStatusChipProps) {
  return <StatusAction variant="chip" {...props} />
}

export function StatusRows({ children }: { children: ReactNode }) {
  return (
    <div role="list" className="divide-y divide-separator/60 border-b border-separator/70">
      {children}
    </div>
  )
}

type StatusRowProps = Omit<ComponentProps<'div'>, 'value'> & {
  icon: ReactNode
  label: string
  value: ReactNode
  valueLayout?: StatusRowValueLayout
  after?: ReactNode
  tone?: Tone
}

export function StatusRow({
  icon,
  label,
  value,
  valueLayout = 'inline',
  after,
  tone = 'neutral',
  className,
  ref,
  ...props
}: StatusRowProps) {
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
}

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

type StatusLinkProps = Omit<StatusActionProps, 'variant'>

export function StatusLink(props: StatusLinkProps) {
  return <StatusAction {...props} />
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
