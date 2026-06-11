import { Plus, X, ChevronDown } from 'lucide-react'
import { useCallback, type ComponentPropsWithoutRef } from 'react'
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
import { useT } from '#/web/stores/i18n.ts'
import type { TerminalSessionSummary } from '#/web/components/terminal/types.ts'
import { ToolbarTabList, ToolbarTabStrip, ToolbarTabStripBody } from '#/web/components/tab-strip/ToolbarTabStrip.tsx'
import { useFocusRegistry, type FocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'

interface TerminalTabsProps {
  worktreeTerminalKey: string
  sessions: TerminalSessionSummary[]
  detailId: string
  responsiveCompact?: boolean
  panelActive?: boolean
  focusMode?: boolean
  focusRegistry?: FocusRegistry<string, HTMLButtonElement>
  emptyFocusKey?: string
  onNew: () => void
  onSelect: (worktreeTerminalKey: string, key: string) => void
  onScrollToBottom: (key: string) => void
  onClose: (key: string) => void
  onNavigateOut?: (direction: 'prev' | 'next' | 'first' | 'last') => void
}

export const EMPTY_TERMINAL_TAB_FOCUS_KEY = '__terminal-empty__'

const TERMINAL_TAB_TOOLTIP_SELECTOR = '[data-terminal-tab-tooltip-id]'

export function TerminalTabs({
  worktreeTerminalKey,
  sessions,
  detailId,
  responsiveCompact,
  panelActive,
  focusMode,
  focusRegistry: externalFocusRegistry,
  emptyFocusKey = EMPTY_TERMINAL_TAB_FOCUS_KEY,
  onNew,
  onSelect,
  onScrollToBottom,
  onClose,
  onNavigateOut,
}: TerminalTabsProps) {
  const t = useT()
  const showCollapsedTabs = !!responsiveCompact
  const activeSession = sessions.find((s) => s.selected) ?? sessions[0]
  const internalFocusRegistry = useFocusRegistry<string, HTMLButtonElement>()
  const focusRegistry = externalFocusRegistry ?? internalFocusRegistry

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

      const isActive = sessions.find((s) => s.key === key)?.selected ?? false
      const idx = sessions.findIndex((s) => s.key === key)
      const nextKey = sessions[idx + 1]?.key ?? sessions[idx - 1]?.key ?? null

      onClose(key)

      if (isActive && nextKey) {
        focusRegistry.focus(nextKey)
      }
    },
    [onClose, sessions, focusRegistry],
  )

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, sessionKey: string) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return
      e.preventDefault()
      if (showCollapsedTabs) {
        if (e.key === 'Home') onNavigateOut?.('first')
        else if (e.key === 'End') onNavigateOut?.('last')
        else if (e.key === 'ArrowLeft') onNavigateOut?.('prev')
        else onNavigateOut?.('next')
        return
      }
      const keys = sessions.map((s) => s.key)
      const idx = keys.indexOf(sessionKey)
      if (e.key === 'Home') {
        onNavigateOut?.('first')
        return
      }
      if (e.key === 'ArrowLeft' && idx === 0) {
        onNavigateOut?.('prev')
        return
      }
      if (e.key === 'ArrowRight' && idx === keys.length - 1) {
        onNavigateOut?.('next')
        return
      }
      const nextIdx =
        e.key === 'ArrowLeft'
          ? (idx - 1 + keys.length) % keys.length
          : e.key === 'ArrowRight'
            ? (idx + 1) % keys.length
            : keys.length - 1
      const nextKey = keys[nextIdx]
      if (nextKey) {
        focusRegistry.focus(nextKey)
      }
    },
    [focusRegistry, onNavigateOut, sessions, showCollapsedTabs],
  )

  if (sessions.length === 0) {
    return (
      <Button
        ref={focusRegistry.setRef(emptyFocusKey)}
        type="button"
        variant="ghost"
        className="h-7 px-2.5 text-sm font-normal"
        id={`${detailId}-terminal-tab`}
        onClick={onNew}
        aria-label={t('terminal.new')}
        title={t('terminal.new')}
      >
        {t('terminal.label')}
      </Button>
    )
  }

  if (!activeSession) return null

  function renderTab(session: TerminalSessionSummary, index: number) {
    const isActive = panelActive && session.selected
    const tabId = showCollapsedTabs || index === 0 ? `${detailId}-terminal-tab` : `${detailId}-terminal-tab-${session.key}`
    return (
      <div
        key={session.key}
        data-terminal-tab-tooltip-id={session.key}
        className={cn(
          'group relative flex h-7 w-28 shrink-0 items-center gap-1 rounded-md px-2.5 text-sm transition-colors duration-100',
          isActive
            ? 'bg-selected text-selected-foreground'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        )}
      >
        <button
          ref={focusRegistry.setRef(session.key)}
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

  function renderCompactTabsBody() {
    return (
      <ToolbarTabStripBody>
        <TerminalTabTooltipLayer
          sessions={sessions}
          focusMode={focusMode}
          role="tablist"
          aria-label={t('terminal.sessions')}
        >
          {renderTab(activeSession, 0)}
        </TerminalTabTooltipLayer>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t('terminal.sessions')}>
              <ChevronDown size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="flex w-max flex-col !overflow-hidden">
            <ScrollArea className="max-h-[200px]" scrollbarMode="compact">
              {sessions.map((session) => (
                <div key={session.key} className="group relative flex items-center">
                  <DropdownMenuItem
                    className={cn('min-w-0 flex-1 gap-2 pr-8', session.selected && 'bg-selected text-selected-foreground')}
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
      </ToolbarTabStripBody>
    )
  }

  function renderScrollableTabsBody() {
    return (
      <ToolbarTabStripBody scroll>
        <TerminalTabTooltipLayer
          sessions={sessions}
          focusMode={focusMode}
          role="tablist"
          aria-label={t('terminal.sessions')}
        >
          {sessions.map((session, index) => renderTab(session, index))}
        </TerminalTabTooltipLayer>
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
      </ToolbarTabStripBody>
    )
  }

  return (
    <ToolbarTabStrip
      compact={showCollapsedTabs}
      compactContent={renderCompactTabsBody()}
      scrollContent={renderScrollableTabsBody()}
    />
  )
}

interface TerminalTabTooltipLayerProps extends ComponentPropsWithoutRef<'div'> {
  sessions: TerminalSessionSummary[]
  focusMode?: boolean
}

function TerminalTabTooltipLayer({ sessions, focusMode, children, ...props }: TerminalTabTooltipLayerProps) {
  return (
    <DelegatedTooltipLayer
      items={sessions}
      selector={TERMINAL_TAB_TOOLTIP_SELECTOR}
      attributeName="data-terminal-tab-tooltip-id"
      getItemId={(session) => session.key}
      renderTooltip={(session) => {
        const title = session.originalTitle ?? session.fullTitle ?? session.title
        return <div className="truncate text-xs font-semibold text-foreground">{title}</div>
      }}
      placement={focusMode ? 'bottom-start' : 'top-start'}
      delayMs={DELEGATED_TOOLTIP_DEFAULTS.delayMs}
      tooltipClassName="px-3 py-2"
      asChild
    >
      <ToolbarTabList {...props}>{children}</ToolbarTabList>
    </DelegatedTooltipLayer>
  )
}
