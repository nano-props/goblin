import type { ButtonHTMLAttributes, FunctionalComponent, HTMLAttributes, VNodeChild } from 'vue'
import { CopyButton } from '#/web/components/CopyButton.tsx'
import { cn } from '#/web/lib/cn.ts'
import { STATUS_TONE_CHIP_CLASS, STATUS_TONE_TEXT_CLASS } from '#/web/components/ui/status-tones.ts'
import type { StatusTone } from '#/web/components/ui/status-tones.ts'

export type Tone = StatusTone
export type StatusRowValueLayout = 'inline' | 'fill' | 'chips'

export const STATUS_ROWS_CLASS = 'divide-y divide-separator/60 border-b border-separator/70'
export const STATUS_ROW_LAYOUT_CLASS = 'grid h-9 grid-cols-[1.25rem_5.75rem_minmax(0,1fr)] items-center gap-3 px-4'
const ROW_ICON_CLASS = 'flex size-5 items-center justify-center text-muted-foreground/75'
const ROW_LABEL_CLASS = 'truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/75'
const MONO_VALUE_CLASS = 'font-mono'
const INLINE_TRUNCATE_CLASS = 'block min-w-0 flex-1 truncate'
export const STATUS_INLINE_GROUP_CLASS = 'inline-flex max-w-full min-w-0 items-center gap-1.5 align-middle'
export const STATUS_CHIP_CLASS =
  'inline-flex h-5 shrink-0 cursor-default items-center gap-1 rounded-sm border px-1.5 text-[11px] font-normal leading-none'
const STATUS_ACTION_BASE_CLASS =
  'rounded-sm cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/60'
const STATUS_TEXT_LINK_CLASS = 'hover:underline underline-offset-2'
const ROW_VALUE_CLASS: Record<StatusRowValueLayout, string> = {
  inline: 'min-w-0 max-w-full text-sm text-foreground',
  fill: 'min-w-0 flex-1 text-sm text-foreground',
  chips: 'flex min-w-0 max-w-full flex-wrap items-center gap-1.5 text-sm text-foreground',
}

type StatusChipProps = HTMLAttributes & { tone?: Tone }

export const StatusChip: FunctionalComponent<StatusChipProps> = (props, { attrs, slots }) => {
  const { class: classValue, ...elementProps } = attrs as HTMLAttributes
  const tone = props.tone ?? 'neutral'
  return (
    <span {...elementProps} class={cn(STATUS_CHIP_CLASS, STATUS_TONE_CHIP_CLASS[tone], classValue)}>
      {slots.default?.()}
    </span>
  )
}

StatusChip.props = ['tone']
StatusChip.inheritAttrs = false

export type StatusActionProps = Omit<ButtonHTMLAttributes, 'type'> & {
  tone?: Tone
  mono?: boolean
  truncate?: boolean
  variant?: 'text' | 'chip'
}

export const StatusAction: FunctionalComponent<StatusActionProps> = (props, { attrs, slots }) => {
  const { tone, mono = false, truncate = false, variant = 'text' } = props
  const { class: classValue, ...buttonProps } = attrs as ButtonHTMLAttributes
  return (
    <button
      {...buttonProps}
      type="button"
      class={cn(
        STATUS_ACTION_BASE_CLASS,
        mono && MONO_VALUE_CLASS,
        truncate && INLINE_TRUNCATE_CLASS,
        variant === 'text' && STATUS_TEXT_LINK_CLASS,
        variant === 'text' && tone && STATUS_TONE_TEXT_CLASS[tone],
        variant === 'chip' && STATUS_CHIP_CLASS,
        variant === 'chip' && tone && STATUS_TONE_CHIP_CLASS[tone],
        variant === 'chip' && 'cursor-pointer',
        classValue,
      )}
    >
      {slots.default?.()}
    </button>
  )
}

StatusAction.props = ['tone', 'mono', 'truncate', 'variant']
StatusAction.inheritAttrs = false

type ClickableStatusChipProps = Omit<StatusActionProps, 'variant' | 'mono' | 'truncate'>

export const ClickableStatusChip: FunctionalComponent<ClickableStatusChipProps> = (props, { attrs, slots }) => (
  <StatusAction {...attrs} tone={props.tone} variant="chip">
    {slots.default?.()}
  </StatusAction>
)

ClickableStatusChip.props = ['tone']
ClickableStatusChip.inheritAttrs = false

export const StatusRows: FunctionalComponent = (_props, { slots }) => (
  <div role="list" class={STATUS_ROWS_CLASS}>
    {slots.default?.()}
  </div>
)

type StatusRowProps = Omit<HTMLAttributes, 'value'> & {
  icon: VNodeChild
  label: string
  value: VNodeChild
  valueLayout?: StatusRowValueLayout
  after?: VNodeChild
  tone?: Tone
}

export const StatusRow: FunctionalComponent<StatusRowProps> = (props, { attrs }) => {
  const { icon, label, value, valueLayout = 'inline', after, tone = 'neutral' } = props
  const { class: classValue, ...elementProps } = attrs as HTMLAttributes
  return (
    <div {...elementProps} role="listitem" class={cn(STATUS_ROW_LAYOUT_CLASS, classValue)}>
      <span class={cn(ROW_ICON_CLASS, STATUS_TONE_TEXT_CLASS[tone])}>{icon}</span>
      <span class={ROW_LABEL_CLASS}>{label}</span>
      <div class="flex min-w-0 items-center gap-2">
        <div class={ROW_VALUE_CLASS[valueLayout]}>{value}</div>
        {after ? <div class="flex shrink-0 items-center gap-1.5">{after}</div> : null}
      </div>
    </div>
  )
}

StatusRow.props = ['icon', 'label', 'value', 'valueLayout', 'after', 'tone']
StatusRow.inheritAttrs = false

export const MonoValue: FunctionalComponent<{
  title?: string
  tone?: Tone
  truncate?: boolean
}> = (props, { slots }) => (
  <span
    class={cn(
      MONO_VALUE_CLASS,
      props.truncate && INLINE_TRUNCATE_CLASS,
      props.tone && STATUS_TONE_TEXT_CLASS[props.tone],
    )}
    title={props.title}
  >
    {slots.default?.()}
  </span>
)

MonoValue.props = ['title', 'tone', 'truncate']

export const StatusLink: FunctionalComponent<Omit<StatusActionProps, 'variant'>> = (props, { attrs, slots }) => (
  <StatusAction {...attrs} tone={props.tone} mono={props.mono} truncate={props.truncate}>
    {slots.default?.()}
  </StatusAction>
)

StatusLink.props = ['tone', 'mono', 'truncate']
StatusLink.inheritAttrs = false

export const CopyableValue: FunctionalComponent<{
  value: string
  copyValue?: string
  copyLabel: string
  copiedLabel: string
}> = (props) => (
  <div class={STATUS_INLINE_GROUP_CLASS}>
    <MonoValue title={props.value} truncate>
      {props.value}
    </MonoValue>
    <CopyButton
      value={props.copyValue ?? props.value}
      copyLabel={props.copyLabel}
      copiedLabel={props.copiedLabel}
      class="shrink-0"
    />
  </div>
)

CopyableValue.props = ['value', 'copyValue', 'copyLabel', 'copiedLabel']
