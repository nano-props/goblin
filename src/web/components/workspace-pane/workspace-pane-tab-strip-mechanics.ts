import { useCallback, useLayoutEffect, useRef, useState, type RefObject, type UIEventHandler } from 'react'
import {
  isPendingWorkspacePaneTabItem,
  type WorkspacePaneTabItem,
} from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import type { FocusRegistry } from '#/web/components/tab-strip/useFocusRegistry.ts'
import type { WorkspacePaneTabStripScrollMemory } from '#/web/components/workspace-pane/workspace-pane-tab-strip-scroll-memory.tsx'

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

export function usePrefersReducedMotion(): boolean {
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

export function useWorkspacePaneTabStripAutoScroll({
  workspacePaneTabTargetKey,
  activeTabIdentity,
  items,
  enabled,
  viewportRef,
  newButtonRef,
  scrollBehavior,
  getTabElement,
  hasRememberedScrollPosition,
}: {
  workspacePaneTabTargetKey: string
  activeTabIdentity: string | null
  items: readonly WorkspacePaneTabItem[]
  enabled: boolean
  viewportRef: RefObject<HTMLDivElement | null>
  newButtonRef: RefObject<HTMLButtonElement | null>
  scrollBehavior: ScrollBehavior
  getTabElement: (identity: string) => HTMLButtonElement | null
  hasRememberedScrollPosition: boolean
}): void {
  const activeRenderableTabIdentity = activeTabIdentity
    ? (items.find((item) => item.identity === activeTabIdentity && !isPendingWorkspacePaneTabItem(item))?.identity ??
      null)
    : null
  const lastRenderableTabIdentity =
    items.filter((item) => !isPendingWorkspacePaneTabItem(item)).at(-1)?.identity ?? null
  const lastScrolledActiveIdentityRef = useRef<string | null>(null)
  const lastWorkspacePaneTabTargetKeyRef = useRef<string | null>(null)
  const awaitingTargetBaselineRef = useRef(false)
  const targetHadRememberedScrollPositionRef = useRef(false)

  useLayoutEffect(() => {
    const previousWorkspacePaneTabTargetKey = lastWorkspacePaneTabTargetKeyRef.current
    if (previousWorkspacePaneTabTargetKey !== workspacePaneTabTargetKey) {
      // Latch what existed before entering this target. Strict Mode replays
      // cleanup and can write the viewport's default zero into memory; that
      // synthetic write must not turn an unseen target into a restored one.
      targetHadRememberedScrollPositionRef.current = hasRememberedScrollPosition
    }
    lastWorkspacePaneTabTargetKeyRef.current = workspacePaneTabTargetKey
    const autoScroll = resolveWorkspacePaneTabAutoScroll({
      activeTabIdentity: enabled ? activeRenderableTabIdentity : null,
      previousTargetKey: previousWorkspacePaneTabTargetKey,
      currentTargetKey: workspacePaneTabTargetKey,
      awaitingTargetBaseline: awaitingTargetBaselineRef.current,
      lastScrolledActiveIdentity: lastScrolledActiveIdentityRef.current,
      hasRememberedScrollPosition: targetHadRememberedScrollPositionRef.current,
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
      behavior: autoScroll.baseline ? 'auto' : scrollBehavior,
    })
  }, [
    activeRenderableTabIdentity,
    enabled,
    getTabElement,
    hasRememberedScrollPosition,
    lastRenderableTabIdentity,
    newButtonRef,
    scrollBehavior,
    workspacePaneTabTargetKey,
    viewportRef,
  ])
}

export function useWorkspacePaneTabStripScrollMemory({
  workspacePaneTabTargetKey,
  enabled,
  viewportRef,
  memory,
}: {
  workspacePaneTabTargetKey: string
  enabled: boolean
  viewportRef: RefObject<HTMLDivElement | null>
  memory: WorkspacePaneTabStripScrollMemory
}): UIEventHandler<HTMLDivElement> {
  // This is ephemeral UI memory, not persisted workspace state. A single
  // viewport is reused across branch/worktree tab targets, and browsers can
  // clamp that viewport's scrollLeft when the rendered tab content changes.
  const handleScroll = useCallback<UIEventHandler<HTMLDivElement>>(
    (event) => {
      memory.write(workspacePaneTabTargetKey, event.currentTarget.scrollLeft)
    },
    [memory, workspacePaneTabTargetKey],
  )

  useLayoutEffect(() => {
    if (!enabled) return
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.scrollLeft = memory.read(workspacePaneTabTargetKey) ?? 0
    return () => memory.write(workspacePaneTabTargetKey, viewport.scrollLeft)
  }, [enabled, memory, workspacePaneTabTargetKey, viewportRef])

  return handleScroll
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

export function useDeferredActiveWorkspacePaneTabFocusAfterClose({
  activeTabIdentity,
  items,
  focusRegistry,
}: {
  activeTabIdentity: string | null
  items: readonly WorkspacePaneTabItem[]
  focusRegistry: FocusRegistry<string, HTMLButtonElement>
}): (closingIdentity: string) => void {
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
