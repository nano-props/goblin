import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/web/components/ui/select.tsx'
import { useIsCompactUi } from '#/web/hooks/useResponsiveUiMode.tsx'
import { cn } from '#/web/lib/cn.ts'

type SettingsCardProps<T extends ElementType = 'div'> = {
  as?: T
  className?: string
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'className'>

type SettingsListItemProps<T extends ElementType = 'div'> = {
  as?: T
  className?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  separated?: boolean
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'className'>
export function SettingsGroup({
  label,
  hint,
  action,
  children,
}: {
  label: ReactNode
  hint?: string
  action?: ReactNode
  children: ReactNode
}) {
  const compact = useIsCompactUi()
  return (
    <section className="space-y-1.5">
      <div className={cn('flex justify-between gap-3 px-3', compact ? 'items-start' : 'items-center')}>
        <h2 className="text-[11px] font-medium text-muted-foreground">{label}</h2>
        {action}
      </div>
      {hint && <div className="px-3 text-[11px] leading-snug text-muted-foreground/80">{hint}</div>}
      {children}
    </section>
  )
}

export function SettingsCard<T extends ElementType = 'div'>({ as, className, ...props }: SettingsCardProps<T>) {
  const Comp = (as ?? 'div') as ElementType
  return (
    <Comp
      className={cn(
        'overflow-hidden rounded-xl border border-border/60 bg-background/85 shadow-[var(--shadow-inset-highlight)]',
        className,
      )}
      {...props}
    />
  )
}

export function SettingsList({ children }: { children: ReactNode }) {
  return <SettingsCard>{children}</SettingsCard>
}

export function SettingsListItem<T extends ElementType = 'div'>({
  as,
  className,
  size = 'md',
  separated = true,
  ...props
}: SettingsListItemProps<T>) {
  const Comp = (as ?? 'div') as ElementType
  return (
    <Comp
      className={cn(
        'flex min-w-0 items-center justify-between',
        separated && '[&+&]:border-t [&+&]:border-separator',
        size === 'sm' && 'min-h-9 gap-3 px-3 py-1.5',
        size === 'md' && 'min-h-11 gap-4 px-3 py-2',
        size === 'lg' && 'min-h-12 gap-4 px-4 py-2.5',
        size === 'xl' && 'min-h-14 gap-3 px-4 py-2.5',
        className,
      )}
      {...props}
    />
  )
}

export function SettingsRow({
  controlId,
  label,
  hint,
  control,
}: {
  controlId: string
  label: ReactNode
  hint?: string
  control: ReactNode
}) {
  const compact = useIsCompactUi()
  return (
    <SettingsListItem size="lg" className={cn(compact && 'flex-col items-stretch justify-start gap-2')}>
      <div className="min-w-0 flex-1 overflow-hidden">
        <label className="block truncate text-sm text-foreground" htmlFor={controlId}>
          {label}
        </label>
        {hint && <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</div>}
      </div>
      <div className={cn('min-w-0', compact ? 'w-full' : 'shrink-0')}>{control}</div>
    </SettingsListItem>
  )
}

interface SettingsSelectProps<T extends string | number> {
  id: string
  value: T
  options: { value: T; label: string; icon?: ReactNode }[]
  onChange: (value: T) => void
}

export function SettingsSelect<T extends string | number>({ id, value, options, onChange }: SettingsSelectProps<T>) {
  const compact = useIsCompactUi()
  const optionsSignature = options.map((opt) => `${String(opt.value)}:${opt.label}`).join('|')
  return (
    <Select
      key={optionsSignature}
      value={String(value)}
      onValueChange={(v) => {
        const matched = options.find((o) => String(o.value) === v)
        if (matched) onChange(matched.value)
      }}
    >
      <SelectTrigger
        id={id}
        className={cn('h-8 rounded-md bg-control px-2.5 text-xs shadow-none', compact ? 'w-full min-w-0' : 'min-w-36')}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={String(opt.value)} value={String(opt.value)} textValue={opt.label}>
            {opt.icon}
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
