import { Button } from '#/web/components/ui/button.tsx'
import { cn } from '#/web/lib/cn.ts'

interface Props {
  message: string
  tone?: 'default' | 'danger' | 'success'
  actionLabel?: string
  onAction?: () => void
}

function DialogStatusRow({ message, tone = 'default', actionLabel, onAction }: Props) {
  return (
    <div data-slot="dialog-status-row" aria-live="polite" aria-atomic="true" className="flex min-h-4 items-center gap-2 overflow-hidden">
      <div
        data-slot="dialog-status-text"
        className={cn(
          'min-w-0 flex-1 truncate text-xs leading-4',
          !message && 'invisible',
          tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-muted-foreground',
        )}
      >
        {message}
      </div>
      {actionLabel && onAction ? (
        <Button type="button" variant="link" size="sm" className="h-auto shrink-0 px-0 text-xs" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}

export { DialogStatusRow }
