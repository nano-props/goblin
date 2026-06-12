import { Plus, X, ChevronDown } from 'lucide-react'
import { useCallback, useLayoutEffect, useMemo, useRef, type ComponentPropsWithoutRef } from 'react'
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
import {
  DndContext,
  type DragEndEvent,
  type Modifier,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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
  onReorder: (worktreeTerminalKey: string, orderedKeys: string[]) => void
  onNavigateOut?: (direction: 'prev' | 'next' | 'first' | 'last') => void
}

export const EMPTY_TERMINAL_TAB_FOCUS_KEY = '__terminal-empty__'

const TERMINAL_TAB_TOOLTIP_SELECTOR = '[data-terminal-tab-tooltip-id]'

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

const restrictToVisibleTabStrip: Modifier = ({
  activeNodeRect,
  containerNodeRect,
  draggingNodeRect,
  scrollableAncestorRects,
  transform,
  windowRect,
}) => {
  const horizontalTransform = { ...transform, y: 0 }
  const draggableRect = draggingNodeRect ?? activeNodeRect
  const bounds = scrollableAncestorRects[0] ?? containerNodeRect ?? windowRect
  if (!draggableRect || !bounds) return horizontalTransform
  const minX = bounds.left - draggableRect.left
  const maxX = bounds.right - draggableRect.right
  return { ...horizontalTransform, x: clamp(horizontalTransform.x, minX, maxX) }
}

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
  const activeSession = sessions.find((s) => s.selected) ?? sessions[0]
  const internalFocusRegistry = useFocusRegistry<string, HTMLButtonElement>()
  const focusRegistry = externalFocusRegistry ?? internalFocusRegistry
  const viewportRef = useRef<HTMLDivElement>(null)
  const prevSessionCountRef = useRef(sessions.length)

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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

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

  if (!activeSession) return null

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
            session={activeSession}
            isActive={!!panelActive && activeSession.selected}
            tabId={`${detailId}-terminal-tab`}
            focusRegistry={focusRegistry}
            onSelect={handleSelect}
            onClose={handleClose}
            onKeyDown={handleTabKeyDown}
            t={t}
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
                  <DropdownMenuItem
                    className={cn(
                      'min-w-0 flex-1 gap-2 pr-8',
                      session.selected && 'bg-selected text-selected-foreground',
                    )}
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
                  tabId={index === 0 ? `${detailId}-terminal-tab` : `${detailId}-terminal-tab-${session.key}`}
                  focusRegistry={focusRegistry}
                  onSelect={handleSelect}
                  onClose={handleClose}
                  onKeyDown={handleTabKeyDown}
                  t={t}
                />
              ))}
            </TerminalTabTooltipLayer>
          </SortableContext>
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
  tabId: string
  focusRegistry: FocusRegistry<string, HTMLButtonElement>
  onSelect: (key: string) => void
  onClose: (event: React.MouseEvent, key: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>, sessionKey: string) => void
  t: (key: string) => string
}

function TerminalTab({ session, isActive, tabId, focusRegistry, onSelect, onClose, onKeyDown, t }: TerminalTabProps) {
  return (
    <div
      data-terminal-tab-tooltip-id={session.key}
      className={cn(
        'group relative flex h-7 w-28 shrink-0 items-center gap-1 rounded-md border px-2.5 text-sm transition-colors duration-100',
        isActive
          ? 'border-transparent bg-selected text-selected-foreground'
          : 'border-separator text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
    >
      <button
        ref={focusRegistry.setRef(session.key)}
        type="button"
        role="tab"
        id={tabId}
        aria-selected={isActive}
        tabIndex={isActive ? 0 : -1}
        onClick={() => onSelect(session.key)}
        onKeyDown={(e) => onKeyDown(e, session.key)}
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
        onClick={(e) => onClose(e, session.key)}
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

function SortableTerminalTab({
  session,
  isActive,
  tabId,
  focusRegistry,
  onSelect,
  onClose,
  onKeyDown,
  t,
}: TerminalTabProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: session.key,
  })
  const sortableListeners = listeners ?? {}
  const chromeLikeTransform = transform ? { ...transform, y: 0, scaleX: 1, scaleY: 1 } : null
  const style = {
    transform: CSS.Transform.toString(chromeLikeTransform),
    transition,
  }
  const setFocusRef = focusRegistry.setRef(session.key)
  const setButtonRef = (node: HTMLButtonElement | null) => {
    setActivatorNodeRef(node)
    setFocusRef(node)
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-terminal-tab-tooltip-id={session.key}
      className={cn(
        'group relative flex h-7 w-28 shrink-0 touch-none select-none items-center gap-1 rounded-md border px-2.5 text-sm transition-colors duration-100',
        isActive
          ? 'border-transparent bg-selected text-selected-foreground'
          : 'border-separator text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        isDragging && 'z-10 cursor-grabbing bg-card text-foreground',
      )}
    >
      <button
        ref={setButtonRef}
        type="button"
        {...attributes}
        {...sortableListeners}
        role="tab"
        id={tabId}
        aria-selected={isActive}
        tabIndex={isActive ? 0 : -1}
        onClick={() => onSelect(session.key)}
        onKeyDown={(e) => {
          if (isDragging) return
          onKeyDown(e, session.key)
        }}
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
        onClick={(e) => onClose(e, session.key)}
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

function arrayMove<T>(array: T[], from: number, to: number): T[] {
  const result = array.slice()
  const [removed] = result.splice(from, 1)
  if (removed === undefined) return result
  result.splice(to, 0, removed)
  return result
}
