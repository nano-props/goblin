import { FileText, GitBranch, Plus, Terminal, X, ChevronDown, Loader2 } from 'lucide-react'
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
import type { WorkspacePaneViewOrderEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneViewSummary } from '#/web/components/terminal/types.ts'
import { ToolbarTabList, ToolbarTabStrip, ToolbarTabStripBody } from '#/web/components/tab-strip/ToolbarTabStrip.tsx'
import { ToolbarClosableTab } from '#/web/components/tab-strip/ToolbarClosableTab.tsx'
import {
  toolbarTabButtonClassName,
  toolbarTabChromeClassName,
  toolbarTabIconClassName,
} from '#/web/components/tab-strip/tab-variants.ts'
import { useFocusRegistry, type FocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { useSortableTab } from '#/web/components/tab-strip/useSortableTab.ts'
import {
  workspacePaneViewIdentity,
  workspacePaneViewButtonId,
  workspacePaneViewOrderEntry,
} from '#/web/components/workspace-pane/workspace-pane-view-model.ts'

interface WorkspacePaneViewStripProps {
  worktreeTerminalKey: string
  views: WorkspacePaneViewSummary[]
  detailId: string
  responsiveCompact?: boolean
  activeTabIdentity: string | null
  panelActive?: boolean
  focusMode?: boolean
  focusRegistry?: FocusRegistry<string, HTMLButtonElement>
  emptyFocusKey?: string
  /**
   * T6.1: when true AND `views.length === 0`, render a single
   * placeholder chip with a spinner instead of the "+ New" button.
   * The caller derives this from the repo-sync store — it flips to
   * false after the first `syncServerSessions` completes (success or
   * failure). The skeleton gives the user a visible signal that the
   * strip is loading, not broken. We render one chip (not N) because
   * the sync is a single server call — we don't know the real session
   * count until it returns, so any N would be a fake that could
   * mislead the user into expecting a specific number.
   */
  isLoading?: boolean
  onNew: () => void
  onSelect: (worktreeTerminalKey: string, tab: WorkspacePaneViewSummary) => void
  onScrollToBottom: (key: string) => void
  onClose: (tab: WorkspacePaneViewSummary) => void
  onReorder: (worktreeTerminalKey: string, orderedViews: WorkspacePaneViewOrderEntry[]) => void
  onNavigateOut?: (direction: 'prev' | 'next' | 'first' | 'last') => void
  getTooltip: (tab: WorkspacePaneViewSummary) => string
  getLabel: (tab: WorkspacePaneViewSummary) => string
  getCloseLabel: (tab: WorkspacePaneViewSummary) => string
}

export const EMPTY_WORKSPACE_PANE_VIEW_FOCUS_KEY = '__workspace-pane-empty__'

const WORKSPACE_PANE_VIEW_TOOLTIP_SELECTOR = '[data-workspace-pane-view-tooltip-id]'

export function WorkspacePaneViewStrip({
  worktreeTerminalKey,
  views,
  detailId,
  activeTabIdentity,
  responsiveCompact,
  panelActive,
  focusMode,
  focusRegistry: externalFocusRegistry,
  emptyFocusKey = EMPTY_WORKSPACE_PANE_VIEW_FOCUS_KEY,
  isLoading = false,
  onNew,
  onSelect,
  onScrollToBottom,
  onClose,
  onReorder,
  onNavigateOut,
  getTooltip,
  getLabel,
  getCloseLabel,
}: WorkspacePaneViewStripProps) {
  const t = useT()
  const tabs = views
  const showCollapsedTabs = !!responsiveCompact
  const selectedTab = tabs.find((tab) => workspacePaneViewIdentity(tab) === activeTabIdentity) ?? tabs[0]
  const internalFocusRegistry = useFocusRegistry<string, HTMLButtonElement>()
  const focusRegistry = externalFocusRegistry ?? internalFocusRegistry
  const viewportRef = useRef<HTMLDivElement>(null)
  const prevTabCountRef = useRef(views.length)
  const newButtonRef = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    if (views.length <= prevTabCountRef.current) {
      prevTabCountRef.current = views.length
      return
    }
    prevTabCountRef.current = views.length
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
  }, [views.length])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const restrictToVisibleTabStrip = useMemo(
    () => createRestrictToTabStripBounds({ rightBoundaryRef: newButtonRef }),
    [],
  )

  // Must be called unconditionally so the hook order stays stable across renders
  // (e.g. when views goes from 0 → 1 or back, which would otherwise bypass the
  // helper below and trigger React's "Rendered more hooks than during the previous render").
  const sortableIds = useMemo(() => tabs.map((tab) => workspacePaneViewIdentity(tab)), [tabs])

  const handleSelect = useCallback(
    (identity: string) => {
      const tab = tabs.find((item) => workspacePaneViewIdentity(item) === identity)
      if (!tab) return
      if (tab.type === 'terminal' && workspacePaneViewIdentity(tab) === activeTabIdentity && panelActive) {
        onScrollToBottom(tab.key)
      } else {
        onSelect(worktreeTerminalKey, tab)
      }
    },
    [activeTabIdentity, tabs, onSelect, onScrollToBottom, worktreeTerminalKey, panelActive],
  )

  const handleClose = useCallback(
    (event: React.MouseEvent, identity: string) => {
      event.preventDefault()
      event.stopPropagation()

      const tab = tabs.find((item) => workspacePaneViewIdentity(item) === identity)
      if (!tab) return
      const isActive = workspacePaneViewIdentity(tab) === activeTabIdentity
      const idx = tabs.findIndex((item) => workspacePaneViewIdentity(item) === identity)
      const nextKey =
        (tabs[idx + 1] ? workspacePaneViewIdentity(tabs[idx + 1]) : null) ??
        (tabs[idx - 1] ? workspacePaneViewIdentity(tabs[idx - 1]) : null)

      onClose(tab)

      if (isActive && nextKey) {
        focusRegistry.focus(nextKey)
      }
    },
    [activeTabIdentity, onClose, tabs, focusRegistry],
  )

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, tabIdentity: string) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return
      e.preventDefault()
      const keys = tabs.map((tab) => workspacePaneViewIdentity(tab))
      const idx = keys.indexOf(tabIdentity)
      if (showCollapsedTabs) {
        if (e.key === 'ArrowLeft') onNavigateOut?.('prev')
        else if (e.key === 'ArrowRight') onNavigateOut?.('next')
        else focusRegistry.focus(tabIdentity)
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
    [focusRegistry, onNavigateOut, tabs, showCollapsedTabs],
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over) return
      const activeId = String(active.id)
      const overId = String(over.id)
      if (activeId === overId) return
      const oldIndex = tabs.findIndex((tab) => workspacePaneViewIdentity(tab) === activeId)
      const newIndex = tabs.findIndex((tab) => workspacePaneViewIdentity(tab) === overId)
      if (oldIndex === -1 || newIndex === -1) return
      const next = arrayMove(
        tabs.map((tab) => workspacePaneViewOrderEntry(tab)),
        oldIndex,
        newIndex,
      )
      onReorder(worktreeTerminalKey, next)
    },
    [tabs, onReorder, worktreeTerminalKey],
  )

  if (views.length === 0) {
    if (isLoading) {
      // T6.1: a single placeholder chip with a spinner. It disappears
      // as soon as the first sync completes (views.length flips to
      // >0) or isLoading flips to false (sync failed or returned
      // empty) — whichever happens first. The chip is non-interactive
      // (no onClick) so it can't be mistaken for a real tab; the
      // `aria-busy` and `role="status"` make the loading state
      // explicit to assistive tech.
      return (
        <div
          className="flex items-center"
          role="status"
          aria-busy="true"
          aria-label={t('terminal.loading')}
          data-workspace-pane-skeleton-strip=""
        >
          <div
            className="flex h-7 items-center gap-1.5 rounded-md border border-separator px-2.5 text-sm font-normal text-muted-foreground"
            aria-hidden="true"
            data-workspace-pane-skeleton-chip=""
          >
            <Loader2 size={13} className="animate-spin shrink-0" />
            <span className="inline-block h-2.5 w-10 rounded-sm bg-separator/60" />
          </div>
        </div>
      )
    }
    return (
      <Button
        ref={focusRegistry.setRef(emptyFocusKey)}
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        id={`${detailId}-workspace-pane-view-empty`}
        onClick={onNew}
        aria-label={t('terminal.new')}
        title={t('terminal.new')}
      >
        <Plus size={14} />
      </Button>
    )
  }

  if (!selectedTab) return null

  function renderCompactTabsBody() {
    return (
      <ToolbarTabStripBody>
        <WorkspacePaneViewTooltipLayer
          tabs={tabs}
          focusMode={focusMode}
          role="tablist"
          aria-label={t('workspace-pane-views.tabs')}
          getTooltip={getTooltip}
        >
          <WorkspacePaneView
            tab={selectedTab}
            isActive={!!panelActive && workspacePaneViewIdentity(selectedTab) === activeTabIdentity}
            isSelected={workspacePaneViewIdentity(selectedTab) === activeTabIdentity}
            tabId={workspacePaneViewButtonId(detailId, 0)}
            focusRegistry={focusRegistry}
            onSelect={handleSelect}
            onClose={handleClose}
            onKeyDown={handleTabKeyDown}
            t={t}
            compact={showCollapsedTabs}
            getLabel={getLabel}
            getCloseLabel={getCloseLabel}
          />
        </WorkspacePaneViewTooltipLayer>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t('workspace-pane-views.tabs')}>
              <ChevronDown size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="flex w-max flex-col !overflow-hidden">
            <ScrollArea className="max-h-[200px]" scrollbarMode="compact">
              {tabs.map((tab) => {
                const identity = workspacePaneViewIdentity(tab)
                const label = getLabel(tab)
                return (
                  <div key={identity} className="group relative flex items-center">
                    <SelectedDropdownMenuItem
                      selected={workspacePaneViewIdentity(tab) === activeTabIdentity}
                      className="min-w-0 flex-1 gap-2 pr-8"
                      onSelect={() => handleSelect(identity)}
                      aria-label={getTooltip(tab)}
                      aria-current={workspacePaneViewIdentity(tab) === activeTabIdentity ? 'true' : undefined}
                    >
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                      {tab.type === 'terminal' && tab.hasBell && (
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
                      onClick={(event) => handleClose(event, identity)}
                      title={getCloseLabel(tab)}
                      aria-label={getCloseLabel(tab)}
                    >
                      <X size={14} />
                    </Button>
                  </div>
                )
              })}
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
            <WorkspacePaneViewTooltipLayer
              tabs={tabs}
              focusMode={focusMode}
              role="tablist"
              aria-label={t('workspace-pane-views.tabs')}
              getTooltip={getTooltip}
            >
              {tabs.map((tab, index) => (
                <SortableWorkspacePaneView
                  key={workspacePaneViewIdentity(tab)}
                  tab={tab}
                  isActive={!!panelActive && workspacePaneViewIdentity(tab) === activeTabIdentity}
                  isSelected={workspacePaneViewIdentity(tab) === activeTabIdentity}
                  index={index}
                  total={views.length}
                  tabId={workspacePaneViewButtonId(detailId, index)}
                  focusRegistry={focusRegistry}
                  onSelect={handleSelect}
                  onClose={handleClose}
                  onKeyDown={handleTabKeyDown}
                  t={t}
                  compact={showCollapsedTabs}
                  getLabel={getLabel}
                  getCloseLabel={getCloseLabel}
                />
              ))}
            </WorkspacePaneViewTooltipLayer>
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

interface WorkspacePaneViewProps {
  tab: WorkspacePaneViewSummary
  isActive: boolean
  isSelected: boolean
  index?: number
  total?: number
  tabId: string
  focusRegistry: FocusRegistry<string, HTMLButtonElement>
  onSelect: (identity: string) => void
  onClose: (event: React.MouseEvent, identity: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>, identity: string) => void
  t: (key: string, params?: Record<string, string | number>) => string
  compact?: boolean
  getLabel: (tab: WorkspacePaneViewSummary) => string
  getCloseLabel: (tab: WorkspacePaneViewSummary) => string
}

interface WorkspacePaneViewChromeProps {
  tab: WorkspacePaneViewSummary
  isActive: boolean
  isSelected: boolean
  index?: number
  total?: number
  isDragging?: boolean
  tabId: string
  buttonRef: ((node: HTMLButtonElement | null) => void) | undefined
  buttonProps?: ComponentPropsWithoutRef<'button'>
  onSelect: (identity: string) => void
  onClose: (event: React.MouseEvent, identity: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>, identity: string) => void
  t: (key: string, params?: Record<string, string | number>) => string
  compact?: boolean
  getLabel: (tab: WorkspacePaneViewSummary) => string
  getCloseLabel: (tab: WorkspacePaneViewSummary) => string
}

function WorkspacePaneViewChrome({
  tab,
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
  getLabel,
  getCloseLabel,
}: WorkspacePaneViewChromeProps) {
  const identity = workspacePaneViewIdentity(tab)
  const label = getLabel(tab)
  const ariaLabel = tab.type === 'terminal' && tab.hasBell ? `${label} — ${t('terminal.bell-unread')}` : label
  const collectionAria =
    index !== undefined && total !== undefined
      ? {
          'aria-posinset': index + 1,
          'aria-setsize': total,
        }
      : {}
  return (
    <ToolbarClosableTab
      containerProps={{ 'data-workspace-pane-view-tooltip-id': identity }}
      containerClassName={toolbarTabChromeClassName({
        variant: 'detail',
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
        'aria-label': ariaLabel,
        ...collectionAria,
        tabIndex: isSelected ? 0 : -1,
        onClick: () => onSelect(identity),
        onKeyDown: (e) => onKeyDown(e, identity),
      }}
      buttonClassName={toolbarTabButtonClassName('detail')}
      closeLabel={getCloseLabel(tab)}
      closeVisible={isActive}
      onClose={(e) => onClose(e, identity)}
    >
      <WorkspacePaneViewIcon tab={tab} active={isActive} />
      <span className="truncate">{label}</span>
      {tab.type === 'terminal' && tab.hasBell && (
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

function WorkspacePaneView({
  tab,
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
  getLabel,
  getCloseLabel,
}: WorkspacePaneViewProps) {
  return (
    <WorkspacePaneViewChrome
      tab={tab}
      isActive={isActive}
      isSelected={isSelected}
      index={index}
      total={total}
      tabId={tabId}
      buttonRef={focusRegistry.setRef(workspacePaneViewIdentity(tab))}
      onSelect={onSelect}
      onClose={onClose}
      onKeyDown={onKeyDown}
      t={t}
      compact={compact}
      getLabel={getLabel}
      getCloseLabel={getCloseLabel}
    />
  )
}

function SortableWorkspacePaneView({
  tab,
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
  getLabel,
  getCloseLabel,
}: WorkspacePaneViewProps) {
  const identity = workspacePaneViewIdentity(tab)
  const sortable = useSortableTab(identity, { onButtonRef: focusRegistry.setRef(identity) })

  return (
    <div ref={sortable.setContainerRef} style={sortable.style} className="touch-none select-none">
      <WorkspacePaneViewChrome
        tab={tab}
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
          onKeyDown(e, identity)
        }}
        t={t}
        compact={compact}
        getLabel={getLabel}
        getCloseLabel={getCloseLabel}
      />
    </div>
  )
}

interface WorkspacePaneViewTooltipLayerProps extends ComponentPropsWithoutRef<'div'> {
  tabs: WorkspacePaneViewSummary[]
  focusMode?: boolean
  getTooltip: (tab: WorkspacePaneViewSummary) => string
}

function WorkspacePaneViewTooltipLayer({
  tabs,
  focusMode,
  getTooltip,
  children,
  ...props
}: WorkspacePaneViewTooltipLayerProps) {
  return (
    <DelegatedTooltipLayer
      items={tabs}
      selector={WORKSPACE_PANE_VIEW_TOOLTIP_SELECTOR}
      attributeName="data-workspace-pane-view-tooltip-id"
      getItemId={workspacePaneViewIdentity}
      renderTooltip={(tab) => <div className="truncate text-xs font-semibold text-foreground">{getTooltip(tab)}</div>}
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

function WorkspacePaneViewIcon({ tab, active }: { tab: WorkspacePaneViewSummary; active: boolean }) {
  const className = toolbarTabIconClassName(active)
  if (tab.type === 'status') return <GitBranch size={13} className={className} />
  if (tab.type === 'changes') return <FileText size={13} className={className} />
  return <Terminal size={13} className={className} />
}

function arrayMove<T>(array: T[], from: number, to: number): T[] {
  const result = array.slice()
  const [removed] = result.splice(from, 1)
  if (removed === undefined) return result
  result.splice(to, 0, removed)
  return result
}
