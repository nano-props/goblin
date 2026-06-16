import { Plus, Terminal, X, ChevronDown } from 'lucide-react'
import { useCallback, useLayoutEffect, useMemo, useRef, type ComponentPropsWithoutRef } from 'react'
import { Button } from '#/web/components/ui/button.tsx'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  SelectedDropdownMenuItem,
} from '#/web/components/ui/dropdown-menu.tsx'
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { DelegatedTooltipLayer, DELEGATED_TOOLTIP_DEFAULTS } from '#/web/components/DelegatedTooltipLayer.tsx'
import { createRestrictToTabStripBounds } from '#/web/components/tab-strip/drag-bounds.ts'
import { useT } from '#/web/stores/i18n.ts'
import type { TerminalSessionSummary } from '#/web/components/terminal/types.ts'
import { ToolbarTabList, ToolbarTabStrip, ToolbarTabStripBody } from '#/web/components/tab-strip/ToolbarTabStrip.tsx'
import { ToolbarClosableTab } from '#/web/components/tab-strip/ToolbarClosableTab.tsx'
import {
  toolbarTabButtonClassName,
  toolbarTabChromeClassName,
  toolbarTabIconClassName,
} from '#/web/components/tab-strip/tab-variants.ts'
import { useFocusRegistry, type FocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { useSortableTab } from '#/web/components/tab-strip/useSortableTab.ts'

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
  onReorder: (worktreeTerminalKey: string, orderedKeys: string[]) => void
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
  onReorder,
  onNavigateOut,
}: TerminalTabsProps) {
  const t = useT()
  const showCollapsedTabs = !!responsiveCompact
  const selectedSession = sessions.find((s) => s.selected) ?? sessions[0]
  const internalFocusRegistry = useFocusRegistry<string, HTMLButtonElement>()
  const focusRegistry = externalFocusRegistry ?? internalFocusRegistry
  const viewportRef = useRef<HTMLDivElement>(null)
  const prevSessionCountRef = useRef(sessions.length)
  const newButtonRef = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    if (sessions.length <= prevSessionCountRef.current) {
      prevSessionCountRef.current = sessions.length
      return
    }
    prevSessionCountRef.current = sessions.length
    const viewport = viewportRef.current
    if (!viewport) return
    if (viewport.scrollWidth <= viewport.clientWidth) return
    viewport.style.scrollBehavior = 'smooth'
    viewport.scrollLeft = viewport.scrollWidth
    // Reset scroll-behavior on the next frame so subsequent user-driven scrolls
    // (e.g. dragging the scrollbar) are not animated, while the in-flight scroll
    // initiated above still benefits from the smooth behavior.
    const frame = requestAnimationFrame(() => {
      viewport.style.scrollBehavior = ''
    })
    return () => cancelAnimationFrame(frame)
  }, [sessions.length])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const restrictToVisibleTabStrip = useMemo(
    () => createRestrictToTabStripBounds({ rightBoundaryRef: newButtonRef }),
    [],
  )

  // Must be called unconditionally so the hook order stays stable across renders
  // (e.g. when sessions goes from 0 → 1 or back, which would otherwise bypass the
  // helper below and trigger React's "Rendered more hooks than during the previous render").
  const sortableIds = useMemo(() => sessions.map((s) => s.key), [sessions])

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
      const keys = sessions.map((s) => s.key)
      const idx = keys.indexOf(sessionKey)
      if (showCollapsedTabs) {
        if (e.key === 'ArrowLeft') onNavigateOut?.('prev')
        else if (e.key === 'ArrowRight') onNavigateOut?.('next')
        else focusRegistry.focus(sessionKey)
        return
      }
      if (e.key === 'Home') {
        const firstKey = keys[0]
        if (firstKey) focusRegistry.focus(firstKey)
        return
      }
      if (e.key === 'End') {
        const lastKey = keys[keys.length - 1]
        if (lastKey) focusRegistry.focus(lastKey)
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
      const nextIdx = e.key === 'ArrowLeft' ? (idx - 1 + keys.length) % keys.length : (idx + 1) % keys.length
      const nextKey = keys[nextIdx]
      if (nextKey) {
        focusRegistry.focus(nextKey)
      }
    },
    [focusRegistry, onNavigateOut, sessions, showCollapsedTabs],
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over) return
      const activeId = String(active.id)
      const overId = String(over.id)
      if (activeId === overId) return
      const oldIndex = sessions.findIndex((s) => s.key === activeId)
      const newIndex = sessions.findIndex((s) => s.key === overId)
      if (oldIndex === -1 || newIndex === -1) return
      const next = arrayMove(
        sessions.map((s) => s.key),
        oldIndex,
        newIndex,
      )
      onReorder(worktreeTerminalKey, next)
    },
    [sessions, onReorder, worktreeTerminalKey],
  )

  if (sessions.length === 0) {
    return (
      <Button
        ref={focusRegistry.setRef(emptyFocusKey)}
        type="button"
        variant="ghost"
        className="h-7 border border-separator px-2.5 text-sm font-normal text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        id={`${detailId}-terminal-tab`}
        onClick={onNew}
        aria-label={t('terminal.new')}
        title={t('terminal.new')}
      >
        {t('terminal.label')}
      </Button>
    )
  }

  if (!selectedSession) return null

  function renderCompactTabsBody() {
    return (
      <ToolbarTabStripBody>
        <TerminalTabTooltipLayer
          sessions={sessions}
          focusMode={focusMode}
          role="tablist"
          aria-label={t('terminal.sessions')}
        >
          <TerminalTab
            session={selectedSession}
            isActive={!!panelActive && selectedSession.selected}
            isSelected={selectedSession.selected}
            tabId={`${detailId}-terminal-tab`}
            focusRegistry={focusRegistry}
            onSelect={handleSelect}
            onClose={handleClose}
            onKeyDown={handleTabKeyDown}
            t={t}
            compact={showCollapsedTabs}
          />
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
                  <SelectedDropdownMenuItem
                    selected={session.selected}
                    className="min-w-0 flex-1 gap-2 pr-8"
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
                  </SelectedDropdownMenuItem>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="absolute right-1 h-6 w-6 text-muted-foreground"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => handleClose(event, session.key)}
                    title={t('terminal.close-named', { name: session.title })}
                    aria-label={t('terminal.close-named', { name: session.title })}
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
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVisibleTabStrip]}
        onDragEnd={handleDragEnd}
      >
        <ToolbarTabStripBody scroll>
          <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
            <TerminalTabTooltipLayer
              sessions={sessions}
              focusMode={focusMode}
              role="tablist"
              aria-label={t('terminal.sessions')}
            >
              {sessions.map((session, index) => (
                <SortableTerminalTab
                  key={session.key}
                  session={session}
                  isActive={!!panelActive && session.selected}
                  isSelected={session.selected}
                  index={index}
                  total={sessions.length}
                  tabId={index === 0 ? `${detailId}-terminal-tab` : `${detailId}-terminal-tab-${session.key}`}
                  focusRegistry={focusRegistry}
                  onSelect={handleSelect}
                  onClose={handleClose}
                  onKeyDown={handleTabKeyDown}
                  t={t}
                  compact={showCollapsedTabs}
                />
              ))}
            </TerminalTabTooltipLayer>
          </SortableContext>
          <Button
            ref={newButtonRef}
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
      </DndContext>
    )
  }

  return (
    <ToolbarTabStrip
      compact={showCollapsedTabs}
      compactContent={renderCompactTabsBody()}
      scrollContent={renderScrollableTabsBody()}
      viewportRef={viewportRef}
    />
  )
}

interface TerminalTabProps {
  session: TerminalSessionSummary
  isActive: boolean
  isSelected: boolean
  index?: number
  total?: number
  tabId: string
  focusRegistry: FocusRegistry<string, HTMLButtonElement>
  onSelect: (key: string) => void
  onClose: (event: React.MouseEvent, key: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>, sessionKey: string) => void
  t: (key: string, params?: Record<string, string | number>) => string
  compact?: boolean
}

interface TerminalTabChromeProps {
  session: TerminalSessionSummary
  isActive: boolean
  isSelected: boolean
  index?: number
  total?: number
  isDragging?: boolean
  tabId: string
  buttonRef: ((node: HTMLButtonElement | null) => void) | undefined
  buttonProps?: ComponentPropsWithoutRef<'button'>
  onSelect: (key: string) => void
  onClose: (event: React.MouseEvent, key: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>, sessionKey: string) => void
  t: (key: string, params?: Record<string, string | number>) => string
  compact?: boolean
}

function TerminalTabChrome({
  session,
  isActive,
  isSelected,
  index,
  total,
  isDragging = false,
  tabId,
  buttonRef,
  buttonProps,
  onSelect,
  onClose,
  onKeyDown,
  t,
  compact = false,
}: TerminalTabChromeProps) {
  const terminalLabelBase = session.originalTitle ?? session.fullTitle ?? session.title
  const terminalLabel = session.hasBell ? `${terminalLabelBase} — ${t('terminal.bell-unread')}` : terminalLabelBase
  const collectionAria =
    index !== undefined && total !== undefined
      ? {
          'aria-posinset': index + 1,
          'aria-setsize': total,
        }
      : {}
  return (
    <ToolbarClosableTab
      containerProps={{ 'data-terminal-tab-tooltip-id': session.key }}
      containerClassName={toolbarTabChromeClassName({
        variant: 'terminal',
        active: isActive,
        dragging: isDragging,
        compact,
      })}
      buttonRef={buttonRef}
      buttonProps={{
        ...buttonProps,
        role: 'tab',
        id: tabId,
        'aria-selected': isSelected,
        'aria-label': terminalLabel,
        ...collectionAria,
        tabIndex: isSelected ? 0 : -1,
        onClick: () => onSelect(session.key),
        onKeyDown: (e) => onKeyDown(e, session.key),
      }}
      buttonClassName={toolbarTabButtonClassName('terminal')}
      closeLabel={t('terminal.close-named', { name: session.title })}
      closeVisible={isActive}
      onClose={(e) => onClose(e, session.key)}
    >
      <Terminal size={13} className={toolbarTabIconClassName(isActive)} />
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
    </ToolbarClosableTab>
  )
}

function TerminalTab({
  session,
  isActive,
  isSelected,
  index,
  total,
  tabId,
  focusRegistry,
  onSelect,
  onClose,
  onKeyDown,
  t,
  compact,
}: TerminalTabProps) {
  return (
    <TerminalTabChrome
      session={session}
      isActive={isActive}
      isSelected={isSelected}
      index={index}
      total={total}
      tabId={tabId}
      buttonRef={focusRegistry.setRef(session.key)}
      onSelect={onSelect}
      onClose={onClose}
      onKeyDown={onKeyDown}
      t={t}
      compact={compact}
    />
  )
}

function SortableTerminalTab({
  session,
  isActive,
  isSelected,
  index,
  total,
  tabId,
  focusRegistry,
  onSelect,
  onClose,
  onKeyDown,
  t,
  compact,
}: TerminalTabProps) {
  const sortable = useSortableTab(session.key, { onButtonRef: focusRegistry.setRef(session.key) })

  return (
    <div ref={sortable.setContainerRef} style={sortable.style} className="touch-none select-none">
      <TerminalTabChrome
        session={session}
        isActive={isActive}
        isSelected={isSelected}
        index={index}
        total={total}
        isDragging={sortable.isDragging}
        tabId={tabId}
        buttonRef={sortable.setButtonRef}
        buttonProps={{ ...sortable.attributes, ...sortable.sortableListeners }}
        onSelect={onSelect}
        onClose={onClose}
        onKeyDown={(e) => {
          sortable.sortableOnKeyDown?.(e)
          if (e.defaultPrevented || sortable.isDragging) return
          onKeyDown(e, session.key)
        }}
        t={t}
        compact={compact}
      />
    </div>
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
      <ToolbarTabList aria-orientation={props.role === 'tablist' ? 'horizontal' : undefined} {...props}>
        {children}
      </ToolbarTabList>
    </DelegatedTooltipLayer>
  )
}

function arrayMove<T>(array: T[], from: number, to: number): T[] {
  const result = array.slice()
  const [removed] = result.splice(from, 1)
  if (removed === undefined) return result
  result.splice(to, 0, removed)
  return result
}
