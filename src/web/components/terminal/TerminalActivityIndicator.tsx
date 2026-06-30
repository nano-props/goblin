import { AppleTerminalIcon } from '#/web/components/ExternalAppIcon/AppleTerminalIcon.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { cn } from '#/web/lib/cn.ts'

export function TerminalActivityIndicator({ className }: { className?: string }) {
  const t = useT()
  const label = t('terminal.active')
  return (
    <span
      aria-label={label}
      title={label}
      role="img"
      data-testid="terminal-activity-indicator"
      className={cn(
        'goblin-terminal-activity-indicator inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground',
        className,
      )}
    >
      <span className="goblin-terminal-activity-indicator__icon-wrap">
        <AppleTerminalIcon className="size-4" />
      </span>
    </span>
  )
}
