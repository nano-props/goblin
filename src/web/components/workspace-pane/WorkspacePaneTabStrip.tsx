import { useCallback, useMemo, useRef, useState } from 'react'
import { useT } from '#/web/stores/i18n.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { ToolbarTabStrip } from '#/web/components/tab-strip/ToolbarTabStrip.tsx'
import { useFocusRegistry, type FocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { workspacePaneRuntimeTabProvider, workspacePaneStaticTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import {
  type WorkspacePaneTabItem,
  isPendingWorkspacePaneTabItem,
  isStaticWorkspacePaneTabItem,
} from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import {
  scrollWorkspacePaneTabTargetIntoView,
  useDeferredActiveWorkspacePaneTabFocusAfterClose,
  usePrefersReducedMotion,
  useWorkspacePaneTabStripAutoScroll,
  useWorkspacePaneTabStripScrollMemory,
} from '#/web/components/workspace-pane/workspace-pane-tab-strip-mechanics.ts'
import { useWorkspacePaneTabStripScrollMemoryController } from '#/web/components/workspace-pane/workspace-pane-tab-strip-scroll-memory.tsx'
import {
  WorkspacePaneNewButton,
  type WorkspacePaneTabCreateAction,
} from '#/web/components/workspace-pane/WorkspacePaneTabPresentation.tsx'
import {
  WorkspacePaneCompactTabsBody,
  WorkspacePaneScrollableTabsBody,
  type WorkspacePaneTabBodyContext,
} from '#/web/components/workspace-pane/WorkspacePaneTabStripBodies.tsx'
import {
  isSortableWorkspacePaneTabItem,
  useWorkspacePaneTabDnd,
} from '#/web/components/workspace-pane/workspace-pane-tab-dnd.ts'

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
  const scrollMemory = useWorkspacePaneTabStripScrollMemoryController()
  const hasRememberedScrollPosition = scrollMemory.read(workspacePaneTabTargetKey) !== undefined
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
    memory: scrollMemory,
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
    hasRememberedScrollPosition,
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
