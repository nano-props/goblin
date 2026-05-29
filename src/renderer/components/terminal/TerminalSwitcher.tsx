import { Plus, Terminal as TerminalIcon, Trash2 } from 'lucide-react'
import { Badge } from '#/renderer/components/ui/badge.tsx'
import { Button } from '#/renderer/components/ui/button.tsx'
import { ScrollArea } from '#/renderer/components/ui/scroll-area.tsx'
import { useT } from '#/renderer/stores/i18n.ts'
import { cn } from '#/renderer/lib/cn.ts'
import type { TerminalSessionSummary } from '#/renderer/components/terminal/types.ts'

interface TerminalSwitcherProps {
  groupKey: string
  sessions: TerminalSessionSummary[]
  offsetForSearch: boolean
  onNew: () => void
  onSelect: (groupKey: string, key: string) => void
  onClose: (key: string) => void
}

export function TerminalSwitcher({
  groupKey,
  sessions,
  offsetForSearch,
  onNew,
  onSelect,
  onClose,
}: TerminalSwitcherProps) {
  const t = useT()
  const unreadCount = sessions.filter((session) => session.hasBell).length
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
          <div role="list">
            {sessions.map((session) => (
              <div
                key={session.key}
                role="listitem"
                className={cn(
                  'goblin-terminal-switcher__row',
                  session.active && 'goblin-terminal-switcher__row--active',
                )}
              >
                <button
                  type="button"
                  className="goblin-terminal-switcher__select"
                  onClick={() => onSelect(groupKey, session.key)}
                  title={session.title}
                  aria-label={session.title}
                  aria-current={session.active ? 'true' : undefined}
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
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
