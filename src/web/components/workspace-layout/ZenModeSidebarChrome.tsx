import { computed, defineComponent, nextTick, onMounted, onScopeDispose, ref, watch } from 'vue'
import type { CSSProperties, ComputedRef, FunctionalComponent, Ref, VNodeChild } from 'vue'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { TITLE_BAR_HEIGHT_PX } from '#/shared/title-bar-chrome.ts'
import { NativeDragPlate } from '#/web/components/title-bar-chrome-region.tsx'
import { FloatingSurfaceBoundary } from '#/web/components/ui/floating-surface-boundary.tsx'
import { WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'
import { ZenModeSidebarResizeRail } from '#/web/components/workspace-layout/ZenModeSidebarResizeRail.tsx'
import type { ResizeRailState } from '#/web/components/workspace-layout/ZenModeSidebarResizeRail.tsx'
import { ZenModeSidebarRevealTriggerLayer } from '#/web/components/workspace-layout/ZenModeSidebarRevealTriggerLayer.tsx'
import {
  clampWorkspaceSidebarSizePercent,
  workspaceSidebarWidthExpression,
  workspaceSidebarWidthPx,
} from '#/web/components/workspace-layout/sidebar-sizing.ts'
import {
  isPointerInsideElement,
  isPointerInsideRevealBounds,
  isZenRevealSurfaceTarget,
  zenRevealHostRect,
} from '#/web/components/workspace-layout/zen-mode-sidebar-pointer.ts'
import { useElementInlineSize } from '#/web/hooks/useElementInlineSize.ts'
import { cn } from '#/web/lib/cn.ts'

const ZEN_REVEAL_CLOSE_MS = 260
type RevealPanelState = 'closed' | 'opening' | 'open' | 'closing'

interface ZenModeSidebarRevealState {
  open: Readonly<Ref<boolean>>
  rendered: ComputedRef<boolean>
  onTriggerEnter: () => void
  onSurfaceEnter: () => void
  onSurfaceLeave: () => void
}

interface ZenModeSidebarRevealProps {
  sidebarPane: VNodeChild
  open: boolean
  // The panel can stay visually mounted while zen mode exits; only an
  // interactive panel may own pointer handlers or native drag regions.
  interactive: boolean
  sidebarSize: number
  onSidebarSizeChange: (sidebarSize: number) => void
  onSurfaceEnter: () => void
  onSurfaceLeave: () => void
}

interface ZenModeSidebarChromeProps {
  workspaceId?: WorkspaceId
  sidebarPane: VNodeChild
  zenModeToggleEnabled: boolean
  revealEnabled: boolean
  sidebarSize: number
  onSidebarSizeChange: (sidebarSize: number) => void
}

function useZenModeSidebarReveal(enabled: () => boolean): ZenModeSidebarRevealState {
  const open = ref(false)
  const rendered = computed(() => enabled() || open.value)
  let exitRetainTimer: number | null = null
  let exitRetaining = false

  const clearExitRetain = () => {
    if (exitRetainTimer !== null) {
      window.clearTimeout(exitRetainTimer)
      exitRetainTimer = null
    }
    exitRetaining = false
  }

  const openSidebar = () => {
    if (!enabled()) return
    clearExitRetain()
    open.value = true
  }

  const closeSidebar = () => {
    if (!exitRetaining) open.value = false
  }

  // Retain the already-visible panel only while the zen-mode exit animation
  // owns it; this timer is the lifecycle boundary for that visual projection.
  watch(enabled, (nextEnabled, wasEnabled) => {
    if (wasEnabled === undefined || wasEnabled === nextEnabled) return
    clearExitRetain()
    if (nextEnabled || !open.value) {
      open.value = false
      return
    }
    exitRetaining = true
    exitRetainTimer = window.setTimeout(() => {
      exitRetainTimer = null
      exitRetaining = false
      open.value = false
    }, WORKSPACE_PANE_TRANSITION_MS)
  })

  onScopeDispose(clearExitRetain)
  return {
    open,
    rendered,
    onTriggerEnter: openSidebar,
    onSurfaceEnter: openSidebar,
    onSurfaceLeave: closeSidebar,
  }
}

function useZenModeSidebarPanelTransition(
  open: () => boolean,
  panel: Readonly<Ref<HTMLElement | null>>,
): Readonly<Ref<RevealPanelState>> {
  const panelState = ref<RevealPanelState>(open() ? 'open' : 'closed')

  // React commits the controlled `open` value before its effect creates the
  // CSS transition state. Preserve that boundary in Vue, then commit and
  // resolve the `opening` styles before advancing to `open` on the next frame.
  watch(
    open,
    (nextOpen, _previousOpen, onCleanup) => {
      let cancelled = false
      let animationFrame: number | null = null
      let closeTimer: number | null = null

      onCleanup(() => {
        cancelled = true
        if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
        if (closeTimer !== null) window.clearTimeout(closeTimer)
      })

      if (nextOpen) {
        if (panelState.value === 'open') return
        panelState.value = 'opening'
        void nextTick(() => {
          if (cancelled || !open() || panelState.value !== 'opening') return
          const panelElement = panel.value
          if (!panelElement) return

          panelElement.getBoundingClientRect()
          animationFrame = window.requestAnimationFrame(() => {
            animationFrame = null
            if (!cancelled && open() && panelState.value === 'opening') panelState.value = 'open'
          })
        })
        return
      }

      if (panelState.value === 'closed') return
      panelState.value = 'closing'
      closeTimer = window.setTimeout(() => {
        closeTimer = null
        if (!cancelled && !open() && panelState.value === 'closing') panelState.value = 'closed'
      }, ZEN_REVEAL_CLOSE_MS)
    },
    { flush: 'post' },
  )

  return panelState
}

export const ZenModeSidebarChrome = defineComponent<ZenModeSidebarChromeProps>({
  name: 'ZenModeSidebarChrome',
  props: ['workspaceId', 'sidebarPane', 'zenModeToggleEnabled', 'revealEnabled', 'sidebarSize', 'onSidebarSizeChange'],

  setup(props) {
    const reveal = useZenModeSidebarReveal(() => props.revealEnabled)

    return () => {
      if (!props.zenModeToggleEnabled && !reveal.rendered.value) return null
      return (
        <>
          {reveal.rendered.value ? (
            <ZenModeSidebarReveal
              sidebarPane={props.sidebarPane}
              open={reveal.open.value}
              interactive={props.revealEnabled}
              sidebarSize={props.sidebarSize}
              onSidebarSizeChange={props.onSidebarSizeChange}
              onSurfaceEnter={reveal.onSurfaceEnter}
              onSurfaceLeave={reveal.onSurfaceLeave}
            />
          ) : null}
          {props.zenModeToggleEnabled ? (
            <ZenModeSidebarRevealTriggerLayer
              workspaceId={props.workspaceId}
              zenRevealTriggerEnabled={props.revealEnabled}
              onZenRevealTriggerEnter={reveal.onTriggerEnter}
            />
          ) : null}
        </>
      )
    }
  },
})

const ZenModeSidebarReveal = defineComponent<ZenModeSidebarRevealProps>({
  name: 'ZenModeSidebarReveal',
  props: [
    'sidebarPane',
    'open',
    'interactive',
    'sidebarSize',
    'onSidebarSizeChange',
    'onSurfaceEnter',
    'onSurfaceLeave',
  ],

  setup(props) {
    const hostRef = ref<HTMLDivElement | null>(null)
    const panelRef = ref<HTMLDivElement | null>(null)
    const hitAreaRef = ref<HTMLDivElement | null>(null)
    const resizeRailState = ref<ResizeRailState>('idle')
    const pinnedByDescendantSurface = ref(false)
    const rootFontSizePx = useRootFontSizePx()
    const hostWidth = useElementInlineSize(hostRef, true)
    const panelInteractive = computed(() => props.open && props.interactive)
    const panelState = useZenModeSidebarPanelTransition(() => props.open, panelRef)
    let resizing = false
    let resizeDragCleanup: (() => void) | null = null
    let unpinRecheckFrame: number | null = null
    let lastPointer = { x: 0, y: 0 }
    let lastPointerKnown = false
    let previousDescendantSurfacePinned = false

    const clearUnpinRecheckFrame = () => {
      if (unpinRecheckFrame === null) return
      window.cancelAnimationFrame(unpinRecheckFrame)
      unpinRecheckFrame = null
    }

    const handleResizePointerDown = (event: PointerEvent) => {
      if (!panelInteractive.value) return
      const rect = zenRevealHostRect(hostRef.value)
      if (!rect || rect.width <= 0) return

      event.preventDefault()
      event.stopPropagation()
      resizeDragCleanup?.()
      resizing = true
      lastPointer = { x: event.clientX, y: event.clientY }
      lastPointerKnown = true
      resizeRailState.value = 'drag'
      props.onSurfaceEnter()

      const update = (clientX: number) => {
        props.onSidebarSizeChange(
          clampWorkspaceSidebarSizePercent({
            sidebarPx: clientX - rect.left,
            totalPx: rect.width,
            rootFontSizePx: rootFontSizePx.value,
          }),
        )
      }
      const handlePointerMove = (moveEvent: PointerEvent) => {
        lastPointer = { x: moveEvent.clientX, y: moveEvent.clientY }
        lastPointerKnown = true
        update(moveEvent.clientX)
      }
      const cleanupDragListeners = () => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
        window.removeEventListener('pointercancel', handlePointerUp)
        if (resizeDragCleanup === cleanupDragListeners) resizeDragCleanup = null
      }
      const handlePointerUp = () => {
        cleanupDragListeners()
        resizing = false
        const target =
          typeof document.elementFromPoint === 'function'
            ? document.elementFromPoint(lastPointer.x, lastPointer.y)
            : null
        const pointerInsidePanel = !!target && !!panelRef.value?.contains(target)
        resizeRailState.value = pointerInsidePanel ? 'hover' : 'idle'
        if (!pointerInsidePanel) props.onSurfaceLeave()
      }

      update(event.clientX)
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      window.addEventListener('pointercancel', handlePointerUp)
      resizeDragCleanup = cleanupDragListeners
    }

    onScopeDispose(() => {
      resizeDragCleanup?.()
      clearUnpinRecheckFrame()
      resizeDragCleanup = null
      resizing = false
    })

    const handleSurfaceLeave = (event: MouseEvent) => {
      lastPointer = { x: event.clientX, y: event.clientY }
      lastPointerKnown = true
      if (resizing || pinnedByDescendantSurface.value) return
      if (isPointerInsideRevealBounds(event, hostRef.value, panelRef.value)) return
      if (isZenRevealSurfaceTarget(event.relatedTarget, panelRef.value, hitAreaRef.value)) return
      props.onSurfaceLeave()
    }

    const recheckSurfaceAfterUnpin = () => {
      if (!panelInteractive.value || resizing || pinnedByDescendantSurface.value || !lastPointerKnown) return
      const target =
        typeof document.elementFromPoint === 'function' ? document.elementFromPoint(lastPointer.x, lastPointer.y) : null
      if (
        (target &&
          isZenRevealSurfaceTarget(target, panelRef.value, hitAreaRef.value, {
            includeClosedFloatingSurfaces: false,
          })) ||
        isPointerInsideRevealBounds(
          { clientX: lastPointer.x, clientY: lastPointer.y },
          hostRef.value,
          panelRef.value,
        ) ||
        isPointerInsideElement({ clientX: lastPointer.x, clientY: lastPointer.y }, hitAreaRef.value)
      ) {
        return
      }
      props.onSurfaceLeave()
    }

    const requestUnpinRecheck = () => {
      clearUnpinRecheckFrame()
      unpinRecheckFrame = window.requestAnimationFrame(() => {
        unpinRecheckFrame = null
        recheckSurfaceAfterUnpin()
      })
    }

    const handleDescendantSurfacePinnedChange = (nextPinned: boolean) => {
      const wasPinned = previousDescendantSurfacePinned
      previousDescendantSurfacePinned = nextPinned
      pinnedByDescendantSurface.value = nextPinned
      if (nextPinned) {
        clearUnpinRecheckFrame()
        return
      }
      if (wasPinned) requestUnpinRecheck()
    }

    const handleDocumentPointerMove = (event: PointerEvent) => {
      lastPointer = { x: event.clientX, y: event.clientY }
      lastPointerKnown = true
      if (resizing || pinnedByDescendantSurface.value) return
      if (
        isZenRevealSurfaceTarget(event.target, panelRef.value, hitAreaRef.value) ||
        isPointerInsideRevealBounds(event, hostRef.value, panelRef.value) ||
        isPointerInsideElement(event, hitAreaRef.value)
      ) {
        props.onSurfaceEnter()
        return
      }
      props.onSurfaceLeave()
    }

    // Only an interactive reveal owns the document-level pointer listener.
    watch(
      panelInteractive,
      (interactive, _previous, onCleanup) => {
        if (!interactive) return
        document.addEventListener('pointermove', handleDocumentPointerMove)
        onCleanup(() => document.removeEventListener('pointermove', handleDocumentPointerMove))
      },
      { immediate: true },
    )

    return () => {
      const measuredWidthPx =
        hostWidth.value === null
          ? null
          : workspaceSidebarWidthPx({
              sidebarSize: props.sidebarSize,
              totalPx: hostWidth.value,
              rootFontSizePx: rootFontSizePx.value,
            })
      const width =
        measuredWidthPx === null ? workspaceSidebarWidthExpression(props.sidebarSize) : `${measuredWidthPx}px`
      const style: CSSProperties = { width }
      const dragPlateStyle: CSSProperties = { width, height: `${TITLE_BAR_HEIGHT_PX}px` }
      const interactive = panelInteractive.value

      return (
        <div
          ref={hostRef}
          data-testid="zen-mode-sidebar-layer"
          class="pointer-events-none absolute inset-y-0 left-0 right-0 z-30"
        >
          <div
            ref={hitAreaRef}
            data-testid="zen-mode-sidebar-hit-area"
            class={cn(
              'absolute bottom-0 left-0 w-3',
              props.interactive ? 'pointer-events-auto' : 'pointer-events-none',
            )}
            style={{ top: `${TITLE_BAR_HEIGHT_PX}px` }}
            onMouseenter={props.interactive ? props.onSurfaceEnter : undefined}
            aria-hidden="true"
          />
          <div
            ref={panelRef}
            data-zen-reveal-surface={interactive ? '' : undefined}
            data-testid="zen-mode-sidebar-reveal"
            data-open={props.open ? 'true' : 'false'}
            data-panel-interactive={interactive ? 'true' : 'false'}
            data-state={panelState.value}
            aria-hidden={interactive ? undefined : true}
            inert={interactive ? undefined : true}
            class="goblin-zen-reveal-panel absolute inset-y-0 left-0 flex min-w-0 overflow-hidden bg-navigation"
            style={style}
            onMouseenter={interactive ? props.onSurfaceEnter : undefined}
            onMouseleave={interactive ? handleSurfaceLeave : undefined}
          >
            <FloatingSurfaceBoundary onPinnedChange={handleDescendantSurfacePinnedChange}>
              {props.sidebarPane}
              <ZenModeSidebarResizeRail
                interactive={interactive}
                resizeRailState={resizeRailState.value}
                onPointerDown={handleResizePointerDown}
                onMouseEnter={() => {
                  if (!resizing) resizeRailState.value = 'hover'
                }}
                onMouseLeave={() => {
                  if (!resizing) resizeRailState.value = 'idle'
                }}
              />
            </FloatingSurfaceBoundary>
          </div>
          <ZenModeSidebarDragPlate mounted={interactive} style={dragPlateStyle} onSurfaceEnter={props.onSurfaceEnter} />
        </div>
      )
    }
  },
})

interface ZenModeSidebarDragPlateProps {
  mounted: boolean
  style: CSSProperties
  onSurfaceEnter: () => void
}

const ZenModeSidebarDragPlate: FunctionalComponent<ZenModeSidebarDragPlateProps> = (props) =>
  props.mounted ? (
    <NativeDragPlate
      data-testid="zen-mode-sidebar-drag-plate"
      data-zen-reveal-surface=""
      class="z-30"
      style={props.style}
      onMouseenter={props.onSurfaceEnter}
    />
  ) : null

ZenModeSidebarDragPlate.props = ['mounted', 'style', 'onSurfaceEnter']

function useRootFontSizePx(): Readonly<Ref<number>> {
  const rootFontSizePx = ref(16)
  onMounted(() => {
    const next = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize)
    if (Number.isFinite(next) && next > 0) rootFontSizePx.value = next
  })
  return rootFontSizePx
}
