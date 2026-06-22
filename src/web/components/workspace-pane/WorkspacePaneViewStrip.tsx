import { Check, ChevronDown, FileText, GitBranch, History, Loader2, Plus, Terminal, X } from 'lucide-react'
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react'
import { Button } from '#/web/components/ui/button.tsx'
import { cn } from '#/web/lib/cn.ts'
import { ScrollArea } from '#/web/components/ui/scroll-area.tsx'
import { Separator } from '#/web/components/ui/separator.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '#/web/components/ui/popover.tsx'
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
import { DelegatedTooltipLayer } from '#/web/components/DelegatedTooltipLayer.tsx'
import { createRestrictToTabStripBounds } from '#/web/components/tab-strip/drag-bounds.ts'
import { useT } from '#/web/stores/i18n.ts'
import type {
  WorkspacePaneStaticViewType,
  WorkspacePaneTabOrderEntry,
  WorkspacePaneView,
} from '#/shared/workspace-pane.ts'
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
  PENDING_TERMINAL_WORKSPACE_PANE_VIEW_IDENTITY,
  staticWorkspacePaneViewIdentity,
  workspacePaneViewIdentity,
  workspacePaneViewButtonId,
} from '#/web/components/workspace-pane/workspace-pane-view-model.ts'

type TerminalWorkspacePaneViewSummary = Extract<WorkspacePaneViewSummary, { type: 'terminal' }>

interface WorkspacePaneViewStripProps {
  worktreeTerminalKey: string | null
  items: WorkspacePaneTabItem[]
  workspacePaneId: string
  responsiveCompact?: boolean
  activeTabIdentity: string | null
  panelActive?: boolean
  leadingAction?: ReactNode
  focusRegistry?: FocusRegistry<string, HTMLButtonElement>
  emptyFocusKey?: string
  /** Render the New Terminal affordance in a busy state. */
  newTerminalBusy?: boolean
  onNew: () => void
  onSelect: (item: WorkspacePaneTabItem) => void
  onScrollToBottom: (key: string) => void
  onClose: (item: WorkspacePaneTabItem) => void
  onReorder: (orderedTabs: WorkspacePaneTabOrderEntry[]) => void
  onNavigateOut?: (direction: 'prev' | 'next' | 'first' | 'last') => void
  activateKeyboardNavigationSelection?: boolean
}

export type WorkspacePaneTabKind = 'static' | 'terminal' | 'pending'
type WorkspacePaneTabIcon = 'status' | 'changes' | 'history' | 'terminal'

interface WorkspacePaneTabItemBase {
  identity: string
  type: WorkspacePaneView
  kind: WorkspacePaneTabKind
  label: string
  tooltip: string
  icon: WorkspacePaneTabIcon
  panelId?: string
}

interface WorkspacePaneSortableTabItemBase extends WorkspacePaneTabItemBase {
  closeLabel: string
  sortableId: string
  orderEntry: WorkspacePaneTabOrderEntry
}

export interface WorkspacePaneStaticTabItem extends WorkspacePaneSortableTabItemBase {
  kind: 'static'
  staticViewType: WorkspacePaneStaticViewType
  orderEntry: Extract<WorkspacePaneTabOrderEntry, { type: WorkspacePaneStaticViewType }>
}

export interface WorkspacePaneTerminalTabItem extends WorkspacePaneSortableTabItemBase {
  kind: 'terminal'
  view: TerminalWorkspacePaneViewSummary
  closeLabel: string
  orderEntry: Extract<WorkspacePaneTabOrderEntry, { type: 'terminal' }>
}

export interface WorkspacePanePendingTabItem extends WorkspacePaneTabItemBase {
  kind: 'pending'
  busy: true
}

export type WorkspacePaneTabItem = WorkspacePaneStaticTabItem | WorkspacePaneTerminalTabItem | WorkspacePanePendingTabItem

export function createStaticWorkspacePaneTabItem(input: {
  type: WorkspacePaneStaticViewType
  label: string
  tooltip: string
  closeLabel: string
  panelId?: string
}): WorkspacePaneStaticTabItem {
  return {
    identity: staticWorkspacePaneViewIdentity(input.type),
    type: input.type,
    kind: 'static',
    staticViewType: input.type,
    label: input.label,
    tooltip: input.tooltip,
    closeLabel: input.closeLabel,
    icon: input.type,
    panelId: input.panelId,
    sortableId: staticWorkspacePaneViewIdentity(input.type),
    orderEntry: { type: input.type, id: input.type },
  }
}

export function createTerminalWorkspacePaneTabItem(input: {
  view: TerminalWorkspacePaneViewSummary
  label: string
  tooltip: string
  closeLabel: string
  panelId?: string
}): WorkspacePaneTerminalTabItem {
  return {
    identity: workspacePaneViewIdentity(input.view),
    type: input.view.type,
    kind: 'terminal',
    view: input.view,
    label: input.label,
    tooltip: input.tooltip,
    closeLabel: input.closeLabel,
    icon: input.view.type,
    panelId: input.panelId,
    sortableId: workspacePaneViewIdentity(input.view),
    orderEntry: { type: 'terminal', id: input.view.id },
  }
}

export function createPendingWorkspacePaneTabItem(input: {
  type: WorkspacePaneView
  label: string
  tooltip: string
  panelId?: string
}): WorkspacePanePendingTabItem {
  const identity =
    input.type === 'terminal' ? PENDING_TERMINAL_WORKSPACE_PANE_VIEW_IDENTITY : `${input.type}:pending`
  return {
    identity,
    type: input.type,
    kind: 'pending',
    label: input.label,
    tooltip: input.tooltip,
    icon: input.type === 'terminal' ? 'terminal' : input.type,
    panelId: input.panelId,
    busy: true,
  }
}

export const EMPTY_WORKSPACE_PANE_VIEW_FOCUS_KEY = '__workspace-pane-empty__'

const WORKSPACE_PANE_VIEW_TOOLTIP_SELECTOR = '[data-workspace-pane-view-tooltip-id]'
const WORKSPACE_PANE_LEADING_ACTION_ID = '__workspace-pane-leading-action__'
const WORKSPACE_PANE_COMPACT_TRAILING_ACTION_ID = '__workspace-pane-compact-trailing-action__'
const WORKSPACE_PANE_NEW_ACTION_ID = '__workspace-pane-new-action__'

function shouldShowWorkspacePaneViewSeparator({
  leftId,
  rightId,
  activeId,
  hoveredId,
}: {
  leftId: string
  rightId: string | undefined
  activeId: string | null
  hoveredId: string | null
}): boolean {
  return !!rightId && leftId !== activeId && rightId !== activeId && leftId !== hoveredId && rightId !== hoveredId
}

interface WorkspacePaneViewSwitcherPopoverProps {
  items: WorkspacePaneTabItem[]
  activeTabIdentity: string | null
  label: string
  newLabel: string
  canCreateNew: boolean
  onNew: () => void
  onSelect: (identity: string) => void
  onClose: (event: React.MouseEvent, identity: string) => void
  t: (key: string, params?: Record<string, string | number>) => string
}

function WorkspacePaneViewSwitcherPopover({
  items,
  activeTabIdentity,
  label,
  newLabel,
  canCreateNew,
  onNew,
  onSelect,
  onClose,
  t,
}: WorkspacePaneViewSwitcherPopoverProps) {
  const [open, setOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  const selectView = (identity: string) => {
    setOpen(false)
    onSelect(identity)
  }

  const selectNew = () => {
    setOpen(false)
    onNew()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={label} title={label}>
          <ChevronDown size={14} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="flex w-max min-w-48 max-w-72 flex-col overflow-hidden p-0"
        aria-label={label}
        ref={contentRef}
        tabIndex={-1}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          contentRef.current?.focus({ preventScroll: true })
        }}
      >
        <ScrollArea className="max-h-64" scrollbarMode="compact">
          <div className="space-y-0.5 p-1" role="list">
            {items.map((item) => {
              const selected = item.identity === activeTabIdentity
              const pending = isPendingWorkspacePaneTabItem(item)
              return (
                <div key={item.identity} className="group relative flex items-center" role="listitem">
                  <button
                    type="button"
                    className={cn(
                      'flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm py-1 pl-2 text-left text-sm outline-none transition-colors duration-100 hover:bg-accent hover:text-accent-foreground',
                      'pr-8',
                      selected &&
                        'bg-selected text-selected-foreground hover:bg-selected hover:text-selected-foreground',
                    )}
                    onClick={() => selectView(item.identity)}
                    aria-label={item.tooltip}
                    aria-current={selected ? 'true' : undefined}
                  >
                    <span className="flex size-3.5 shrink-0 items-center justify-center">
                      {pending && item.busy ? (
                        <Loader2 size={13} className="animate-spin text-muted-foreground" aria-hidden />
                      ) : selected ? (
                        <Check size={13} aria-hidden />
                      ) : (
                        <WorkspacePaneViewIcon item={item} active={false} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {isTerminalWorkspacePaneTabItem(item) && item.view.hasBell && (
                      <>
                        <span className="h-2 w-2 shrink-0 rounded-full bg-notification" aria-hidden="true" />
                        <span className="sr-only">{t('terminal.bell-unread')}</span>
                      </>
                    )}
                  </button>
                  {!pending && (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      className="absolute right-1 top-1/2 size-6 -translate-y-1/2 text-muted-foreground"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => onClose(event, item.identity)}
                      title={item.closeLabel}
                      aria-label={item.closeLabel}
                    >
                      <X size={13} />
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </ScrollArea>
        {canCreateNew && (
          <div className="border-t border-separator p-1">
            <button
              type="button"
              className="flex h-7 w-full cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-sm text-popover-foreground outline-none transition-colors duration-100 hover:bg-accent hover:text-accent-foreground"
              onClick={selectNew}
            >
              <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
                <Plus size={14} />
              </span>
              <span className="min-w-0 flex-1 truncate">{newLabel}</span>
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function WorkspacePaneViewStrip({
  worktreeTerminalKey,
  items,
  workspacePaneId,
  activeTabIdentity,
  responsiveCompact,
  panelActive,
  leadingAction,
  focusRegistry: externalFocusRegistry,
  emptyFocusKey = EMPTY_WORKSPACE_PANE_VIEW_FOCUS_KEY,
  newTerminalBusy = false,
  onNew,
  onSelect,
  onScrollToBottom,
  onClose,
  onReorder,
  onNavigateOut,
  activateKeyboardNavigationSelection = false,
}: WorkspacePaneViewStripProps) {
  const t = useT()
  const terminalItems = useMemo(() => items.filter(isTerminalWorkspacePaneTabItem), [items])
  const sortableItems = useMemo(() => items.filter(isSortableWorkspacePaneTabItem), [items])
  const canCreateNew = worktreeTerminalKey !== null
  const showCollapsedTabs = !!responsiveCompact
  const activeItem = activeTabIdentity ? (items.find((item) => item.identity === activeTabIdentity) ?? null) : null
  const compactPendingItem = showCollapsedTabs ? (items.find(isPendingWorkspacePaneTabItem) ?? null) : null
  const selectedItem = activeItem ?? compactPendingItem
  const collapseToSelectedTab = showCollapsedTabs && selectedItem !== null
  const focusableTabIdentity = selectedItem?.identity ?? items[0]?.identity ?? null
  const internalFocusRegistry = useFocusRegistry<string, HTMLButtonElement>()
  const focusRegistry = externalFocusRegistry ?? internalFocusRegistry
  const viewportRef = useRef<HTMLDivElement>(null)
  const prevTabCountRef = useRef(items.length)
  const newButtonRef = useRef<HTMLButtonElement>(null)
  const pendingFocusIdentityRef = useRef<string | null>(null)
  const [hoveredTabIdentity, setHoveredTabIdentity] = useState<string | null>(null)
  const [focusRequestVersion, setFocusRequestVersion] = useState(0)

  useLayoutEffect(() => {
    const prevTabCount = prevTabCountRef.current
    if (items.length <= prevTabCount) {
      prevTabCountRef.current = items.length
      return
    }
    prevTabCountRef.current = items.length
    const newItem = items[items.length - 1]
    if (newItem && isPendingWorkspacePaneTabItem(newItem)) return
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
  }, [items.length])

  useLayoutEffect(() => {
    const pendingFocusIdentity = pendingFocusIdentityRef.current
    if (!pendingFocusIdentity) return
    if (!items.some((item) => item.identity === pendingFocusIdentity)) {
      pendingFocusIdentityRef.current = null
      return
    }
    focusRegistry.focus(pendingFocusIdentity)
    pendingFocusIdentityRef.current = null
  }, [focusRegistry, focusRequestVersion, items])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const restrictToVisibleTabStrip = useMemo(
    () => createRestrictToTabStripBounds({ rightBoundaryRef: newButtonRef }),
    [],
  )

  // Must be called unconditionally so the hook order stays stable across renders
  // (e.g. when worktree items go from 0 → 1 or back, which would otherwise bypass the
  // helper below and trigger React's "Rendered more hooks than during the previous render").
  const sortableIds = useMemo(() => sortableItems.map((item) => item.sortableId), [sortableItems])

  const handleSelect = useCallback(
    (identity: string) => {
      const item = items.find((candidate) => candidate.identity === identity)
      if (!item) return
      if (isPendingWorkspacePaneTabItem(item)) return
      if (isTerminalWorkspacePaneTabItem(item) && item.identity === activeTabIdentity && panelActive) {
        onScrollToBottom(item.view.key)
      } else {
        onSelect(item)
      }
    },
    [activeTabIdentity, items, panelActive, onScrollToBottom, onSelect],
  )

  const handleClose = useCallback(
    (event: React.MouseEvent, identity: string) => {
      event.preventDefault()
      event.stopPropagation()

      const item = items.find((candidate) => candidate.identity === identity)
      if (!item) return
      if (isPendingWorkspacePaneTabItem(item)) return
      const isActive = item.identity === activeTabIdentity
      const idx = items.findIndex((candidate) => candidate.identity === identity)
      const nextItem =
        items.slice(idx + 1).find((candidate) => !isPendingWorkspacePaneTabItem(candidate)) ??
        items
          .slice(0, idx)
          .reverse()
          .find((candidate) => !isPendingWorkspacePaneTabItem(candidate)) ??
        null
      const nextKey = nextItem?.identity ?? null

      setHoveredTabIdentity(null)
      if (isActive && nextKey) pendingFocusIdentityRef.current = nextKey
      onClose(item)

      if (isActive && nextKey) {
        setFocusRequestVersion((version) => version + 1)
      }
    },
    [activeTabIdentity, items, onClose],
  )

  const tabIdForItem = useCallback(
    (item: WorkspacePaneTabItem) => {
      if (isStaticWorkspacePaneTabItem(item)) return `${workspacePaneId}-${item.staticViewType}-tab`
      if (isPendingWorkspacePaneTabItem(item)) return `${workspacePaneId}-${item.type}-pending-tab`
      const index = terminalItems.findIndex((candidate) => candidate.identity === item.identity)
      return workspacePaneViewButtonId(workspacePaneId, Math.max(0, index))
    },
    [workspacePaneId, terminalItems],
  )

  const activateKeyboardNavigationTarget = useCallback(
    (fromIdentity: string, toIdentity: string) => {
      const to = items.find((item) => item.identity === toIdentity)
      if (!activateKeyboardNavigationSelection || fromIdentity === toIdentity || !to) return
      if (isPendingWorkspacePaneTabItem(to)) return
      onSelect(to)
    },
    [activateKeyboardNavigationSelection, items, onSelect],
  )

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, tabIdentity: string) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return
      e.preventDefault()
      const keys = items.filter((item) => !isPendingWorkspacePaneTabItem(item)).map((item) => item.identity)
      const idx = keys.indexOf(tabIdentity)
      if (idx === -1) return
      if (collapseToSelectedTab) {
        if (e.key === 'ArrowLeft') onNavigateOut?.('prev')
        else if (e.key === 'ArrowRight') onNavigateOut?.('next')
        else focusRegistry.focus(tabIdentity)
        return
      }
      if (e.key === 'Home') {
        const firstKey = keys[0]
        if (firstKey) {
          focusRegistry.focus(firstKey)
          activateKeyboardNavigationTarget(tabIdentity, firstKey)
        }
        return
      }
      if (e.key === 'End') {
        const lastKey = keys[keys.length - 1]
        if (lastKey) {
          focusRegistry.focus(lastKey)
          activateKeyboardNavigationTarget(tabIdentity, lastKey)
        }
        return
      }
      if (e.key === 'ArrowLeft' && idx === 0) {
        onNavigateOut?.('prev')
        if (onNavigateOut) return
      }
      if (e.key === 'ArrowRight' && idx === keys.length - 1) {
        onNavigateOut?.('next')
        if (onNavigateOut) return
      }
      const nextIdx = e.key === 'ArrowLeft' ? (idx - 1 + keys.length) % keys.length : (idx + 1) % keys.length
      const nextKey = keys[nextIdx]
      if (nextKey) {
        focusRegistry.focus(nextKey)
        activateKeyboardNavigationTarget(tabIdentity, nextKey)
      }
    },
    [activateKeyboardNavigationTarget, collapseToSelectedTab, focusRegistry, items, onNavigateOut],
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over) return
      const activeId = String(active.id)
      const overId = String(over.id)
      if (activeId === overId) return
      const oldIndex = sortableItems.findIndex((item) => item.sortableId === activeId)
      const newIndex = sortableItems.findIndex((item) => item.sortableId === overId)
      if (oldIndex === -1 || newIndex === -1) return
      const activeItem = sortableItems[oldIndex]
      const overItem = sortableItems[newIndex]
      if (!activeItem || !overItem) return
      onReorder(arrayMove(sortableItems.map((item) => item.orderEntry), oldIndex, newIndex))
    },
    [onReorder, sortableItems],
  )

  if (items.length === 0) {
    if (!canCreateNew) return null
    return (
      <WorkspacePaneNewButton
        ref={focusRegistry.setRef(emptyFocusKey)}
        id={`${workspacePaneId}-workspace-pane-view-empty`}
        onClick={onNew}
        busy={newTerminalBusy}
        t={t}
      />
    )
  }

  function renderCompactTabsBody() {
    const compactItem = selectedItem
    if (!compactItem) return null
    const newTerminalLabelKey = newTerminalBusy ? 'terminal.loading' : 'terminal.new'
    // Compact tabs intentionally use muted chrome even when selected, so
    // selection should not suppress separators; hover still does.
    const compactActiveVisualIdentity = null

    return (
      <ToolbarTabStripBody className="flex-1">
        {leadingAction && (
          <WorkspacePaneLeadingAction
            showSeparator={shouldShowWorkspacePaneViewSeparator({
              leftId: WORKSPACE_PANE_LEADING_ACTION_ID,
              rightId: compactItem.identity,
              activeId: compactActiveVisualIdentity,
              hoveredId: hoveredTabIdentity,
            })}
            onHoverChange={setHoveredTabIdentity}
          >
            {leadingAction}
          </WorkspacePaneLeadingAction>
        )}
        <WorkspacePaneViewTooltipLayer
          items={items}
          role="tablist"
          aria-label={t('workspace-pane-views.tabs')}
          className="flex-1"
        >
          <WorkspacePaneView
            item={compactItem}
            isActive={!!panelActive && compactItem.identity === activeTabIdentity}
            isSelected={compactItem.identity === activeTabIdentity}
            isFocusable={compactItem.identity === focusableTabIdentity}
            tabId={
              isStaticWorkspacePaneTabItem(compactItem) || isPendingWorkspacePaneTabItem(compactItem)
                ? tabIdForItem(compactItem)
                : workspacePaneViewButtonId(workspacePaneId, 0)
            }
            focusRegistry={focusRegistry}
            onSelect={handleSelect}
            onClose={handleClose}
            onKeyDown={handleTabKeyDown}
            t={t}
            compact={collapseToSelectedTab}
            showSeparator={shouldShowWorkspacePaneViewSeparator({
              leftId: compactItem.identity,
              rightId: WORKSPACE_PANE_COMPACT_TRAILING_ACTION_ID,
              activeId: compactActiveVisualIdentity,
              hoveredId: hoveredTabIdentity,
            })}
            onHoverChange={setHoveredTabIdentity}
          />
        </WorkspacePaneViewTooltipLayer>
        <WorkspacePaneViewSwitcherPopover
          items={items}
          activeTabIdentity={activeTabIdentity}
          label={t('workspace-pane-views.tabs')}
          newLabel={t(newTerminalLabelKey)}
          canCreateNew={canCreateNew && !newTerminalBusy}
          onNew={onNew}
          onSelect={handleSelect}
          onClose={handleClose}
          t={t}
        />
      </ToolbarTabStripBody>
    )
  }

  function renderScrollableTabsBody() {
    const activeVisualIdentity = panelActive ? activeTabIdentity : null

    return (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVisibleTabStrip]}
        onDragEnd={handleDragEnd}
      >
        <ToolbarTabStripBody scroll>
          {leadingAction && (
            <WorkspacePaneLeadingAction
              showSeparator={shouldShowWorkspacePaneViewSeparator({
                leftId: WORKSPACE_PANE_LEADING_ACTION_ID,
                rightId: items[0]?.identity,
                activeId: activeVisualIdentity,
                hoveredId: hoveredTabIdentity,
              })}
              onHoverChange={setHoveredTabIdentity}
            >
              {leadingAction}
            </WorkspacePaneLeadingAction>
          )}
          <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
            <WorkspacePaneViewTooltipLayer items={items} role="tablist" aria-label={t('workspace-pane-views.tabs')}>
              {items.map((item, index) => {
                const nextItem = items[index + 1]
                const rightId = nextItem ? nextItem.identity : WORKSPACE_PANE_NEW_ACTION_ID
                const commonProps = {
                  item,
                  isActive: !!panelActive && item.identity === activeTabIdentity,
                  isSelected: item.identity === activeTabIdentity,
                  isFocusable: item.identity === focusableTabIdentity,
                  index,
                  total: items.length,
                  tabId: tabIdForItem(item),
                  focusRegistry,
                  showSeparator:
                    shouldShowWorkspacePaneViewSeparator({
                      leftId: item.identity,
                      rightId,
                      activeId: activeVisualIdentity,
                      hoveredId: hoveredTabIdentity,
                    }),
                  onHoverChange: setHoveredTabIdentity,
                  onSelect: handleSelect,
                  onClose: handleClose,
                  onKeyDown: handleTabKeyDown,
                  t,
                  compact: false,
                }
                if (!isSortableWorkspacePaneTabItem(item)) {
                  return <WorkspacePaneView key={item.identity} {...commonProps} />
                }
                return (
                  <SortableWorkspacePaneView key={item.identity} {...commonProps} sortableIdentity={item.sortableId} />
                )
              })}
            </WorkspacePaneViewTooltipLayer>
          </SortableContext>
          {canCreateNew ? (
            <WorkspacePaneNewButton
              ref={newButtonRef}
              id={items.length === 0 ? `${workspacePaneId}-workspace-pane-view-empty` : undefined}
              onClick={onNew}
              busy={newTerminalBusy}
              t={t}
            />
          ) : null}
        </ToolbarTabStripBody>
      </DndContext>
    )
  }

  return (
    <ToolbarTabStrip
      compact={collapseToSelectedTab}
      compactContent={renderCompactTabsBody()}
      scrollContent={renderScrollableTabsBody()}
      viewportRef={viewportRef}
    />
  )
}

interface WorkspacePaneViewProps {
  item: WorkspacePaneTabItem
  isActive: boolean
  isSelected: boolean
  isFocusable: boolean
  index?: number
  total?: number
  tabId: string
  focusRegistry: FocusRegistry<string, HTMLButtonElement>
  onSelect: (identity: string) => void
  onClose: (event: React.MouseEvent, identity: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>, identity: string) => void
  t: (key: string, params?: Record<string, string | number>) => string
  compact?: boolean
  showSeparator?: boolean
  onHoverChange?: (identity: string | null) => void
}

function WorkspacePaneLeadingAction({
  children,
  showSeparator,
  onHoverChange,
}: {
  children: ReactNode
  showSeparator: boolean
  onHoverChange: (identity: string | null) => void
}) {
  return (
    <div
      className="relative flex h-7 shrink-0 items-center pr-1"
      onPointerEnter={() => onHoverChange(WORKSPACE_PANE_LEADING_ACTION_ID)}
      onPointerLeave={() => onHoverChange(null)}
    >
      {children}
      {showSeparator && (
        <Separator orientation="vertical" className="absolute right-0 top-1/2 -translate-y-1/2" />
      )}
    </div>
  )
}

const WorkspacePaneNewButton = forwardRef<
  HTMLButtonElement,
  {
    id?: string
    onClick: () => void
    busy?: boolean
    compact?: boolean
    t: (key: string, params?: Record<string, string | number>) => string
  }
>(function WorkspacePaneNewButton({ id, onClick, busy = false, compact = false, t }, ref) {
  const labelKey = busy ? 'terminal.loading' : 'terminal.new'
  const label = t(labelKey)
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="icon"
      className={cn('h-7 w-7 shrink-0', compact && 'w-7')}
      id={id}
      onClick={busy ? undefined : onClick}
      disabled={busy}
      aria-label={label}
      title={label}
      aria-busy={busy || undefined}
      data-workspace-pane-new-button=""
    >
      {busy ? <Loader2 size={14} className="animate-spin shrink-0" /> : <Plus size={14} />}
    </Button>
  )
})

interface WorkspacePaneViewChromeProps {
  item: WorkspacePaneTabItem
  isActive: boolean
  isSelected: boolean
  isFocusable: boolean
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
  showSeparator?: boolean
  onHoverChange?: (identity: string | null) => void
}

function WorkspacePaneViewChrome({
  item,
  isActive,
  isSelected,
  isFocusable,
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
  showSeparator = false,
  onHoverChange,
}: WorkspacePaneViewChromeProps) {
  const bellUnreadLabel = t('terminal.bell-unread')
  const ariaLabel =
    isTerminalWorkspacePaneTabItem(item) && item.view.hasBell
      ? `${item.label} — ${bellUnreadLabel}`
      : item.label
  const closeProps = isPendingWorkspacePaneTabItem(item)
    ? ({ closeButton: false } as const)
    : ({
        closeLabel: item.closeLabel,
        closeVisible: isActive && !compact,
        onClose: (e: React.MouseEvent<HTMLButtonElement>) => onClose(e, item.identity),
      } as const)
  const collectionAria =
    index !== undefined && total !== undefined
      ? {
          'aria-posinset': index + 1,
          'aria-setsize': total,
        }
      : {}
  return (
    <ToolbarClosableTab
      containerProps={{
        'data-workspace-pane-view-tooltip-id': item.identity,
        'data-workspace-pane-pending-view': isPendingWorkspacePaneTabItem(item) ? item.type : undefined,
        onPointerEnter: () => onHoverChange?.(item.identity),
        onPointerLeave: () => onHoverChange?.(null),
      }}
      containerClassName={toolbarTabChromeClassName({
        variant: 'workspace',
        active: isActive,
        dragging: isDragging,
        compact,
      })}
      overlay={
        showSeparator ? (
          <Separator orientation="vertical" className="absolute right-0 top-1/2 -translate-y-1/2" />
        ) : null
      }
      buttonRef={buttonRef}
      buttonProps={{
        ...buttonProps,
        role: 'tab',
        id: tabId,
        'aria-selected': isSelected,
        'aria-label': ariaLabel,
        'aria-controls': item.panelId,
        'aria-busy': isPendingWorkspacePaneTabItem(item) && item.busy ? true : undefined,
        ...collectionAria,
        tabIndex: isFocusable ? 0 : -1,
        onClick: () => onSelect(item.identity),
        onKeyDown: (e) => onKeyDown(e, item.identity),
      }}
      buttonClassName={toolbarTabButtonClassName('workspace')}
      {...closeProps}
    >
      {isPendingWorkspacePaneTabItem(item) && item.busy ? (
        <Loader2 size={13} className="shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <WorkspacePaneViewIcon item={item} active={isActive} compact={compact} />
      )}
      <span className="truncate">{item.label}</span>
      {isTerminalWorkspacePaneTabItem(item) && item.view.hasBell && (
        <>
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-notification opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-notification" />
          </span>
          <span className="sr-only">{t('terminal.bell-unread')}</span>
        </>
      )}
    </ToolbarClosableTab>
  )
}

function WorkspacePaneView({
  item,
  isActive,
  isSelected,
  isFocusable,
  index,
  total,
  tabId,
  focusRegistry,
  onSelect,
  onClose,
  onKeyDown,
  t,
  compact,
  showSeparator,
  onHoverChange,
}: WorkspacePaneViewProps) {
  return (
    <WorkspacePaneViewChrome
      item={item}
      isActive={isActive}
      isSelected={isSelected}
      isFocusable={isFocusable}
      index={index}
      total={total}
      tabId={tabId}
      buttonRef={focusRegistry.setRef(item.identity)}
      onSelect={onSelect}
      onClose={onClose}
      onKeyDown={onKeyDown}
      t={t}
      compact={compact}
      showSeparator={showSeparator}
      onHoverChange={onHoverChange}
    />
  )
}

function SortableWorkspacePaneView({
  sortableIdentity,
  item,
  isActive,
  isSelected,
  isFocusable,
  index,
  total,
  tabId,
  focusRegistry,
  onSelect,
  onClose,
  onKeyDown,
  t,
  compact,
  showSeparator,
  onHoverChange,
}: WorkspacePaneViewProps & { sortableIdentity: string }) {
  const sortable = useSortableTab(sortableIdentity, { onButtonRef: focusRegistry.setRef(item.identity) })

  return (
    <div ref={sortable.setContainerRef} style={sortable.style} className="touch-none select-none">
      <WorkspacePaneViewChrome
        item={item}
        isActive={isActive}
        isSelected={isSelected}
        isFocusable={isFocusable}
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
          onKeyDown(e, item.identity)
        }}
        t={t}
        compact={compact}
        showSeparator={showSeparator}
        onHoverChange={onHoverChange}
      />
    </div>
  )
}

interface WorkspacePaneViewTooltipLayerProps extends ComponentPropsWithoutRef<'div'> {
  items: WorkspacePaneTabItem[]
}

function WorkspacePaneViewTooltipLayer({ items, children, ...props }: WorkspacePaneViewTooltipLayerProps) {
  return (
    <DelegatedTooltipLayer
      items={items}
      selector={WORKSPACE_PANE_VIEW_TOOLTIP_SELECTOR}
      attributeName="data-workspace-pane-view-tooltip-id"
      getItemId={(item) => item.identity}
      renderTooltip={(item) => <div className="truncate text-xs font-semibold text-foreground">{item.tooltip}</div>}
      placement="bottom-start"
      delayMs={500}
      tooltipClassName="px-3 py-2"
      asChild
    >
      <ToolbarTabList aria-orientation={props.role === 'tablist' ? 'horizontal' : undefined} {...props}>
        {children}
      </ToolbarTabList>
    </DelegatedTooltipLayer>
  )
}

function WorkspacePaneViewIcon({
  item,
  active,
  compact = false,
}: {
  item: WorkspacePaneTabItem
  active: boolean
  compact?: boolean
}) {
  const className = toolbarTabIconClassName(active, compact)
  if (item.icon === 'status') return <GitBranch size={13} className={className} />
  if (item.icon === 'changes') return <FileText size={13} className={className} />
  if (item.icon === 'history') return <History size={13} className={className} />
  return <Terminal size={13} className={className} />
}

export function isStaticWorkspacePaneTabItem(item: WorkspacePaneTabItem): item is WorkspacePaneStaticTabItem {
  return item.kind === 'static'
}

export function isTerminalWorkspacePaneTabItem(item: WorkspacePaneTabItem): item is WorkspacePaneTerminalTabItem {
  return item.kind === 'terminal' && item.view.type === 'terminal'
}

export function isPendingWorkspacePaneTabItem(item: WorkspacePaneTabItem): item is WorkspacePanePendingTabItem {
  return item.kind === 'pending'
}

function isSortableWorkspacePaneTabItem(
  item: WorkspacePaneTabItem,
): item is WorkspacePaneStaticTabItem | WorkspacePaneTerminalTabItem {
  return item.kind === 'static' || item.kind === 'terminal'
}

function arrayMove<T>(array: T[], from: number, to: number): T[] {
  const result = array.slice()
  const [removed] = result.splice(from, 1)
  if (removed === undefined) return result
  result.splice(to, 0, removed)
  return result
}
