import { useCallback, useMemo, useRef, useState, type RefObject } from 'react'
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
import { createRestrictToTabStripBounds } from '#/web/components/tab-strip/drag-bounds.ts'
import { useT } from '#/web/stores/i18n.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { ToolbarTabStrip, ToolbarTabStripBody } from '#/web/components/tab-strip/ToolbarTabStrip.tsx'
import { useFocusRegistry, type FocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { workspacePaneRuntimeTabProvider, workspacePaneStaticTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import {
  type WorkspacePaneRuntimeTabItem,
  type WorkspacePaneStaticTabItem,
  type WorkspacePaneTabItem,
  isPendingWorkspacePaneTabItem,
  isRuntimeWorkspacePaneTabItem,
  isStaticWorkspacePaneTabItem,
} from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import {
  scrollWorkspacePaneTabTargetIntoView,
  useDeferredActiveWorkspacePaneTabFocusAfterClose,
  usePrefersReducedMotion,
  useWorkspacePaneTabStripAutoScroll,
  useWorkspacePaneTabStripScrollMemory,
} from '#/web/components/workspace-pane/workspace-pane-tab-strip-mechanics.ts'
import {
  SortableWorkspacePaneTab,
  WorkspacePaneNewButton,
  WorkspacePaneTab,
  WorkspacePaneTabSwitcherPopover,
  WorkspacePaneTabTooltipLayer,
  type WorkspacePaneT,
  type WorkspacePaneTabCreateAction,
} from '#/web/components/workspace-pane/WorkspacePaneTabPresentation.tsx'

interface WorkspacePaneTabStripProps {
  workspacePaneTabTargetKey: string
  items: WorkspacePaneTabItem[]
  workspacePaneId: string
  responsiveCompact?: boolean
  activeTabIdentity: string | null
  panelActive?: boolean
  focusRegistry?: FocusRegistry<string, HTMLButtonElement>
  emptyFocusKey?: string
  createAction?: WorkspacePaneTabCreateAction | null
  onSelect: (item: WorkspacePaneTabItem) => void
  onReselect: (item: WorkspacePaneTabItem) => void
  onClose: (item: WorkspacePaneTabItem) => void
  onReorder: (tabs: WorkspacePaneTabEntry[]) => void
  onNavigateOut?: (direction: 'prev' | 'next' | 'first' | 'last') => void
  activateKeyboardNavigationSelection?: boolean
}

export const EMPTY_WORKSPACE_PANE_TAB_FOCUS_KEY = '__workspace-pane-empty__'

// Virtual right-edge for the compact tab's separator computation. The popover
// trigger that follows the tab is the only real DOM node on that side, but it
// doesn't report hover state, so we use this sentinel identity instead.
const WORKSPACE_PANE_COMPACT_TRAILING_ACTION_ID = '__workspace-pane-compact-trailing-action__'
const WORKSPACE_PANE_NEW_ACTION_ID = '__workspace-pane-new-action__'

function shouldShowWorkspacePaneTabSeparator({
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

function useWorkspacePaneTabDnd({
  sortableItems,
  newButtonRef,
  disabled,
  onReorder,
}: {
  sortableItems: readonly (WorkspacePaneStaticTabItem | WorkspacePaneRuntimeTabItem)[]
  newButtonRef: RefObject<HTMLButtonElement | null>
  disabled: boolean
  onReorder: (tabs: WorkspacePaneTabEntry[]) => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const restrictToVisibleTabStrip = useMemo(
    () => createRestrictToTabStripBounds({ rightBoundaryRef: newButtonRef }),
    [newButtonRef],
  )
  // Must be called unconditionally so the hook order stays stable across renders
  // (e.g. when worktree items go from 0 -> 1 or back).
  const sortableIds = useMemo(() => sortableItems.map((item) => item.sortableId), [sortableItems])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (disabled) return
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
      onReorder(
        arrayMove(
          sortableItems.map((item) => item.tabEntry),
          oldIndex,
          newIndex,
        ),
      )
    },
    [disabled, onReorder, sortableItems],
  )

  return {
    sensors,
    restrictToVisibleTabStrip,
    sortableIds,
    handleDragEnd,
  }
}

export function WorkspacePaneTabStrip({
  workspacePaneTabTargetKey,
  items,
  workspacePaneId,
  activeTabIdentity,
  responsiveCompact,
  panelActive,
  focusRegistry: externalFocusRegistry,
  emptyFocusKey = EMPTY_WORKSPACE_PANE_TAB_FOCUS_KEY,
  createAction = null,
  onSelect,
  onReselect,
  onClose,
  onReorder,
  onNavigateOut,
  activateKeyboardNavigationSelection = false,
}: WorkspacePaneTabStripProps) {
  const t = useT()
  const sortableItems = useMemo(() => items.filter(isSortableWorkspacePaneTabItem), [items])
  const showCollapsedTabs = !!responsiveCompact
  const activeItem = activeTabIdentity ? (items.find((item) => item.identity === activeTabIdentity) ?? null) : null
  const compactPendingItem = showCollapsedTabs ? (items.find(isPendingWorkspacePaneTabItem) ?? null) : null
  const selectedItem = activeItem ?? compactPendingItem
  // Compact mode is a structural choice — driven by screen size, not data.
  // Decoupling it from `selectedItem` means the strip never falls through to
  // the scrollable layout when there is no active tab; the compact body
  // handles that case itself (empty tab area + popover switcher).
  const collapseToSelectedTab = showCollapsedTabs
  const focusableTabIdentity = selectedItem?.identity ?? items[0]?.identity ?? null
  const internalFocusRegistry = useFocusRegistry<string, HTMLButtonElement>()
  const focusRegistry = externalFocusRegistry ?? internalFocusRegistry
  const viewportRef = useRef<HTMLDivElement>(null)
  const newButtonRef = useRef<HTMLButtonElement>(null)
  const prefersReducedMotion = usePrefersReducedMotion()
  const scrollBehavior: ScrollBehavior = prefersReducedMotion ? 'auto' : 'smooth'
  const [hoveredTabIdentity, setHoveredTabIdentity] = useState<string | null>(null)
  const focusActiveTabAfterClose = useDeferredActiveWorkspacePaneTabFocusAfterClose({
    activeTabIdentity,
    items,
    focusRegistry,
  })
  const tabDnd = useWorkspacePaneTabDnd({
    sortableItems,
    newButtonRef,
    disabled: !!createAction?.blocksTabInteraction,
    onReorder,
  })
  const scrollNewButtonIntoView = useCallback(() => {
    const viewport = viewportRef.current
    const target = newButtonRef.current
    if (!viewport || !target) return
    scrollWorkspacePaneTabTargetIntoView({
      viewport,
      target,
      behavior: scrollBehavior,
    })
  }, [scrollBehavior])
  const handleNew = useCallback(() => {
    if (!createAction || createAction.busy) return
    scrollNewButtonIntoView()
    createAction.onCreate()
  }, [createAction, scrollNewButtonIntoView])
  const renderCreateAction = createAction
    ? {
        label: createAction.label,
        busy: createAction.busy ?? false,
        blocksTabInteraction: createAction.blocksTabInteraction ?? false,
        onCreate: handleNew,
      }
    : null
  const tabInteractionBlocked = renderCreateAction?.blocksTabInteraction ?? false
  const handleViewportScroll = useWorkspacePaneTabStripScrollMemory({
    workspacePaneTabTargetKey,
    enabled: !collapseToSelectedTab,
    viewportRef,
  })

  useWorkspacePaneTabStripAutoScroll({
    workspacePaneTabTargetKey,
    activeTabIdentity,
    items,
    enabled: !collapseToSelectedTab,
    viewportRef,
    newButtonRef,
    scrollBehavior,
    getTabElement: focusRegistry.getRef,
  })

  const handleSelect = useCallback(
    (identity: string) => {
      const item = items.find((candidate) => candidate.identity === identity)
      if (tabInteractionBlocked) return
      if (!item) return
      if (isPendingWorkspacePaneTabItem(item)) return
      if (item.identity === activeTabIdentity && panelActive) onReselect(item)
      else onSelect(item)
    },
    [activeTabIdentity, items, onReselect, onSelect, panelActive, tabInteractionBlocked],
  )

  const handleClose = useCallback(
    (event: React.MouseEvent, identity: string) => {
      event.preventDefault()
      event.stopPropagation()
      if (tabInteractionBlocked) return

      const item = items.find((candidate) => candidate.identity === identity)
      if (!item) return
      if (isPendingWorkspacePaneTabItem(item)) return
      const isActive = item.identity === activeTabIdentity

      setHoveredTabIdentity(null)
      if (isActive) focusActiveTabAfterClose(identity)
      onClose(item)
    },
    [activeTabIdentity, focusActiveTabAfterClose, items, onClose, tabInteractionBlocked],
  )

  const tabIdForItem = useCallback(
    (item: WorkspacePaneTabItem) => {
      if (isStaticWorkspacePaneTabItem(item)) {
        return workspacePaneStaticTabProvider(item.staticTabType).buttonId(workspacePaneId)
      }
      if (isPendingWorkspacePaneTabItem(item)) return `${workspacePaneId}-${item.type}-pending-tab`
      const runtimeItems = items.filter(
        (candidate) => candidate.kind === 'runtime' && candidate.runtimeType === item.runtimeType,
      )
      const index = runtimeItems.findIndex((candidate) => candidate.identity === item.identity)
      return workspacePaneRuntimeTabProvider(item.runtimeType).buttonId(workspacePaneId, Math.max(0, index))
    },
    [workspacePaneId, items],
  )

  const activateKeyboardNavigationTarget = useCallback(
    (fromIdentity: string, toIdentity: string) => {
      const to = items.find((item) => item.identity === toIdentity)
      if (tabInteractionBlocked) return
      if (!activateKeyboardNavigationSelection || fromIdentity === toIdentity || !to) return
      if (isPendingWorkspacePaneTabItem(to)) return
      onSelect(to)
    },
    [activateKeyboardNavigationSelection, items, onSelect, tabInteractionBlocked],
  )

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, tabIdentity: string) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return
      e.preventDefault()
      if (tabInteractionBlocked) return
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
    [
      activateKeyboardNavigationTarget,
      collapseToSelectedTab,
      focusRegistry,
      items,
      onNavigateOut,
      tabInteractionBlocked,
    ],
  )

  const tabBodyContext: WorkspacePaneTabBodyContext = {
    activeTabIdentity,
    panelActive,
    focusableTabIdentity,
    focusRegistry,
    hoveredTabIdentity,
    tabIdForItem,
    onHoverChange: setHoveredTabIdentity,
    onSelect: handleSelect,
    onClose: handleClose,
    onKeyDown: handleTabKeyDown,
    t,
    tabInteractionBlocked,
  }

  if (items.length === 0) {
    if (!renderCreateAction) return null
    return (
      <WorkspacePaneNewButton
        ref={focusRegistry.setRef(emptyFocusKey)}
        id={`${workspacePaneId}-workspace-pane-tab-empty`}
        action={renderCreateAction}
      />
    )
  }

  return (
    <ToolbarTabStrip
      compact={collapseToSelectedTab}
      compactContent={
        <WorkspacePaneCompactTabsBody
          items={items}
          compactItem={selectedItem}
          workspacePaneId={workspacePaneId}
          context={tabBodyContext}
          createAction={renderCreateAction}
        />
      }
      scrollContent={
        <WorkspacePaneScrollableTabsBody
          items={items}
          context={tabBodyContext}
          createAction={renderCreateAction}
          newButtonRef={newButtonRef}
          workspacePaneId={workspacePaneId}
          dnd={tabDnd}
        />
      }
      viewportRef={viewportRef}
      viewportOnScroll={handleViewportScroll}
    />
  )
}

interface WorkspacePaneTabBodyContext {
  activeTabIdentity: string | null
  panelActive?: boolean
  focusableTabIdentity: string | null
  focusRegistry: FocusRegistry<string, HTMLButtonElement>
  hoveredTabIdentity: string | null
  tabIdForItem: (item: WorkspacePaneTabItem) => string
  onHoverChange: (identity: string | null) => void
  onSelect: (identity: string) => void
  onClose: (event: React.MouseEvent, identity: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>, identity: string) => void
  t: WorkspacePaneT
  tabInteractionBlocked: boolean
}

interface WorkspacePaneTabBodyCommonProps {
  items: WorkspacePaneTabItem[]
  context: WorkspacePaneTabBodyContext
}

interface WorkspacePaneCompactTabsBodyProps extends WorkspacePaneTabBodyCommonProps {
  compactItem: WorkspacePaneTabItem | null
  workspacePaneId: string
  createAction: WorkspacePaneTabCreateAction | null
}

function WorkspacePaneCompactTabsBody({
  items,
  compactItem,
  workspacePaneId,
  context,
  createAction,
}: WorkspacePaneCompactTabsBodyProps) {
  const {
    activeTabIdentity,
    panelActive,
    focusableTabIdentity,
    focusRegistry,
    hoveredTabIdentity,
    tabIdForItem,
    onHoverChange,
    onSelect,
    onClose,
    onKeyDown,
    t,
    tabInteractionBlocked,
  } = context
  // Compact tabs intentionally use muted chrome even when selected, so
  // selection should not suppress separators; hover still does.
  const compactActiveVisualIdentity = null

  return (
    <ToolbarTabStripBody className="flex-1">
      <WorkspacePaneTabTooltipLayer
        items={items}
        role="tablist"
        aria-label={t('workspace-pane-tabs.tabs')}
        className="flex-1"
      >
        {compactItem ? (
          <WorkspacePaneTab
            item={compactItem}
            isActive={!!panelActive && compactItem.identity === activeTabIdentity}
            isSelected={compactItem.identity === activeTabIdentity}
            isFocusable={compactItem.identity === focusableTabIdentity}
            tabId={
              compactItem.kind === 'runtime'
                ? workspacePaneRuntimeTabProvider(compactItem.runtimeType).buttonId(workspacePaneId, 0)
                : tabIdForItem(compactItem)
            }
            focusRegistry={focusRegistry}
            onSelect={onSelect}
            onClose={onClose}
            onKeyDown={onKeyDown}
            t={t}
            interactionDisabled={tabInteractionBlocked}
            compact
            showSeparator={shouldShowWorkspacePaneTabSeparator({
              leftId: compactItem.identity,
              rightId: WORKSPACE_PANE_COMPACT_TRAILING_ACTION_ID,
              activeId: compactActiveVisualIdentity,
              hoveredId: hoveredTabIdentity,
            })}
            onHoverChange={onHoverChange}
          />
        ) : null}
      </WorkspacePaneTabTooltipLayer>
      <WorkspacePaneTabSwitcherPopover
        items={items}
        activeTabIdentity={activeTabIdentity}
        label={t('workspace-pane-tabs.tabs')}
        createAction={createAction}
        tabInteractionBlocked={tabInteractionBlocked}
        onSelect={onSelect}
        onClose={onClose}
        t={t}
      />
    </ToolbarTabStripBody>
  )
}

interface WorkspacePaneScrollableTabsBodyProps extends WorkspacePaneTabBodyCommonProps {
  createAction: WorkspacePaneTabCreateAction | null
  newButtonRef: RefObject<HTMLButtonElement | null>
  workspacePaneId: string
  dnd: ReturnType<typeof useWorkspacePaneTabDnd>
}

function WorkspacePaneScrollableTabsBody({
  items,
  context,
  createAction,
  newButtonRef,
  workspacePaneId,
  dnd,
}: WorkspacePaneScrollableTabsBodyProps) {
  const {
    activeTabIdentity,
    panelActive,
    focusableTabIdentity,
    focusRegistry,
    hoveredTabIdentity,
    tabIdForItem,
    onHoverChange,
    onSelect,
    onClose,
    onKeyDown,
    t,
    tabInteractionBlocked,
  } = context
  const { sensors, restrictToVisibleTabStrip, sortableIds, handleDragEnd } = dnd
  const activeVisualIdentity = panelActive ? activeTabIdentity : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVisibleTabStrip]}
      onDragEnd={handleDragEnd}
    >
      <ToolbarTabStripBody scroll>
        <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
          <WorkspacePaneTabTooltipLayer items={items} role="tablist" aria-label={t('workspace-pane-tabs.tabs')}>
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
                showSeparator: shouldShowWorkspacePaneTabSeparator({
                  leftId: item.identity,
                  rightId,
                  activeId: activeVisualIdentity,
                  hoveredId: hoveredTabIdentity,
                }),
                onHoverChange,
                onSelect,
                onClose,
                onKeyDown,
                t,
                interactionDisabled: tabInteractionBlocked,
                compact: false,
              }
              if (!isSortableWorkspacePaneTabItem(item)) {
                return <WorkspacePaneTab key={item.identity} {...commonProps} />
              }
              return (
                <SortableWorkspacePaneTab key={item.identity} {...commonProps} sortableIdentity={item.sortableId} />
              )
            })}
          </WorkspacePaneTabTooltipLayer>
        </SortableContext>
        {createAction ? (
          <WorkspacePaneNewButton
            ref={newButtonRef}
            id={items.length === 0 ? `${workspacePaneId}-workspace-pane-tab-empty` : undefined}
            action={createAction}
          />
        ) : null}
      </ToolbarTabStripBody>
    </DndContext>
  )
}

function isSortableWorkspacePaneTabItem(
  item: WorkspacePaneTabItem,
): item is WorkspacePaneStaticTabItem | WorkspacePaneRuntimeTabItem {
  return item.kind === 'static' || item.kind === 'runtime'
}

function arrayMove<T>(array: T[], from: number, to: number): T[] {
  const result = array.slice()
  const [removed] = result.splice(from, 1)
  if (removed === undefined) return result
  result.splice(to, 0, removed)
  return result
}
