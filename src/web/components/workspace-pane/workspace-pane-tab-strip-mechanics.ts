import { nextTick, onBeforeUpdate, onMounted, onScopeDispose, onUpdated, ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { FocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import { isPendingWorkspacePaneTabItem } from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import type { WorkspacePaneTabItem } from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import type { WorkspacePaneTabStripScrollMemory } from '#/web/components/workspace-pane/workspace-pane-tab-strip-scroll-memory.tsx'
import type { WorkspacePaneTabClosePresentationEffects } from '#/web/workspace-pane/workspace-pane-tab-close-presentation.ts'

const WORKSPACE_PANE_TAB_SCROLL_TARGET_SELECTOR = '[data-workspace-pane-tab-scroll-target]'

function resolveWorkspacePaneTabAutoScroll({
  activeTabIdentity,
  previousTargetKey,
  currentTargetKey,
  awaitingTargetBaseline,
  lastScrolledActiveIdentity,
  hasRememberedScrollPosition,
}: {
  activeTabIdentity: string | null
  previousTargetKey: string | null
  currentTargetKey: string
  awaitingTargetBaseline: boolean
  lastScrolledActiveIdentity: string | null
  hasRememberedScrollPosition: boolean
}): {
  shouldScroll: boolean
  baseline: boolean
  nextScrolledActiveIdentity: string | null
  nextAwaitingTargetBaseline: boolean
} {
  const targetChanged = previousTargetKey !== currentTargetKey
  if (!activeTabIdentity) {
    return {
      shouldScroll: false,
      baseline: false,
      nextScrolledActiveIdentity: null,
      nextAwaitingTargetBaseline: awaitingTargetBaseline || targetChanged,
    }
  }
  if (targetChanged || awaitingTargetBaseline) {
    return {
      shouldScroll: !hasRememberedScrollPosition,
      baseline: true,
      nextScrolledActiveIdentity: activeTabIdentity,
      nextAwaitingTargetBaseline: false,
    }
  }
  if (lastScrolledActiveIdentity === activeTabIdentity) {
    return {
      shouldScroll: false,
      baseline: false,
      nextScrolledActiveIdentity: lastScrolledActiveIdentity,
      nextAwaitingTargetBaseline: false,
    }
  }
  return {
    shouldScroll: true,
    baseline: false,
    nextScrolledActiveIdentity: activeTabIdentity,
    nextAwaitingTargetBaseline: false,
  }
}

export function usePrefersReducedMotion(): Readonly<Ref<boolean>> {
  const prefersReducedMotion = ref(false)
  let query: MediaQueryList | null = null

  const update = () => {
    prefersReducedMotion.value = query?.matches === true
  }

  onMounted(() => {
    if (typeof window.matchMedia !== 'function') return
    query = window.matchMedia('(prefers-reduced-motion: reduce)')
    update()
    query.addEventListener('change', update)
  })

  onScopeDispose(() => query?.removeEventListener('change', update))
  return prefersReducedMotion
}

export function useWorkspacePaneTabStripScroll(input: {
  workspacePaneTabTargetKey: () => string
  activeTabIdentity: () => string | null
  items: () => readonly WorkspacePaneTabItem[]
  enabled: () => boolean
  viewportRef: Ref<HTMLDivElement | null>
  newButtonRef: Ref<HTMLButtonElement | null>
  scrollBehavior: () => ScrollBehavior
  getTabElement: (identity: string) => HTMLButtonElement | null
  memory: WorkspacePaneTabStripScrollMemory
}): (event: Event) => void {
  let lastScrolledActiveIdentity: string | null = null
  let awaitingTargetBaseline = false
  let targetHadRememberedScrollPosition = false
  let committedTargetKey: string | null = null
  let committedEnabled = false
  let projectionVersion = 0

  // The viewport is reused across targets. Capture the old target's position
  // while its DOM is still mounted, before Vue patches in the next target.
  onBeforeUpdate(() => {
    const viewport = input.viewportRef.value
    const nextTargetKey = input.workspacePaneTabTargetKey()
    const nextEnabled = input.enabled()
    if (viewport && committedEnabled && committedTargetKey && (committedTargetKey !== nextTargetKey || !nextEnabled)) {
      input.memory.write(committedTargetKey, viewport.scrollLeft)
    }
  })

  // After the patch, apply the new target's baseline before revealing its
  // active tab. Keeping both projections in this layout lifecycle prevents
  // independent effects from reversing that order.
  const projectCommittedScrollState = () => {
    projectionVersion += 1
    const targetKey = input.workspacePaneTabTargetKey()
    const enabled = input.enabled()
    const previousTargetKey = committedTargetKey
    const targetChanged = previousTargetKey !== targetKey
    const enabledChanged = committedEnabled !== enabled

    if (!enabled) {
      awaitingTargetBaseline = true
      lastScrolledActiveIdentity = null
      committedTargetKey = targetKey
      committedEnabled = false
      return
    }

    const viewport = input.viewportRef.value
    if (!viewport) return
    if (targetChanged || (enabledChanged && enabled)) {
      const rememberedScrollPosition = input.memory.read(targetKey)
      targetHadRememberedScrollPosition = rememberedScrollPosition !== undefined
      viewport.scrollLeft = rememberedScrollPosition ?? 0
    }

    const items = input.items()
    const activeTabIdentity = input.activeTabIdentity()
    const activeRenderableTabIdentity = activeTabIdentity
      ? (items.find((item) => item.identity === activeTabIdentity && !isPendingWorkspacePaneTabItem(item))?.identity ??
        null)
      : null
    const lastRenderableTabIdentity =
      items.filter((item) => !isPendingWorkspacePaneTabItem(item)).at(-1)?.identity ?? null
    const autoScroll = resolveWorkspacePaneTabAutoScroll({
      activeTabIdentity: activeRenderableTabIdentity,
      previousTargetKey,
      currentTargetKey: targetKey,
      awaitingTargetBaseline,
      lastScrolledActiveIdentity,
      hasRememberedScrollPosition: targetHadRememberedScrollPosition,
    })
    committedTargetKey = targetKey
    committedEnabled = true

    if (!autoScroll.shouldScroll) {
      awaitingTargetBaseline = autoScroll.nextAwaitingTargetBaseline
      lastScrolledActiveIdentity = autoScroll.nextScrolledActiveIdentity
      return
    }
    const tab = activeRenderableTabIdentity ? input.getTabElement(activeRenderableTabIdentity) : null
    if (!tab) {
      if (autoScroll.baseline) awaitingTargetBaseline = true
      return
    }
    awaitingTargetBaseline = autoScroll.nextAwaitingTargetBaseline
    lastScrolledActiveIdentity = autoScroll.nextScrolledActiveIdentity
    const tabScrollTarget = workspacePaneTabScrollTarget(tab)
    const target =
      activeRenderableTabIdentity === lastRenderableTabIdentity && input.newButtonRef.value
        ? input.newButtonRef.value
        : tabScrollTarget
    scrollWorkspacePaneTabTargetIntoView({
      viewport,
      target,
      behavior: autoScroll.baseline ? 'auto' : input.scrollBehavior(),
    })
  }

  onMounted(() => {
    const viewportBeforeProjection = input.viewportRef.value
    const childMountScrollLeft = viewportBeforeProjection?.scrollLeft
    projectCommittedScrollState()
    const viewport = input.viewportRef.value
    if (
      !viewport ||
      !input.enabled() ||
      childMountScrollLeft === undefined ||
      viewport.scrollLeft === childMountScrollLeft
    ) {
      return
    }
    const mountedProjectionVersion = projectionVersion
    const mountedTargetKey = input.workspacePaneTabTargetKey()
    const mountedScrollLeft = viewport.scrollLeft

    // ScrollArea can normalize its viewport once more after the parent mount
    // hook. If it returns to the pre-projection position, reapply the decided
    // position after that child work. A newer projection or user scroll to a
    // different position wins instead.
    void nextTick(() => {
      if (
        projectionVersion !== mountedProjectionVersion ||
        !input.enabled() ||
        input.workspacePaneTabTargetKey() !== mountedTargetKey
      ) {
        return
      }
      const mountedViewport = input.viewportRef.value
      if (mountedViewport?.scrollLeft === childMountScrollLeft) {
        mountedViewport.scrollLeft = mountedScrollLeft
      }
    })
  })
  onUpdated(projectCommittedScrollState)

  onScopeDispose(() => {
    projectionVersion += 1
    const viewport = input.viewportRef.value
    if (viewport && input.enabled()) {
      input.memory.write(input.workspacePaneTabTargetKey(), viewport.scrollLeft)
    }
  })

  return (event) => {
    const viewport = event.currentTarget
    if (!(viewport instanceof HTMLDivElement)) return
    input.memory.write(input.workspacePaneTabTargetKey(), viewport.scrollLeft)
  }
}

export function scrollWorkspacePaneTabTargetIntoView({
  viewport,
  target,
  behavior,
}: {
  viewport: HTMLDivElement
  target: HTMLElement
  behavior: ScrollBehavior
}): void {
  const viewportRect = viewport.getBoundingClientRect()
  const targetRect = target.getBoundingClientRect()
  const inline = targetRect.left < viewportRect.left ? 'start' : targetRect.right > viewportRect.right ? 'end' : null
  if (!inline) return
  target.scrollIntoView({ inline, block: 'nearest', behavior })
}

function workspacePaneTabScrollTarget(tab: HTMLButtonElement): HTMLElement {
  return tab.closest<HTMLElement>(WORKSPACE_PANE_TAB_SCROLL_TARGET_SELECTOR) ?? tab
}

export function useDeferredActiveWorkspacePaneTabFocusAfterClose(input: {
  workspacePaneTabTargetKey: () => string
  activeTabIdentity: () => string | null
  items: () => readonly WorkspacePaneTabItem[]
  focusRegistry: FocusRegistry<string, HTMLButtonElement>
}): (closingIdentity: string) => WorkspacePaneTabClosePresentationEffects {
  let requestVersion = 0
  let pendingRequest: PendingWorkspacePaneTabCloseFocusRequest | null = null

  const clearRequest = (request: PendingWorkspacePaneTabCloseFocusRequest) => {
    if (pendingRequest?.version === request.version) pendingRequest = null
  }

  const reconcileRequest = () => {
    const request = pendingRequest
    if (!request) return
    const items = input.items()
    if (request.targetKey !== input.workspacePaneTabTargetKey() || items.length === 0) {
      clearRequest(request)
      return
    }
    if (!request.committed) return

    const activeTabIdentity = input.activeTabIdentity()
    // Runtime removal and close-back navigation are separate authoritative
    // commits. The first can temporarily leave a non-empty strip without an
    // active tab; that state does not complete the focus handoff.
    // The presentation effect admits the handoff, while the rendered items
    // remain its DOM authority. Do not focus until the closing tab has left.
    if (items.some((item) => item.identity === request.closingIdentity)) return
    if (!activeTabIdentity) return
    const activeItem = items.find((item) => item.identity === activeTabIdentity)
    if (!activeItem || isPendingWorkspacePaneTabItem(activeItem)) return
    const activeTab = input.focusRegistry.getRef(activeTabIdentity)
    if (!activeTab) return

    clearRequest(request)
    activeTab.focus({ preventScroll: true })
  }

  onUpdated(reconcileRequest)
  onScopeDispose(() => {
    pendingRequest = null
  })

  return (closingIdentity) => {
    const request: PendingWorkspacePaneTabCloseFocusRequest = {
      version: ++requestVersion,
      targetKey: input.workspacePaneTabTargetKey(),
      closingIdentity,
      committed: false,
    }
    // One tab strip owns one close-focus handoff. A newer accepted close
    // supersedes any older request whose completion may still be in flight.
    pendingRequest = request
    return {
      onCommit: () => {
        if (pendingRequest?.version !== request.version) return
        request.committed = true
        reconcileRequest()
      },
      onAbandon: () => clearRequest(request),
    }
  }
}

interface PendingWorkspacePaneTabCloseFocusRequest {
  version: number
  targetKey: string
  closingIdentity: string
  committed: boolean
}
