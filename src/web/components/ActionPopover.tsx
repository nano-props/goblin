import { Loader2, MoreHorizontal } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '#/web/components/ui/button.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '#/web/components/ui/popover.tsx'
import { InlineShortcut } from '#/web/components/InlineShortcut.tsx'
import { cn } from '#/web/lib/cn.ts'

interface ActionPopoverProps {
  readonly label: string
  readonly open?: boolean
  readonly onOpenChange?: (open: boolean) => void
  readonly busy?: boolean
  readonly triggerClassName?: string
  readonly contentClassName?: string
  readonly children: ReactNode | ((state: ActionPopoverState) => ReactNode)
}

interface ActionPopoverState {
  readonly close: () => void
}

export function ActionPopover({
  label,
  open,
  onOpenChange,
  busy = false,
  triggerClassName,
  contentClassName,
  children,
}: ActionPopoverProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const effectiveOpen = open ?? internalOpen

  function setOpen(next: boolean) {
    if (open === undefined) setInternalOpen(next)
    onOpenChange?.(next)
  }

  function close() {
    setOpen(false)
  }

  return (
    <Popover open={effectiveOpen} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          data-action-popover-trigger=""
          variant="ghost"
          size="sm"
          title={label}
          aria-label={label}
          aria-busy={busy || undefined}
          onPointerDown={stopPropagation}
          onClick={stopPropagation}
          onDoubleClick={stopPropagation}
          className={triggerClassName}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className={cn('w-max min-w-48 max-w-72 overflow-hidden p-0', contentClassName)}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
        }}
        onPointerDown={stopPropagation}
        onClick={stopPropagation}
      >
        {typeof children === 'function' ? children({ close }) : children}
      </PopoverContent>
    </Popover>
  )
}

interface ActionPopoverItemProps {
  readonly label: string
  readonly title?: string
  readonly icon?: ReactNode
  readonly shortcut?: string
  readonly disabled?: boolean
  readonly busy?: boolean
  readonly destructive?: boolean
  readonly onSelect: () => void
}

export function ActionPopoverItem({
  label,
  title,
  icon,
  shortcut,
  disabled = false,
  busy = false,
  destructive = false,
  onSelect,
}: ActionPopoverItemProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onSelect}
      className={cn(
        'flex h-8 w-full cursor-pointer items-center gap-2 rounded-sm py-1 pl-2 pr-2 text-left text-sm outline-none transition-colors duration-100 hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50',
        'focus:bg-accent focus:text-accent-foreground',
        destructive && 'text-danger hover:bg-danger-surface hover:text-danger focus:bg-danger-surface focus:text-danger',
        shortcut && 'whitespace-nowrap',
      )}
    >
      {icon || busy ? (
        <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0">
          {busy ? <Loader2 size={16} className="animate-spin" /> : icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut ? <InlineShortcut shortcut={shortcut} /> : null}
    </button>
  )
}

function stopPropagation(event: { stopPropagation: () => void }) {
  event.stopPropagation()
}
