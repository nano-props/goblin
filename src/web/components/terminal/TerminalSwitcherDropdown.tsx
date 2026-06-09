import { useCallback, useState, useEffect } from 'react'
import { ChevronDown, Plus, Terminal as TerminalIcon, Trash2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/web/components/ui/dropdown-menu.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { Badge } from '#/web/components/ui/badge.tsx'
import { cn } from '#/web/lib/cn.ts'
import { useT } from '#/web/stores/i18n.ts'
import type { TerminalSessionSummary } from '#/web/components/terminal/types.ts'

interface TerminalSwitcherDropdownProps {
  worktreeTerminalKey: string
  sessions: TerminalSessionSummary[]
  onNew: () => void
  onSelect: (worktreeTerminalKey: string, key: string) => void
  onScrollToBottom: (key: string) => void
  onClose: (key: string) => void
}

export function TerminalSwitcherDropdown({
  worktreeTerminalKey,
  sessions,
  onNew,
  onSelect,
  onScrollToBottom,
  onClose,
}: TerminalSwitcherDropdownProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const selectedSession = sessions.find((s) => s.selected)
  const unreadCount = sessions.filter((s) => s.hasBell).length
  const hasSessions = sessions.length > 0

  useEffect(() => {
    if (!hasSessions) setOpen(false)
  }, [hasSessions])

  const handleSelect = useCallback(
    (key: string) => {
      const session = sessions.find((s) => s.key === key)
      if (!session) return
      if (session.selected) {
        onScrollToBottom(key)
      } else {
        onSelect(worktreeTerminalKey, key)
      }
    },
    [sessions, onSelect, onScrollToBottom, worktreeTerminalKey],
  )

  const handleClose = useCallback(
    (event: React.MouseEvent, key: string) => {
      event.preventDefault()
      event.stopPropagation()
      onClose(key)
    },
    [onClose],
  )

  const triggerLabel = selectedSession ? selectedSession.title : t('terminal.sessions')
  const triggerFullLabel = selectedSession?.fullTitle ?? triggerLabel

  const triggerButton = (
    <Button
      type="button"
      variant="ghost"
      className="h-7 gap-1.5 px-2 text-sm font-normal max-w-[10rem]"
      title={triggerFullLabel}
      aria-label={triggerFullLabel}
    >
      <TerminalIcon size={14} />
      <span className="truncate">{triggerLabel}</span>
      {unreadCount > 0 && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-attention opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-attention" />
        </span>
      )}
      {sessions.length > 1 && (
        <Badge variant="outline" className="h-4 px-1 text-[10px] font-mono font-normal text-muted-foreground">
          {sessions.length}
        </Badge>
      )}
      <ChevronDown size={14} />
    </Button>
  )

  return (
    <>
      {hasSessions ? (
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>{triggerButton}</DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-44 max-h-[200px]">
            {sessions.map((session) => {
              const fullTitle = session.fullTitle ?? session.title
              return (
                <div
                  key={session.key}
                  className="group relative flex items-center"
                  data-selected={session.selected ? 'true' : undefined}
                >
                  <DropdownMenuItem
                    className={cn(
                      'min-w-0 flex-1 gap-2 pr-8',
                      session.selected && 'bg-accent/40 text-accent-foreground',
                    )}
                    title={fullTitle}
                    onSelect={() => handleSelect(session.key)}
                    aria-label={fullTitle}
                    aria-current={session.selected ? 'true' : undefined}
                  >
                    <TerminalIcon size={14} className="shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{session.title}</span>
                    {session.hasBell && (
                      <>
                        <span className="h-2 w-2 shrink-0 rounded-full bg-attention" aria-hidden="true" />
                        <span className="sr-only">{t('terminal.bell-unread')}</span>
                      </>
                    )}
                  </DropdownMenuItem>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="absolute right-1 h-6 w-6 text-muted-foreground"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => handleClose(event, session.key)}
                    title={t('terminal.close')}
                    aria-label={t('terminal.close')}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              )
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2" onSelect={onNew}>
              <Plus size={14} />
              {t('terminal.new')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          type="button"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-sm font-normal"
          title={t('terminal.new')}
          onClick={onNew}
          aria-label={t('terminal.new')}
        >
          <Plus size={14} />
          <span className="truncate">{t('terminal.new')}</span>
        </Button>
      )}
    </>
  )
}
