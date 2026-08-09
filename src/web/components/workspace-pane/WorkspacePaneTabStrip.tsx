import { computed, defineComponent, ref } from 'vue'
import type { ComputedRef } from 'vue'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { ToolbarTabStrip } from '#/web/components/tab-strip/ToolbarTabStrip.tsx'
import { useFocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import type { FocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import {
  WorkspacePaneCompactTabsBody,
  WorkspacePaneScrollableTabsBody,
} from '#/web/components/workspace-pane/WorkspacePaneTabStripBodies.tsx'
import type { WorkspacePaneTabBodyContext } from '#/web/components/workspace-pane/WorkspacePaneTabStripBodies.tsx'
import { WorkspacePaneNewButton } from '#/web/components/workspace-pane/WorkspacePaneTabPresentation.tsx'
import type { WorkspacePaneTabCreateAction } from '#/web/components/workspace-pane/WorkspacePaneTabPresentation.tsx'
import {
  isSortableWorkspacePaneTabItem,
  useWorkspacePaneTabDnd,
} from '#/web/components/workspace-pane/workspace-pane-tab-dnd.ts'
import {
  scrollWorkspacePaneTabTargetIntoView,
  useDeferredActiveWorkspacePaneTabFocusAfterClose,
  usePrefersReducedMotion,
  useWorkspacePaneTabStripScroll,
} from '#/web/components/workspace-pane/workspace-pane-tab-strip-mechanics.ts'
import { useWorkspacePaneTabStripScrollMemoryController } from '#/web/components/workspace-pane/workspace-pane-tab-strip-scroll-memory.tsx'
import {
  isPendingWorkspacePaneTabItem,
  isStaticWorkspacePaneTabItem,
} from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import type { WorkspacePaneTabItem } from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import { useT } from '#/web/stores/i18n-vue.ts'
import { workspacePaneRuntimeTabProvider, workspacePaneStaticTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import type { WorkspacePaneTabClosePresentationEffects } from '#/web/workspace-pane/workspace-pane-tab-close-presentation.ts'

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
  onClose: (item: WorkspacePaneTabItem, presentationEffects: WorkspacePaneTabClosePresentationEffects | null) => void
  onReorder: (tabs: WorkspacePaneTabEntry[]) => void
  onNavigateOut?: (direction: 'prev' | 'next' | 'first' | 'last') => void
  activateKeyboardNavigationSelection?: boolean
}

export const EMPTY_WORKSPACE_PANE_TAB_FOCUS_KEY = '__workspace-pane-empty__'

export const WorkspacePaneTabStrip = defineComponent<WorkspacePaneTabStripProps>({
  name: 'WorkspacePaneTabStrip',
  props: [
    'workspacePaneTabTargetKey',
    'items',
    'workspacePaneId',
    'responsiveCompact',
    'activeTabIdentity',
    'panelActive',
    'focusRegistry',
    'emptyFocusKey',
    'createAction',
    'onSelect',
    'onReselect',
    'onClose',
    'onReorder',
    'onNavigateOut',
    'activateKeyboardNavigationSelection',
  ],

  setup(props) {
    const t = useT()
    const sortableItems = computed(() => props.items.filter(isSortableWorkspacePaneTabItem))
    const activeItem = computed(() =>
      props.activeTabIdentity ? (props.items.find((item) => item.identity === props.activeTabIdentity) ?? null) : null,
    )
    const compactPendingItem = computed(() =>
      props.responsiveCompact ? (props.items.find(isPendingWorkspacePaneTabItem) ?? null) : null,
    )
    const selectedItem = computed(() => activeItem.value ?? compactPendingItem.value)
    const collapseToSelectedTab = computed(() => !!props.responsiveCompact)
    const focusableTabIdentity = computed(() => selectedItem.value?.identity ?? props.items[0]?.identity ?? null)
    const internalFocusRegistry = useFocusRegistry<string, HTMLButtonElement>()
    const focusRegistry = props.focusRegistry ?? internalFocusRegistry
    const viewportRef = ref<HTMLDivElement | null>(null)
    const newButtonRef = ref<HTMLButtonElement | null>(null)
    const scrollMemory = useWorkspacePaneTabStripScrollMemoryController()
    const prefersReducedMotion = usePrefersReducedMotion()
    const scrollBehavior: ComputedRef<ScrollBehavior> = computed(() => (prefersReducedMotion.value ? 'auto' : 'smooth'))
    const hoveredTabIdentity = ref<string | null>(null)
    const focusActiveTabAfterClose = useDeferredActiveWorkspacePaneTabFocusAfterClose({
      workspacePaneTabTargetKey: () => props.workspacePaneTabTargetKey,
      activeTabIdentity: () => props.activeTabIdentity,
      items: () => props.items,
      focusRegistry,
    })
    const tabDnd = useWorkspacePaneTabDnd({
      sortableItems: () => sortableItems.value,
      disabled: () => !!props.createAction?.blocksTabInteraction,
      viewport: () => viewportRef.value,
      rightBoundary: () => newButtonRef.value,
      onReorder: (tabs) => props.onReorder(tabs),
    })

    const scrollNewButtonIntoView = () => {
      const viewport = viewportRef.value
      const target = newButtonRef.value
      if (!viewport || !target) return
      scrollWorkspacePaneTabTargetIntoView({ viewport, target, behavior: scrollBehavior.value })
    }

    const handleNew = () => {
      const createAction = props.createAction
      if (!createAction || createAction.busy) return
      scrollNewButtonIntoView()
      createAction.onCreate()
    }

    const renderCreateAction = computed<WorkspacePaneTabCreateAction | null>(() =>
      props.createAction
        ? {
            label: props.createAction.label,
            busy: props.createAction.busy ?? false,
            blocksTabInteraction: props.createAction.blocksTabInteraction ?? false,
            onCreate: handleNew,
          }
        : null,
    )
    const tabInteractionBlocked = computed(() => renderCreateAction.value?.blocksTabInteraction ?? false)

    const handleViewportScroll = useWorkspacePaneTabStripScroll({
      workspacePaneTabTargetKey: () => props.workspacePaneTabTargetKey,
      activeTabIdentity: () => props.activeTabIdentity,
      items: () => props.items,
      enabled: () => !collapseToSelectedTab.value,
      viewportRef,
      newButtonRef,
      scrollBehavior: () => scrollBehavior.value,
      getTabElement: focusRegistry.getRef,
      memory: scrollMemory,
    })

    const handleSelect = (identity: string) => {
      const item = props.items.find((candidate) => candidate.identity === identity)
      if (tabInteractionBlocked.value || !item || isPendingWorkspacePaneTabItem(item)) return
      if (item.identity === props.activeTabIdentity && props.panelActive) props.onReselect(item)
      else props.onSelect(item)
    }

    const handleClose = (identity: string) => {
      if (tabInteractionBlocked.value) return

      const item = props.items.find((candidate) => candidate.identity === identity)
      if (!item || isPendingWorkspacePaneTabItem(item)) return
      const isActive = item.identity === props.activeTabIdentity
      const tab = focusRegistry.getRef(identity)
      const focusedElement = document.activeElement
      const closingTabOwnsFocus = !!tab && !!focusedElement && (tab === focusedElement || tab.contains(focusedElement))

      hoveredTabIdentity.value = null
      const presentationEffects = isActive || closingTabOwnsFocus ? focusActiveTabAfterClose(identity) : null
      try {
        props.onClose(item, presentationEffects)
      } catch (error) {
        presentationEffects?.onAbandon()
        throw error
      }
    }

    const tabIdForItem = (item: WorkspacePaneTabItem): string => {
      if (isStaticWorkspacePaneTabItem(item)) {
        return workspacePaneStaticTabProvider(item.staticTabType).buttonId(props.workspacePaneId)
      }
      if (isPendingWorkspacePaneTabItem(item)) return `${props.workspacePaneId}-${item.type}-pending-tab`
      const runtimeItems = props.items.filter(
        (candidate) => candidate.kind === 'runtime' && candidate.runtimeType === item.runtimeType,
      )
      const index = runtimeItems.findIndex((candidate) => candidate.identity === item.identity)
      return workspacePaneRuntimeTabProvider(item.runtimeType).buttonId(props.workspacePaneId, Math.max(0, index))
    }

    const activateKeyboardNavigationTarget = (fromIdentity: string, toIdentity: string) => {
      const to = props.items.find((item) => item.identity === toIdentity)
      if (tabInteractionBlocked.value) return
      if (!props.activateKeyboardNavigationSelection || fromIdentity === toIdentity || !to) return
      if (isPendingWorkspacePaneTabItem(to)) return
      props.onSelect(to)
    }

    const handleTabKeyDown = (event: KeyboardEvent, tabIdentity: string) => {
      if (event.key === 'Delete') {
        const item = props.items.find((candidate) => candidate.identity === tabIdentity)
        if (!item || isPendingWorkspacePaneTabItem(item) || item.closable === false) return
        event.preventDefault()
        handleClose(tabIdentity)
        return
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') {
        return
      }
      event.preventDefault()
      if (tabInteractionBlocked.value) return
      const keys = props.items.filter((item) => !isPendingWorkspacePaneTabItem(item)).map((item) => item.identity)
      const index = keys.indexOf(tabIdentity)
      if (index === -1) return
      if (collapseToSelectedTab.value) {
        if (event.key === 'ArrowLeft') props.onNavigateOut?.('prev')
        else if (event.key === 'ArrowRight') props.onNavigateOut?.('next')
        else focusRegistry.focus(tabIdentity)
        return
      }
      if (event.key === 'Home') {
        const firstKey = keys[0]
        if (firstKey) {
          focusRegistry.focus(firstKey)
          activateKeyboardNavigationTarget(tabIdentity, firstKey)
        }
        return
      }
      if (event.key === 'End') {
        const lastKey = keys[keys.length - 1]
        if (lastKey) {
          focusRegistry.focus(lastKey)
          activateKeyboardNavigationTarget(tabIdentity, lastKey)
        }
        return
      }
      if (event.key === 'ArrowLeft' && index === 0) {
        props.onNavigateOut?.('prev')
        if (props.onNavigateOut) return
      }
      if (event.key === 'ArrowRight' && index === keys.length - 1) {
        props.onNavigateOut?.('next')
        if (props.onNavigateOut) return
      }
      const nextIndex = event.key === 'ArrowLeft' ? (index - 1 + keys.length) % keys.length : (index + 1) % keys.length
      const nextKey = keys[nextIndex]
      if (nextKey) {
        focusRegistry.focus(nextKey)
        activateKeyboardNavigationTarget(tabIdentity, nextKey)
      }
    }

    return () => {
      const createAction = renderCreateAction.value
      if (props.items.length === 0) {
        if (!createAction) return null
        return (
          <WorkspacePaneNewButton
            buttonRef={focusRegistry.setRef(props.emptyFocusKey ?? EMPTY_WORKSPACE_PANE_TAB_FOCUS_KEY)}
            id={`${props.workspacePaneId}-workspace-pane-tab-empty`}
            action={createAction}
          />
        )
      }

      const tabBodyContext: WorkspacePaneTabBodyContext = {
        activeTabIdentity: props.activeTabIdentity,
        panelActive: props.panelActive,
        focusableTabIdentity: focusableTabIdentity.value,
        focusRegistry,
        hoveredTabIdentity: hoveredTabIdentity.value,
        tabIdForItem,
        onHoverChange: (identity) => (hoveredTabIdentity.value = identity),
        onSelect: handleSelect,
        onClose: handleClose,
        onKeyDown: handleTabKeyDown,
        t,
        tabInteractionBlocked: tabInteractionBlocked.value,
      }

      return (
        <ToolbarTabStrip
          compact={collapseToSelectedTab.value}
          compactContent={
            <WorkspacePaneCompactTabsBody
              items={props.items}
              compactItem={selectedItem.value}
              workspacePaneId={props.workspacePaneId}
              context={tabBodyContext}
              createAction={createAction}
            />
          }
          scrollContent={
            <WorkspacePaneScrollableTabsBody
              items={props.items}
              context={tabBodyContext}
              createAction={createAction}
              newButtonRef={newButtonRef}
              workspacePaneId={props.workspacePaneId}
              dnd={tabDnd}
            />
          }
          viewportRef={viewportRef}
          viewportOnScroll={handleViewportScroll}
        />
      )
    }
  },
})
