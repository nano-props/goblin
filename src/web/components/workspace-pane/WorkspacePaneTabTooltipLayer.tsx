import { clamp } from 'es-toolkit'
import { computed, defineComponent, nextTick, onMounted, onScopeDispose, ref, shallowRef, Teleport, watch } from 'vue'
import type { CSSProperties, HTMLAttributes, PropType } from 'vue'
import { ToolbarTabList } from '#/web/components/tab-strip/ToolbarTabStrip.tsx'
import { TOOLTIP_SURFACE_CLASS } from '#/web/components/ui/tooltip.tsx'
import type { WorkspacePaneTabItem } from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import { cn } from '#/web/lib/cn.ts'

interface AnchorRect {
  left: number
  top: number
  width: number
  height: number
}

interface TooltipState {
  item: WorkspacePaneTabItem
  rect: AnchorRect
}

const ITEM_SELECTOR = '[data-workspace-pane-tab-tooltip-id]'
const ITEM_ATTRIBUTE = 'data-workspace-pane-tab-tooltip-id'
const SHOW_DELAY_MS = 500
const GRACE_MS = 100
const VIEWPORT_MARGIN = 8
const ANCHOR_OFFSET = 6
const MAX_WIDTH = 420
const FADE_TRANSITION = 'opacity 100ms ease-out'
const SLIDE_TRANSITION = 'left 150ms ease-out, opacity 100ms ease-out'

interface WorkspacePaneTabTooltipLayerProps {
  items: readonly WorkspacePaneTabItem[]
  role?: string
  'aria-label'?: string
  class?: HTMLAttributes['class']
}

export const WorkspacePaneTabTooltipLayer = defineComponent<WorkspacePaneTabTooltipLayerProps>({
  name: 'WorkspacePaneTabTooltipLayer',
  inheritAttrs: false,
  props: {
    items: { type: Array as PropType<readonly WorkspacePaneTabItem[]>, required: true },
  },

  setup(props, { attrs, slots }) {
    const rootRef = ref<HTMLElement | null>(null)
    const popupRef = ref<HTMLDivElement | null>(null)
    const tooltip = shallowRef<TooltipState | null>(null)
    const popupSize = shallowRef({ width: MAX_WIDTH, height: 0 })
    const popupVisible = ref(false)
    const itemsById = computed(() => new Map(props.items.map((item) => [item.identity, item])))
    let activeItemId: string | null = null
    let showTimer: number | null = null
    let graceTimer: number | null = null
    let visibilityFrame: number | null = null
    let warm = false

    const clearShowTimer = () => {
      if (showTimer === null) return
      window.clearTimeout(showTimer)
      showTimer = null
    }

    const clearGraceTimer = () => {
      if (graceTimer === null) return
      window.clearTimeout(graceTimer)
      graceTimer = null
    }

    const clearVisibilityFrame = () => {
      if (visibilityFrame === null) return
      window.cancelAnimationFrame(visibilityFrame)
      visibilityFrame = null
    }

    const hide = () => {
      clearShowTimer()
      clearGraceTimer()
      clearVisibilityFrame()
      warm = false
      activeItemId = null
      popupVisible.value = false
      tooltip.value = null
    }

    const measurePopup = () => {
      const element = popupRef.value
      if (!element) return
      popupSize.value = { width: element.offsetWidth, height: element.offsetHeight }
    }

    const showTooltip = (nextTooltip: TooltipState) => {
      const wasVisible = tooltip.value !== null && popupVisible.value
      warm = true
      activeItemId = nextTooltip.item.identity
      tooltip.value = nextTooltip
      void nextTick(() => {
        measurePopup()
        if (wasVisible) return
        clearVisibilityFrame()
        visibilityFrame = window.requestAnimationFrame(() => {
          visibilityFrame = null
          popupVisible.value = true
        })
      })
    }

    const itemElementFromTarget = (target: EventTarget | null): HTMLElement | null =>
      target instanceof Element ? target.closest<HTMLElement>(ITEM_SELECTOR) : null

    const showItemElement = (element: HTMLElement) => {
      const nextTooltip = resolveTooltipStateFromElement(element, itemsById.value)
      if (nextTooltip) showTooltip(nextTooltip)
    }

    const showItemById = (id: string) => {
      const nextTooltip = resolveTooltipStateById(rootRef.value, itemsById.value, id)
      if (nextTooltip) showTooltip(nextTooltip)
    }

    const startGrace = () => {
      if (!warm) return
      clearGraceTimer()
      graceTimer = window.setTimeout(() => {
        graceTimer = null
        hide()
      }, GRACE_MS)
    }

    const handleEnter = (next: EventTarget | null, previous: EventTarget | null) => {
      const nextElement = itemElementFromTarget(next)
      if (!nextElement || nextElement === itemElementFromTarget(previous)) return
      clearGraceTimer()
      clearShowTimer()
      if (warm) {
        showItemElement(nextElement)
        return
      }
      const itemId = nextElement.getAttribute(ITEM_ATTRIBUTE)
      if (!itemId) return
      showTimer = window.setTimeout(() => {
        showTimer = null
        showItemById(itemId)
      }, SHOW_DELAY_MS)
    }

    const handlePointerItemLeave = (event: PointerEvent) => {
      const previousElement = itemElementFromTarget(event.target)
      const nextElement = itemElementFromTarget(event.relatedTarget)
      if (!previousElement || previousElement === nextElement) return
      clearShowTimer()
      if (nextElement || isEventTargetWithin(rootRef.value, event.relatedTarget)) return
      startGrace()
    }

    const handleContainerLeave = (event: PointerEvent) => {
      clearShowTimer()
      const root = rootRef.value
      if (root && isPointerWithin(root, event)) return
      startGrace()
    }

    const handleFocusLeave = (event: FocusEvent) => {
      const previousElement = itemElementFromTarget(event.target)
      if (!previousElement || previousElement === itemElementFromTarget(event.relatedTarget)) return
      clearShowTimer()
      startGrace()
    }

    const onPointerover = (event: PointerEvent) => handleEnter(event.target, event.relatedTarget)
    const onFocusin = (event: FocusEvent) => handleEnter(event.target, event.relatedTarget)

    onMounted(() => {
      const root = rootRef.value
      if (!root) throw new Error('workspace pane tab tooltip root missing')
      root.addEventListener('pointerover', onPointerover)
      root.addEventListener('pointerout', handlePointerItemLeave)
      root.addEventListener('pointerleave', handleContainerLeave)
      root.addEventListener('focusin', onFocusin)
      root.addEventListener('focusout', handleFocusLeave)
      root.addEventListener('pointerdown', hide, true)
      root.addEventListener('wheel', hide, true)
      root.addEventListener('scroll', hide, true)
      window.addEventListener('blur', hide)
    })

    onScopeDispose(() => {
      const root = rootRef.value
      root?.removeEventListener('pointerover', onPointerover)
      root?.removeEventListener('pointerout', handlePointerItemLeave)
      root?.removeEventListener('pointerleave', handleContainerLeave)
      root?.removeEventListener('focusin', onFocusin)
      root?.removeEventListener('focusout', handleFocusLeave)
      root?.removeEventListener('pointerdown', hide, true)
      root?.removeEventListener('wheel', hide, true)
      root?.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
      clearShowTimer()
      clearGraceTimer()
      clearVisibilityFrame()
    })

    // An active tooltip projects a store-owned tab item. If that projection
    // is replaced, refresh its anchor and content or close it when removed.
    watch(
      itemsById,
      (items) => {
        if (!activeItemId) return
        const nextTooltip = resolveTooltipStateById(rootRef.value, items, activeItemId)
        if (!nextTooltip) {
          hide()
          return
        }
        tooltip.value = nextTooltip
        void nextTick(measurePopup)
      },
      { flush: 'post' },
    )

    return () => {
      const role = typeof attrs.role === 'string' ? attrs.role : undefined
      const currentTooltip = tooltip.value
      const position = currentTooltip
        ? tooltipPosition(currentTooltip.rect, popupSize.value, VIEWPORT_MARGIN, ANCHOR_OFFSET)
        : null
      const popupStyle: CSSProperties | undefined = position
        ? {
            left: `${position.left}px`,
            top: `${position.top}px`,
            maxWidth: `${MAX_WIDTH}px`,
            opacity: popupVisible.value ? 1 : 0,
            transition: popupVisible.value ? SLIDE_TRANSITION : FADE_TRANSITION,
          }
        : undefined

      return (
        <>
          <ToolbarTabList
            {...attrs}
            ref={(value) => {
              rootRef.value = componentRootElement(value)
            }}
            aria-orientation={role === 'tablist' ? 'horizontal' : undefined}
          >
            {slots.default?.()}
          </ToolbarTabList>
          {currentTooltip && position ? (
            <Teleport to="body">
              <div
                ref={popupRef}
                role="tooltip"
                class={cn('pointer-events-none fixed z-50 w-max px-3 py-2 shadow-lg', TOOLTIP_SURFACE_CLASS)}
                style={popupStyle}
              >
                <div class="truncate text-xs font-semibold text-foreground">{currentTooltip.item.tooltip}</div>
              </div>
            </Teleport>
          ) : null}
        </>
      )
    }
  },
})

function componentRootElement(value: unknown): HTMLElement | null {
  if (value instanceof HTMLElement) return value
  if (!value || typeof value !== 'object' || !('$el' in value)) return null
  return value.$el instanceof HTMLElement ? value.$el : null
}

function resolveTooltipStateFromElement(
  element: HTMLElement,
  itemsById: Map<string, WorkspacePaneTabItem>,
): TooltipState | null {
  const id = element.getAttribute(ITEM_ATTRIBUTE)
  if (!id) return null
  const item = itemsById.get(id)
  const rect = readAnchorRect(element)
  return item && rect ? { item, rect } : null
}

function resolveTooltipStateById(
  root: HTMLElement | null,
  itemsById: Map<string, WorkspacePaneTabItem>,
  id: string,
): TooltipState | null {
  if (!root) return null
  const item = itemsById.get(id)
  let element: HTMLElement | null = null
  for (const candidate of root.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) {
    if (candidate.getAttribute(ITEM_ATTRIBUTE) === id) {
      element = candidate
      break
    }
  }
  const rect = element ? readAnchorRect(element) : null
  return item && rect ? { item, rect } : null
}

function readAnchorRect(element: HTMLElement): AnchorRect | null {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
    ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    : null
}

function isPointerWithin(container: HTMLElement, event: PointerEvent): boolean {
  const rect = container.getBoundingClientRect()
  return (
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom
  )
}

function isEventTargetWithin(container: HTMLElement | null, target: EventTarget | null): boolean {
  return !!container && target instanceof Node && container.contains(target)
}

function tooltipPosition(
  rect: AnchorRect,
  size: { width: number; height: number },
  margin: number,
  offset: number,
): { left: number; top: number } {
  return {
    left: clamp(rect.left, margin, Math.max(margin, window.innerWidth - margin - size.width)),
    top: clamp(rect.top + rect.height + offset, margin, Math.max(margin, window.innerHeight - margin - size.height)),
  }
}
