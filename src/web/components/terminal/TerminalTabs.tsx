import { Plus, X, ChevronDown } from 'lucide-react'
import { useCallback } from 'react'
import { cn } from '#/web/lib/cn.ts'
import { Button } from '#/web/components/ui/button.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/web/components/ui/dropdown-menu.tsx'
import { DelegatedTooltipLayer, DELEGATED_TOOLTIP_DEFAULTS } from '#/web/components/DelegatedTooltipLayer.tsx'
import { TOOLTIP_META_TEXT_CLASS } from '#/web/components/ui/tooltip.tsx'
import { useT } from '#/web/stores/i18n.ts'
import { useOverflowCollapse } from '#/web/hooks/useOverflowCollapse.ts'
import type { TerminalSessionSummary } from '#/web/components/terminal/types.ts'

interface TerminalTabsProps {
  worktreeTerminalKey: string
  sessions: TerminalSessionSummary[]
  detailId?: string
  compact?: boolean
  panelActive?: boolean
  onNew: () => void
  onSelect: (worktreeTerminalKey: string, key: string) => void
  onScrollToBottom: (key: string) => void
  onClose: (key: string) => void
}

const TERMINAL_TAB_TOOLTIP_SELECTOR = '[data-terminal-tab-tooltip-id]'

export function TerminalTabs({
  worktreeTerminalKey,
  sessions,
  detailId,
  compact,
  panelActive,
  onNew,
  onSelect,
  onScrollToBottom,
  onClose,
}: TerminalTabsProps) {
  const t = useT()
  const layoutKey = sessions.map((s) => `${s.key}:${s.title}`).join('|')
  const { containerRef, measureRef, collapsed: autoCompact } = useOverflowCollapse(layoutKey)
  const useCompact = compact || autoCompact
  const activeSession = sessions.find((s) => s.selected) ?? sessions[0]
  const overflowSessions = sessions.filter((s) => s.key !== activeSession.key)

  const handleSelect = useCallback(
    (key: string) => {
      const session = sessions.find((s) => s.key === key)
      if (!session) return
      if (session.selected && panelActive) {
        onScrollToBottom(key)
      } else {
        onSelect(worktreeTerminalKey, key)
      }
    },
    [sessions, onSelect, onScrollToBottom, worktreeTerminalKey, panelActive],
  )

  const handleClose = useCallback(
    (event: React.MouseEvent, key: string) => {
      event.preventDefault()
      event.stopPropagation()
      onClose(key)
    },
    [onClose],
  )

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, sessionKey: string) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return
      e.preventDefault()
      const keys = sessions.map((s) => s.key)
      const idx = keys.indexOf(sessionKey)
      const nextIdx =
        e.key === 'ArrowLeft'
          ? (idx - 1 + keys.length) % keys.length
          : e.key === 'ArrowRight'
            ? (idx + 1) % keys.length
            : e.key === 'Home'
              ? 0
              : keys.length - 1
      const nextKey = keys[nextIdx]
      if (nextKey) {
        // Keep the first tab id stable for backward compatibility; others use the keyed id.
        const suffix = nextIdx === 0 ? '' : `-${nextKey}`
        document.getElementById(`${detailId}-terminal-tab${suffix}`)?.focus()
      }
    },
    [sessions, detailId],
  )

  if (sessions.length === 0) {
    return (
      <Button
        type="button"
        variant="ghost"
        className="h-7 px-2.5 text-sm font-normal"
        id={detailId ? `${detailId}-terminal-tab` : undefined}
        onClick={onNew}
        aria-label={t('terminal.new')}
        title={t('terminal.new')}
      >
        {t('terminal.label')}
      </Button>
    )
  }

  function renderTab(session: TerminalSessionSummary, index: number) {
    const isActive = panelActive && session.selected
    const tabId = index === 0 && detailId ? `${detailId}-terminal-tab` : `${detailId}-terminal-tab-${session.key}`
    return (
      <div
        key={session.key}
        data-terminal-tab-tooltip-id={session.key}
        className={cn(
          'group relative flex h-7 shrink-0 items-center gap-1 rounded-md px-2.5 text-sm transition-colors duration-100',
          isActive
            ? 'bg-selected text-selected-foreground'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        )}
      >
        <button
          type="button"
          role="tab"
          id={tabId}
          aria-selected={isActive}
          tabIndex={isActive ? 0 : -1}
          onClick={() => handleSelect(session.key)}
          onKeyDown={(e) => handleTabKeyDown(e, session.key)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left text-inherit outline-none"
        >
          <span className="truncate">{session.title}</span>
          {session.hasBell && (
            <>
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-attention opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-attention" />
              </span>
              <span className="sr-only">{t('terminal.bell-unread')}</span>
            </>
          )}
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label={t('terminal.close')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => handleClose(e, session.key)}
          className={cn(
            'cursor-pointer rounded border-0 bg-transparent p-0.5 text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground',
            isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          )}
          title={t('terminal.close')}
        >
          <X size={14} />
        </button>
      </div>
    )
  }

  function renderMeasureTab(session: TerminalSessionSummary) {
    return (
      <div
        key={session.key}
        className="group relative flex h-7 shrink-0 items-center gap-1 rounded-md px-2.5 text-sm"
      >
        <span className="truncate">{session.title}</span>
        <div className="h-3.5 w-3.5" />
      </div>
    )
  }

  const tooltipLayerContent = (
    <DelegatedTooltipLayer
      items={sessions}
      selector={TERMINAL_TAB_TOOLTIP_SELECTOR}
      attributeName="data-terminal-tab-tooltip-id"
      getItemId={(session) => session.key}
      renderTooltip={(session) => (
        <div className={cn('truncate text-xs font-semibold text-foreground', TOOLTIP_META_TEXT_CLASS)}>
          {session.fullTitle ?? session.title}
        </div>
      )}
      placement="top-start"
      delayMs={DELEGATED_TOOLTIP_DEFAULTS.delayMs}
      tooltipClassName="px-3 py-2"
    />
  )

  if (useCompact) {
    return (
      <div ref={containerRef} className="relative flex min-w-0 items-center gap-1 overflow-hidden">
        {tooltipLayerContent}
        <div className="flex items-center gap-1" role="tablist" aria-label={t('terminal.sessions')}>
          {renderTab(activeSession, 0)}
        </div>
        {overflowSessions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t('terminal.sessions')}>
                <ChevronDown size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="flex w-max flex-col !overflow-hidden">
              <ScrollArea className="max-h-[200px]" scrollbarMode="compact">
                {overflowSessions.map((session) => (
                  <div key={session.key} className="group relative flex items-center">
                    <DropdownMenuItem
                      className={cn('min-w-0 flex-1 gap-2 pr-8', session.selected && 'bg-accent/40 text-accent-foreground')}
                      onSelect={() => handleSelect(session.key)}
                      aria-label={session.fullTitle ?? session.title}
                      aria-current={session.selected ? 'true' : undefined}
                    >
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
                      <X size={14} />
                    </Button>
                  </div>
                ))}
              </ScrollArea>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2" onSelect={onNew}>
                <Plus size={14} />
                {t('terminal.new')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {/* 测量容器 */}
        <div
          ref={measureRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 flex items-center gap-1 overflow-hidden opacity-0"
        >
          {sessions.map((session) => renderMeasureTab(session))}
          <div className="h-7 w-7 shrink-0" />
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative flex min-w-0 items-center gap-1 overflow-hidden">
      {tooltipLayerContent}
      <div className="flex items-center gap-1" role="tablist" aria-label={t('terminal.sessions')}>
        {sessions.map((session, index) => renderTab(session, index))}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={onNew}
        aria-label={t('terminal.new')}
        title={t('terminal.new')}
      >
        <Plus size={14} />
      </Button>
      {/* 测量容器 */}
      <div
        ref={measureRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 flex items-center gap-1 overflow-hidden opacity-0"
      >
        {sessions.map((session) => renderMeasureTab(session))}
        <div className="h-7 w-7 shrink-0" />
      </div>
    </div>
  )
}
