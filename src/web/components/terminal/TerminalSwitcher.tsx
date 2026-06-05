import { useEffect, useRef } from 'react'
import { Plus, Terminal as TerminalIcon, Trash2 } from 'lucide-react'
import { Badge } from '#/web/components/ui/badge.tsx'
import { Button } from '#/web/components/ui/button.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { TerminalSwitcherTooltipLayer } from '#/web/components/terminal/TerminalSwitcherTooltipLayer.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { cn } from '#/web/lib/cn.ts'
import type { TerminalSessionSummary } from '#/web/components/terminal/types.ts'
interface TerminalSwitcherProps {
  worktreeTerminalKey: string
  sessions: TerminalSessionSummary[]
  offsetForSearch: boolean
  onNew: () => void
  onSelect: (worktreeTerminalKey: string, key: string) => void
  onScrollToBottom: (key: string) => void
  onClose: (key: string) => void
}

export function TerminalSwitcher({
  worktreeTerminalKey,
  sessions,
  offsetForSearch,
  onNew,
  onSelect,
  onScrollToBottom,
  onClose,
}: TerminalSwitcherProps) {
  const t = useT()
  const selectedRowRef = useRef<HTMLDivElement>(null)
  const previousSelectedKeyRef = useRef<string | null>(null)
  const unreadCount = sessions.filter((session) => session.hasBell).length
  const selectedKey = sessions.find((session) => session.selected)?.key ?? null

  useEffect(() => {
    if (!selectedKey) {
      previousSelectedKeyRef.current = null
      return
    }

    const previousSelectedKey = previousSelectedKeyRef.current
    const selectionChanged = previousSelectedKey !== null && previousSelectedKey !== selectedKey

    if (selectionChanged && typeof selectedRowRef.current?.scrollIntoView === 'function') {
      selectedRowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }

    previousSelectedKeyRef.current = selectedKey
  }, [selectedKey])
  return (
    <div
      className={cn('goblin-terminal-switcher', offsetForSearch && 'goblin-terminal-switcher--below-search')}
      role="region"
      aria-label={t('terminal.sessions')}
    >
      <div className="goblin-terminal-switcher__header">
        <div className="goblin-terminal-switcher__title-wrap">
          <span className="goblin-terminal-switcher__title">{t('terminal.sessions')}</span>
          {unreadCount > 0 && (
            <Badge
              variant="attention"
              size="xs"
              className="goblin-terminal-switcher__badge"
              title={t('terminal.bell-unread-count', { count: unreadCount })}
              aria-label={t('terminal.bell-unread-count', { count: unreadCount })}
            >
              {unreadCount}
            </Badge>
          )}
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onNew}
          title={t('terminal.new')}
          aria-label={t('terminal.new')}
        >
          <Plus size={14} />
        </Button>
      </div>
      <ScrollArea
        className="goblin-terminal-switcher__list"
        scrollbarMode="compact"
        viewportClassName="goblin-terminal-switcher__viewport [&>div]:!block"
      >
        {sessions.length === 0 ? (
          <button type="button" className="goblin-terminal-switcher__empty" onClick={onNew}>
            {t('terminal.new')}
          </button>
        ) : (
          <TerminalSwitcherTooltipLayer sessions={sessions} role="list">
            {sessions.map((session) => {
              const fullTitle = session.fullTitle ?? session.title
              return (
                <div
                  key={session.key}
                  ref={session.selected ? selectedRowRef : undefined}
                  role="listitem"
                  className="goblin-terminal-switcher__row"
                  data-selected={session.selected ? 'true' : undefined}
                >
                  <button
                    type="button"
                    className="goblin-terminal-switcher__select"
                    onClick={() => onSelect(worktreeTerminalKey, session.key)}
                    onDoubleClick={() => {
                      if (session.selected) onScrollToBottom(session.key)
                    }}
                    data-terminal-switcher-tooltip-id={session.key}
                    aria-label={fullTitle}
                    aria-current={session.selected ? 'true' : undefined}
                  >
                    <TerminalIcon size={16} />
                    <span>{session.title}</span>
                    {session.hasBell && (
                      <>
                        <span className="goblin-terminal-switcher__bell-dot" aria-hidden="true" />
                        <span className="sr-only">{t('terminal.bell-unread')}</span>
                      </>
                    )}
                  </button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="goblin-terminal-switcher__close"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation()
                      onClose(session.key)
                    }}
                    title={t('terminal.close')}
                    aria-label={t('terminal.close')}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              )
            })}
          </TerminalSwitcherTooltipLayer>
        )}
      </ScrollArea>
    </div>
  )
}
