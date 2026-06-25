import { useT } from '#/web/stores/i18n.ts'

export function TerminalBellBadge({ count }: { count: number }) {
  const t = useT()
  if (count <= 0) return null
  const label = t('terminal.bell-unread-count', { count })
  const displayCount = count > 99 ? '99+' : String(count)
  return (
    <span
      aria-label={label}
      title={label}
      className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-notification px-1 font-mono text-[10px] font-semibold leading-none text-notification-foreground tabular-nums"
    >
      {displayCount}
    </span>
  )
}
