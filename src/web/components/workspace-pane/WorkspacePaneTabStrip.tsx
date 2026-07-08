import { Check, ChevronDown, Plus, X } from 'lucide-react'
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type Ref,
  type RefObject,
  type UIEventHandler,
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
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
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
  workspacePaneRuntimeTabProvider,
  workspacePaneStaticTabProvider,
} from '#/web/workspace-pane/tab-providers.ts'
import {
  type WorkspacePaneRuntimeTabItem,
  type WorkspacePaneStaticTabItem,
  type WorkspacePaneTabItem,
  isPendingWorkspacePaneTabItem,
  isRuntimeWorkspacePaneTabItem,
  isStaticWorkspacePaneTabItem,
} from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import { WorkspacePaneTabTitle } from '#/web/components/workspace-pane/WorkspacePaneTabTitle.tsx'

type WorkspacePaneT = (key: string, params?: Record<string, string | number>) => string

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

export interface WorkspacePaneTabCreateAction {
  label: string
  busy?: boolean
  onCreate: () => void
}

export const EMPTY_WORKSPACE_PANE_TAB_FOCUS_KEY = '__workspace-pane-empty__'

const WORKSPACE_PANE_TAB_TOOLTIP_SELECTOR = '[data-workspace-pane-tab-tooltip-id]'
const WORKSPACE_PANE_TAB_SCROLL_TARGET_SELECTOR = '[data-workspace-pane-tab-scroll-target]'
// Virtual right-edge for the compact tab's separator computation. The popover
// trigger that follows the tab is the only real DOM node on that side, but it
// doesn't report hover state, so we use this sentinel identity instead.
const WORKSPACE_PANE_COMPACT_TRAILING_ACTION_ID = '__workspace-pane-compact-trailing-action__'
const WORKSPACE_PANE_NEW_ACTION_ID = '__workspace-pane-new-action__'

function resolveWorkspacePaneTabAutoScroll({
  activeTabIdentity,
  previousTargetKey,
  currentTargetKey,
  awaitingTargetBaseline,
  lastScrolledActiveIdentity,
}: {
  activeTabIdentity: string | null
  previousTargetKey: string | null
  currentTargetKey: string
  awaitingTargetBaseline: boolean
  lastScrolledActiveIdentity: string | null
}): { shouldScroll: boolean; nextScrolledActiveIdentity: string | null; nextAwaitingTargetBaseline: boolean } {
  const targetChanged = previousTargetKey !== null && previousTargetKey !== currentTargetKey
  if (!activeTabIdentity) {
    return {
      shouldScroll: false,
      nextScrolledActiveIdentity: null,
      nextAwaitingTargetBaseline: awaitingTargetBaseline || targetChanged,
    }
  }
  if (targetChanged || awaitingTargetBaseline) {
    return {
      shouldScroll: false,
      nextScrolledActiveIdentity: activeTabIdentity,
      nextAwaitingTargetBaseline: false,
    }
  }
  if (lastScrolledActiveIdentity === activeTabIdentity) {
    return {
      shouldScroll: false,
      nextScrolledActiveIdentity: lastScrolledActiveIdentity,
      nextAwaitingTargetBaseline: false,
    }
  }
  return { shouldScroll: true, nextScrolledActiveIdentity: activeTabIdentity, nextAwaitingTargetBaseline: false }
}

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

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
  )

  useLayoutEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setPrefersReducedMotion(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return prefersReducedMotion
}

function useWorkspacePaneTabStripAutoScroll({
  workspacePaneTabTargetKey,
  activeTabIdentity,
  items,
  enabled,
  viewportRef,
  newButtonRef,
  scrollBehavior,
  getTabElement,
}: {
  workspacePaneTabTargetKey: string
  activeTabIdentity: string | null
  items: readonly WorkspacePaneTabItem[]
  enabled: boolean
  viewportRef: RefObject<HTMLDivElement | null>
  newButtonRef: RefObject<HTMLButtonElement | null>
  scrollBehavior: ScrollBehavior
  getTabElement: (identity: string) => HTMLButtonElement | null
}) {
  const activeRenderableTabIdentity = activeTabIdentity
    ? (items.find((item) => item.identity === activeTabIdentity && !isPendingWorkspacePaneTabItem(item))?.identity ??
      null)
    : null
  const lastRenderableTabIdentity =
    items.filter((item) => !isPendingWorkspacePaneTabItem(item)).at(-1)?.identity ?? null
  const lastScrolledActiveIdentityRef = useRef<string | null>(null)
  const lastWorkspacePaneTabTargetKeyRef = useRef<string | null>(null)
  const awaitingTargetBaselineRef = useRef(false)

  useLayoutEffect(() => {
    const previousWorkspacePaneTabTargetKey = lastWorkspacePaneTabTargetKeyRef.current
    lastWorkspacePaneTabTargetKeyRef.current = workspacePaneTabTargetKey
    const autoScroll = resolveWorkspacePaneTabAutoScroll({
      activeTabIdentity: enabled ? activeRenderableTabIdentity : null,
      previousTargetKey: previousWorkspacePaneTabTargetKey,
      currentTargetKey: workspacePaneTabTargetKey,
      awaitingTargetBaseline: awaitingTargetBaselineRef.current,
      lastScrolledActiveIdentity: lastScrolledActiveIdentityRef.current,
    })
    awaitingTargetBaselineRef.current = autoScroll.nextAwaitingTargetBaseline

    if (!autoScroll.shouldScroll) {
      lastScrolledActiveIdentityRef.current = autoScroll.nextScrolledActiveIdentity
      return
    }
    const viewport = viewportRef.current
    const tab = activeRenderableTabIdentity ? getTabElement(activeRenderableTabIdentity) : null
    if (!viewport || !tab) return
    lastScrolledActiveIdentityRef.current = autoScroll.nextScrolledActiveIdentity
    const tabScrollTarget = workspacePaneTabScrollTarget(tab)
    const target =
      activeRenderableTabIdentity === lastRenderableTabIdentity && newButtonRef.current
        ? newButtonRef.current
        : tabScrollTarget
    scrollWorkspacePaneTabTargetIntoView({
      viewport,
      target,
      behavior: scrollBehavior,
    })
  }, [
    activeRenderableTabIdentity,
    enabled,
    getTabElement,
    lastRenderableTabIdentity,
    newButtonRef,
    scrollBehavior,
    workspacePaneTabTargetKey,
    viewportRef,
  ])
}

function useWorkspacePaneTabStripScrollMemory({
  workspacePaneTabTargetKey,
  enabled,
  viewportRef,
}: {
  workspacePaneTabTargetKey: string
  enabled: boolean
  viewportRef: RefObject<HTMLDivElement | null>
}): UIEventHandler<HTMLDivElement> {
  // This is ephemeral UI memory, not persisted workspace state. A single
  // viewport is reused across branch/worktree tab targets, and browsers can
  // clamp that viewport's scrollLeft when the rendered tab content changes.
  // Remembering scrollLeft per tab target lets each target restore its last
  // horizontal position without making the strip a controlled scroll component.
  const scrollPositionsRef = useRef(new Map<string, number>())
  const activeWorkspacePaneTabTargetKeyRef = useRef(workspacePaneTabTargetKey)

  const handleScroll = useCallback<UIEventHandler<HTMLDivElement>>(
    (event) => {
      scrollPositionsRef.current.set(workspacePaneTabTargetKey, event.currentTarget.scrollLeft)
    },
    [workspacePaneTabTargetKey],
  )

  useLayoutEffect(() => {
    if (!enabled) return
    const viewport = viewportRef.current
    if (!viewport) return
    const previousWorkspacePaneTabTargetKey = activeWorkspacePaneTabTargetKeyRef.current
    if (previousWorkspacePaneTabTargetKey === workspacePaneTabTargetKey) return

    if (!scrollPositionsRef.current.has(previousWorkspacePaneTabTargetKey)) {
      scrollPositionsRef.current.set(previousWorkspacePaneTabTargetKey, viewport.scrollLeft)
    }
    activeWorkspacePaneTabTargetKeyRef.current = workspacePaneTabTargetKey
    viewport.scrollLeft = scrollPositionsRef.current.get(workspacePaneTabTargetKey) ?? 0
  }, [enabled, workspacePaneTabTargetKey, viewportRef])

  return handleScroll
}

function scrollWorkspacePaneTabTargetIntoView({
  viewport,
  target,
  behavior,
}: {
  viewport: HTMLDivElement
  target: HTMLElement
  behavior: ScrollBehavior
}) {
  const viewportRect = viewport.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const inline = targetRect.left < viewportRect.left ? 'start' : targetRect.right > viewportRect.right ? 'end' : null

  if (!inline) return

  target.scrollIntoView({ inline, block: 'nearest', behavior })
}

function workspacePaneTabScrollTarget(tab: HTMLButtonElement): HTMLElement {
  return tab.closest<HTMLElement>(WORKSPACE_PANE_TAB_SCROLL_TARGET_SELECTOR) ?? tab
}

function useDeferredActiveWorkspacePaneTabFocusAfterClose({
  activeTabIdentity,
  items,
  focusRegistry,
}: {
  activeTabIdentity: string | null
  items: readonly WorkspacePaneTabItem[]
  focusRegistry: FocusRegistry<string, HTMLButtonElement>
}) {
  const closingActiveIdentityRef = useRef<string | null>(null)
  const [focusRequestVersion, setFocusRequestVersion] = useState(0)

  useLayoutEffect(() => {
    const closingIdentity = closingActiveIdentityRef.current
    if (!closingIdentity) return
    if (activeTabIdentity === closingIdentity) return
    if (!activeTabIdentity) {
      if (!items.some((item) => item.identity === closingIdentity)) closingActiveIdentityRef.current = null
      return
    }
    const activeItem = items.find((item) => item.identity === activeTabIdentity)
    if (!activeItem || isPendingWorkspacePaneTabItem(activeItem)) {
      if (!items.some((item) => item.identity === closingIdentity)) closingActiveIdentityRef.current = null
      return
    }
    focusRegistry.focus(activeTabIdentity, { preventScroll: true })
    closingActiveIdentityRef.current = null
  }, [activeTabIdentity, focusRegistry, focusRequestVersion, items])

  return useCallback((closingIdentity: string) => {
    closingActiveIdentityRef.current = closingIdentity
    setFocusRequestVersion((version) => version + 1)
  }, [])
}

function useWorkspacePaneTabDnd({
  sortableItems,
  newButtonRef,
  onReorder,
}: {
  sortableItems: readonly (WorkspacePaneStaticTabItem | WorkspacePaneRuntimeTabItem)[]
  newButtonRef: RefObject<HTMLButtonElement | null>
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
    [onReorder, sortableItems],
  )

  return {
    sensors,
    restrictToVisibleTabStrip,
    sortableIds,
    handleDragEnd,
  }
}

interface WorkspacePaneTabSwitcherPopoverProps {
  items: WorkspacePaneTabItem[]
  activeTabIdentity: string | null
  label: string
  createAction: WorkspacePaneTabCreateAction | null
  onSelect: (identity: string) => void
  onClose: (event: React.MouseEvent, identity: string) => void
  t: WorkspacePaneT
}

function WorkspacePaneTabSwitcherPopover({
  items,
  activeTabIdentity,
  label,
  createAction,
  onSelect,
  onClose,
  t,
}: WorkspacePaneTabSwitcherPopoverProps) {
  const [open, setOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  const selectView = (identity: string) => {
    setOpen(false)
    onSelect(identity)
  }

  const selectNew = () => {
    if (!createAction || createAction.busy) return
    setOpen(false)
    createAction.onCreate()
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
                      {selected ? <Check size={13} aria-hidden /> : <WorkspacePaneTabIcon item={item} active={false} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.label || item.tooltip}</span>
                    {isRuntimeWorkspacePaneTabItem(item) && item.attention && (
                      <>
                        <span className="h-2 w-2 shrink-0 rounded-full bg-notification" aria-hidden="true" />
                        <span className="sr-only">{runtimeAttentionLabel(item, t)}</span>
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
        {createAction && (
          <div className="border-t border-separator p-1">
            <button
              type="button"
              className={cn(
                'flex h-7 w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-popover-foreground outline-none transition-colors duration-100',
                createAction.busy
                  ? 'cursor-not-allowed opacity-70'
                  : 'cursor-pointer hover:bg-accent hover:text-accent-foreground',
              )}
              onClick={selectNew}
              disabled={createAction.busy}
              aria-busy={createAction.busy ? 'true' : undefined}
            >
              <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
                <Plus size={14} />
              </span>
              <span className="min-w-0 flex-1 truncate">{createAction.label}</span>
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
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
        onCreate: handleNew,
      }
    : null
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
      if (!item) return
      if (isPendingWorkspacePaneTabItem(item)) return
      if (item.identity === activeTabIdentity && panelActive) onReselect(item)
      else onSelect(item)
    },
    [activeTabIdentity, items, onReselect, onSelect, panelActive],
  )

  const handleClose = useCallback(
    (event: React.MouseEvent, identity: string) => {
      event.preventDefault()
      event.stopPropagation()

      const item = items.find((candidate) => candidate.identity === identity)
      if (!item) return
      if (isPendingWorkspacePaneTabItem(item)) return
      const isActive = item.identity === activeTabIdentity

      setHoveredTabIdentity(null)
      if (isActive) focusActiveTabAfterClose(identity)
      onClose(item)
    },
    [activeTabIdentity, focusActiveTabAfterClose, items, onClose],
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

interface WorkspacePaneTabProps {
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
  t: WorkspacePaneT
  compact?: boolean
  showSeparator?: boolean
  onHoverChange?: (identity: string | null) => void
}

function WorkspacePaneNewButton({
  id,
  action,
  compact = false,
  ref,
}: {
  id?: string
  action: WorkspacePaneTabCreateAction
  compact?: boolean
  ref?: Ref<HTMLButtonElement>
}) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="icon"
      className={cn('h-7 w-7 shrink-0', compact && 'w-7')}
      id={id}
      onClick={action.onCreate}
      disabled={action.busy}
      aria-busy={action.busy ? 'true' : undefined}
      aria-label={action.label}
      title={action.label}
      data-workspace-pane-new-button=""
    >
      <Plus size={14} />
    </Button>
  )
}

interface WorkspacePaneTabChromeProps {
  item: WorkspacePaneTabItem
  isActive: boolean
  isSelected: boolean
  isFocusable: boolean
  index?: number
  total?: number
  isDragging?: boolean
  tabId: string
  buttonRef: ((node: HTMLButtonElement | null) => void) | undefined
  containerProps?: ComponentPropsWithoutRef<'div'>
  buttonProps?: ComponentPropsWithoutRef<'button'>
  onSelect: (identity: string) => void
  onClose: (event: React.MouseEvent, identity: string) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>, identity: string) => void
  t: WorkspacePaneT
  compact?: boolean
  showSeparator?: boolean
  onHoverChange?: (identity: string | null) => void
}

function WorkspacePaneTabChrome({
  item,
  isActive,
  isSelected,
  isFocusable,
  index,
  total,
  isDragging = false,
  tabId,
  buttonRef,
  containerProps,
  buttonProps,
  onSelect,
  onClose,
  onKeyDown,
  t,
  compact = false,
  showSeparator = false,
  onHoverChange,
}: WorkspacePaneTabChromeProps) {
  const attentionLabel = isRuntimeWorkspacePaneTabItem(item) && item.attention ? runtimeAttentionLabel(item, t) : null
  const accessibleLabel = item.label || item.tooltip
  const ariaLabel = attentionLabel ? `${accessibleLabel} — ${attentionLabel}` : accessibleLabel
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
        ...containerProps,
        'data-workspace-pane-tab-tooltip-id': item.identity,
        'data-workspace-pane-tab-scroll-target': '',
        'data-workspace-pane-pending-tab': isPendingWorkspacePaneTabItem(item) ? item.type : undefined,
        onPointerEnter: (event) => {
          containerProps?.onPointerEnter?.(event)
          onHoverChange?.(item.identity)
        },
        onPointerLeave: (event) => {
          containerProps?.onPointerLeave?.(event)
          onHoverChange?.(null)
        },
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
        ...collectionAria,
        tabIndex: isFocusable ? 0 : -1,
        onClick: () => onSelect(item.identity),
        onKeyDown: (e) => onKeyDown(e, item.identity),
      }}
      buttonClassName={toolbarTabButtonClassName('workspace')}
      {...closeProps}
    >
      <WorkspacePaneTabIcon item={item} active={isActive} compact={compact} />
      <WorkspacePaneTabTitle item={item} />
      {isRuntimeWorkspacePaneTabItem(item) && item.attention && (
        <>
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-notification opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-notification" />
          </span>
          <span className="sr-only">{attentionLabel}</span>
        </>
      )}
    </ToolbarClosableTab>
  )
}

function runtimeAttentionLabel(item: WorkspacePaneRuntimeTabItem, t: WorkspacePaneT): string {
  const attentionLabelKey = item.attentionLabelKey
  return attentionLabelKey ? t(attentionLabelKey) : item.tooltip
}

function WorkspacePaneTab({
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
}: WorkspacePaneTabProps) {
  return (
    <WorkspacePaneTabChrome
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

function SortableWorkspacePaneTab({
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
}: WorkspacePaneTabProps & { sortableIdentity: string }) {
  const sortable = useSortableTab(sortableIdentity, { onButtonRef: focusRegistry.setRef(item.identity) })

  return (
    <div ref={sortable.setContainerRef} style={sortable.style} className="touch-none select-none">
      <WorkspacePaneTabChrome
        item={item}
        isActive={isActive}
        isSelected={isSelected}
        isFocusable={isFocusable}
        index={index}
        total={total}
        isDragging={sortable.isDragging}
        tabId={tabId}
        buttonRef={sortable.setButtonRef}
        containerProps={sortable.sortableListeners}
        buttonProps={sortable.attributes}
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

interface WorkspacePaneTabTooltipLayerProps extends ComponentPropsWithoutRef<'div'> {
  items: WorkspacePaneTabItem[]
}

function WorkspacePaneTabTooltipLayer({ items, children, ...props }: WorkspacePaneTabTooltipLayerProps) {
  return (
    <DelegatedTooltipLayer
      items={items}
      selector={WORKSPACE_PANE_TAB_TOOLTIP_SELECTOR}
      attributeName="data-workspace-pane-tab-tooltip-id"
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

function WorkspacePaneTabIcon({
  item,
  active,
  compact = false,
}: {
  item: WorkspacePaneTabItem
  active: boolean
  compact?: boolean
}) {
  const className = toolbarTabIconClassName(active, compact)
  const Icon = item.icon
  return <Icon size={13} className={className} />
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
