import { SplitterPanel } from 'reka-ui'
import { computed, defineComponent, onScopeDispose, onUpdated, ref, watch } from 'vue'
import type { ComputedRef, CSSProperties, PropType, Ref, VNodeChild } from 'vue'
import { ResizableHandle, ResizablePanelGroup } from '#/web/components/ui/resizable.tsx'
import { WORKSPACE_PANE_MOTION_STYLE, WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'
import { useElementInlineSize } from '#/web/hooks/useElementInlineSize.ts'
import { cn } from '#/web/lib/cn.ts'

type SplitterSize = number | string
type CollapseTransitionDirection = 'collapsing' | 'expanding'

interface SplitPaneProps {
  before: VNodeChild
  after: VNodeChild
  afterSize: number
  onAfterSizeChange?: (size: number) => void
  class?: string
  beforeClass?: string
  afterClass?: string
  beforeMinSize?: SplitterSize
  beforeContentMinSize?: string
  afterMinSize?: SplitterSize
  afterMaxSize?: SplitterSize
  beforeCollapsed?: boolean
  animateBeforeCollapse?: boolean
  disabled?: boolean
}

interface SplitterPanelHandle {
  collapse(): void
  resize(size: number): void
}

type PendingLayoutCommit =
  | { kind: 'pane'; collapsed: boolean; afterSize: number; animate: boolean }
  | { kind: 'after'; afterSize: number; animate: false }

const BEFORE_PANEL_ID = 'before'
const AFTER_PANEL_ID = 'after'
const RESIZE_HIT_AREA_MARGINS = { fine: 7, coarse: 20 }

export const SplitPane = defineComponent<SplitPaneProps>({
  name: 'SplitPane',
  props: {
    before: { type: null, required: true },
    after: { type: null, required: true },
    afterSize: { type: Number, required: true },
    onAfterSizeChange: Function as PropType<(size: number) => void>,
    class: String,
    beforeClass: String,
    afterClass: String,
    beforeMinSize: [Number, String] as PropType<SplitterSize>,
    beforeContentMinSize: String,
    afterMinSize: [Number, String] as PropType<SplitterSize>,
    afterMaxSize: [Number, String] as PropType<SplitterSize>,
    beforeCollapsed: Boolean,
    animateBeforeCollapse: Boolean,
    disabled: Boolean,
  },

  setup(props) {
    const splitPaneRef = ref<HTMLElement | null>(null)
    const beforeClipRef = ref<HTMLElement | null>(null)
    const beforePanelRef = ref<SplitterPanelHandle | null>(null)
    const afterPanelRef = ref<SplitterPanelHandle | null>(null)
    const collapseTransition = ref<CollapseTransitionDirection | null>(null)
    let collapseTimer: number | null = null
    let pendingLayoutCommit: PendingLayoutCommit | null = null

    const beforeCollapsed = computed(() => props.beforeCollapsed ?? false)
    const collapseTransitioning = computed(() => collapseTransition.value !== null)
    const frozenBeforeMeasurement = computed(() => beforeCollapsed.value || collapseTransitioning.value)
    const splitPaneSize = useElementInlineSize(splitPaneRef, true)
    const measuredBeforeContentSize = useStableBeforeContentSize(beforeClipRef, splitPaneSize, frozenBeforeMeasurement)
    const rootFontSizePx = readRootFontSizePx()
    const beforeMin = computed(() =>
      splitPaneConstraintPercent(
        beforeCollapsed.value ? 0 : (props.beforeMinSize ?? '12rem'),
        rootFontSizePx,
        splitPaneSize.value,
      ),
    )
    const afterMin = computed(() =>
      splitPaneConstraintPercent(props.afterMinSize ?? '12rem', rootFontSizePx, splitPaneSize.value),
    )
    const afterMax = computed(() => splitPaneConstraintPercent(props.afterMaxSize, rootFontSizePx, splitPaneSize.value))
    const beforeContentStyle = computed<CSSProperties>(() => ({
      '--goblin-split-pane-before-open-size': `${100 - props.afterSize}cqw`,
      '--goblin-split-pane-before-measured-size':
        measuredBeforeContentSize.value === null ? undefined : `${measuredBeforeContentSize.value}px`,
      '--goblin-split-pane-before-min-size':
        props.beforeContentMinSize ?? (typeof props.beforeMinSize === 'string' ? props.beforeMinSize : undefined),
      '--goblin-split-pane-after-min-size': typeof props.afterMinSize === 'string' ? props.afterMinSize : undefined,
    }))

    const clearCollapseTimer = () => {
      if (collapseTimer !== null) window.clearTimeout(collapseTimer)
      collapseTimer = null
    }

    const applyLayout = (collapsed: boolean, afterSize: number) => {
      if (collapsed) beforePanelRef.value?.collapse()
      else beforePanelRef.value?.resize(100 - afterSize)
    }

    onUpdated(() => {
      const commit = pendingLayoutCommit
      if (!commit) return
      pendingLayoutCommit = null

      if (commit.animate) {
        // The transition marker is now committed. Resolve its initial style
        // before asking Reka to change the flex layout, matching React's
        // render-then-effect ordering without relying on microtask timing.
        splitPaneRef.value?.getBoundingClientRect()
      }
      if (commit.kind === 'pane') applyLayout(commit.collapsed, commit.afterSize)
      else afterPanelRef.value?.resize(commit.afterSize)

      if (commit.animate) {
        clearCollapseTimer()
        collapseTimer = window.setTimeout(() => {
          collapseTimer = null
          collapseTransition.value = null
        }, WORKSPACE_PANE_TRANSITION_MS)
      }
    })

    watch(
      () => [props.beforeCollapsed ?? false, props.animateBeforeCollapse ?? false, props.afterSize] as const,
      ([collapsed, animate, afterSize], [previousCollapsed, previousAnimate, previousAfterSize]) => {
        if (!animate) {
          pendingLayoutCommit = null
          clearCollapseTimer()
          collapseTransition.value = null
          if (collapsed !== previousCollapsed || previousAnimate) {
            pendingLayoutCommit = { kind: 'pane', collapsed, afterSize, animate: false }
          } else if (!collapsed && afterSize !== previousAfterSize) {
            pendingLayoutCommit = { kind: 'after', afterSize, animate: false }
          }
          return
        }

        if (collapsed !== previousCollapsed) {
          clearCollapseTimer()
          collapseTransition.value = collapsed ? 'collapsing' : 'expanding'
          pendingLayoutCommit = { kind: 'pane', collapsed, afterSize, animate: true }
          return
        }

        if (pendingLayoutCommit) pendingLayoutCommit.afterSize = afterSize
        else if (!collapsed && afterSize !== previousAfterSize) {
          pendingLayoutCommit = { kind: 'after', afterSize, animate: false }
        }
      },
      { flush: 'pre' },
    )

    onScopeDispose(() => {
      pendingLayoutCommit = null
      clearCollapseTimer()
    })

    const handleLayout = (layout: number[]) => {
      if (beforeCollapsed.value) return
      const nextAfterSize = layout[1]
      if (nextAfterSize === undefined || Math.abs(nextAfterSize - props.afterSize) <= 0.01) return
      props.onAfterSizeChange?.(nextAfterSize)
    }

    return () => (
      <div
        ref={splitPaneRef}
        data-before-collapsed={beforeCollapsed.value ? 'true' : undefined}
        data-collapse-transition={collapseTransition.value ?? undefined}
        style={WORKSPACE_PANE_MOTION_STYLE}
        class={cn('goblin-split-pane min-h-0 min-w-0', props.class)}
      >
        <ResizablePanelGroup direction="horizontal" onLayout={handleLayout} class="min-h-0 min-w-0">
          <SplitterPanel
            ref={(value) => {
              beforePanelRef.value = splitterPanelHandle(value)
            }}
            id={BEFORE_PANEL_ID}
            order={0}
            defaultSize={beforeCollapsed.value ? 0 : 100 - props.afterSize}
            minSize={beforeMin.value}
            collapsible
            collapsedSize={0}
            data-slot="resizable-panel"
            class={cn('flex min-h-0 min-w-0 overflow-hidden', props.beforeClass)}
          >
            <div
              ref={beforeClipRef}
              aria-hidden={beforeCollapsed.value || undefined}
              inert={beforeCollapsed.value || undefined}
              class="goblin-split-pane__before-clip flex min-h-0 min-w-0 flex-1 overflow-hidden"
            >
              <div
                class={cn(
                  'goblin-split-pane__before-content flex min-h-0 shrink-0',
                  beforeCollapsed.value && 'goblin-split-pane__before-content--collapsed',
                )}
                style={beforeContentStyle.value}
              >
                {props.before}
              </div>
            </div>
          </SplitterPanel>
          <ResizableHandle
            disabled={(props.disabled ?? false) || beforeCollapsed.value}
            hitAreaMargins={RESIZE_HIT_AREA_MARGINS}
            class={cn(
              'goblin-split-pane__handle',
              beforeCollapsed.value && !collapseTransitioning.value && 'goblin-split-pane__handle--collapsed',
            )}
          />
          <SplitterPanel
            ref={(value) => {
              afterPanelRef.value = splitterPanelHandle(value)
            }}
            id={AFTER_PANEL_ID}
            order={1}
            defaultSize={beforeCollapsed.value ? 100 : props.afterSize}
            minSize={afterMin.value}
            maxSize={afterMax.value}
            data-slot="resizable-panel"
            class={cn('flex min-h-0 min-w-0 overflow-hidden', props.afterClass)}
          >
            {props.after}
          </SplitterPanel>
        </ResizablePanelGroup>
      </div>
    )
  },
})

function useStableBeforeContentSize(
  beforeClipRef: Ref<HTMLElement | null>,
  splitPaneSize: ComputedRef<number | null>,
  frozen: ComputedRef<boolean>,
): Ref<number | null> {
  const measuredBeforeSize = useElementInlineSize(beforeClipRef, () => !frozen.value)
  const measuredAtSplitPaneSize = ref<number | null>(null)
  const stableBeforeSize = ref<number | null>(null)

  watch(
    [frozen, measuredBeforeSize, splitPaneSize],
    ([isFrozen, beforeSize, paneSize]) => {
      if (!isFrozen && beforeSize !== null) {
        measuredAtSplitPaneSize.value = paneSize
        stableBeforeSize.value = beforeSize
        return
      }
      if (!isFrozen || paneSize === null || measuredAtSplitPaneSize.value === null) return
      if (Math.abs(measuredAtSplitPaneSize.value - paneSize) > 0.5) stableBeforeSize.value = null
    },
    { immediate: true },
  )

  return stableBeforeSize
}

function splitPaneConstraintPercent(
  size: SplitterSize | undefined,
  rootFontSizePx: number,
  splitPaneSize: number | null,
): number | undefined {
  if (size === undefined) return undefined
  if (typeof size === 'number') return size
  const value = Number.parseFloat(size)
  if (!Number.isFinite(value)) throw new Error(`invalid split pane size: ${size}`)
  if (size.endsWith('%')) return value
  const pixels = size.endsWith('rem') ? value * rootFontSizePx : size.endsWith('px') ? value : null
  if (pixels !== null) return splitPaneSize === null ? undefined : (pixels / splitPaneSize) * 100
  throw new Error(`unsupported split pane size unit: ${size}`)
}

function readRootFontSizePx(): number {
  if (typeof window === 'undefined') return 16
  const value = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize)
  return Number.isFinite(value) && value > 0 ? value : 16
}

function splitterPanelHandle(value: unknown): SplitterPanelHandle | null {
  if (!value || typeof value !== 'object' || !('collapse' in value) || !('resize' in value)) return null
  const collapse = value.collapse
  const resize = value.resize
  if (typeof collapse !== 'function' || typeof resize !== 'function') return null
  return {
    collapse: () => collapse(),
    resize: (size) => resize(size),
  }
}
