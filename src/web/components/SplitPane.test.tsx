// @vitest-environment jsdom

import { defineComponent, nextTick, ref } from 'vue'
import type { HTMLAttributes, VNodeChild } from 'vue'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useFakeTimers } from '#/test-utils/timers.ts'
import { SplitPane } from '#/web/components/SplitPane.tsx'
import { WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'

const splitterMocks = vi.hoisted(() => ({
  onLayout: null as null | ((layout: number[]) => void),
  beforeDefaultSize: null as number | null,
  afterDefaultSize: null as number | null,
  beforeMinSize: null as number | null,
  keyboardResizeBy: null as number | null,
  handleDisabled: false,
  beforeCollapse: vi.fn(),
  beforeResize: vi.fn<(size: number) => void>(),
  afterResize: vi.fn<(size: number) => void>(),
}))

interface MockComponentContext {
  attrs: HTMLAttributes
  slots: { default?: () => VNodeChild }
  expose: (exposed?: Record<string, unknown>) => void
}

vi.mock('reka-ui', () => ({
  SplitterGroup: {
    name: 'MockSplitterGroup',
    inheritAttrs: false,
    props: ['direction', 'keyboardResizeBy', 'onLayout'],
    setup(
      props: { keyboardResizeBy?: number; onLayout?: (layout: number[]) => void },
      { attrs, slots }: MockComponentContext,
    ) {
      return () => {
        splitterMocks.keyboardResizeBy = props.keyboardResizeBy ?? null
        splitterMocks.onLayout = props.onLayout ?? null
        return <div class={attrs.class}>{slots.default?.()}</div>
      }
    },
  },
  SplitterPanel: {
    name: 'MockSplitterPanel',
    inheritAttrs: false,
    props: ['id', 'defaultSize', 'minSize', 'maxSize', 'order', 'collapsible', 'collapsedSize'],
    setup(
      props: { id?: string; defaultSize?: number; minSize?: number },
      { attrs, slots, expose }: MockComponentContext,
    ) {
      const collapse = () => {
        if (props.id === 'before') splitterMocks.beforeCollapse()
      }
      const resize = (size: number) => {
        if (props.id === 'before') splitterMocks.beforeResize(size)
        else splitterMocks.afterResize(size)
      }
      expose({ collapse, resize })
      return () => {
        if (props.id === 'before') {
          splitterMocks.beforeDefaultSize = props.defaultSize ?? null
          splitterMocks.beforeMinSize = props.minSize ?? null
        } else {
          splitterMocks.afterDefaultSize = props.defaultSize ?? null
        }
        return (
          <section id={props.id} class={attrs.class} data-slot="resizable-panel">
            {slots.default?.()}
          </section>
        )
      }
    },
  },
  SplitterResizeHandle: {
    name: 'MockSplitterResizeHandle',
    inheritAttrs: false,
    props: ['disabled', 'hitAreaMargins'],
    setup(props: { disabled?: boolean }, { attrs, slots }: MockComponentContext) {
      return () => {
        splitterMocks.handleDisabled = props.disabled ?? false
        return (
          <button type="button" data-testid="resize-handle" disabled={props.disabled} class={attrs.class}>
            {slots.default?.()}
          </button>
        )
      }
    },
  },
}))

const originalResizeObserver = globalThis.ResizeObserver
const resizeObserverRecords: ResizeObserverRecord[] = []

interface ResizeObserverRecord {
  callback: ResizeObserverCallback
  elements: Set<Element>
}

beforeEach(() => {
  splitterMocks.onLayout = null
  splitterMocks.beforeDefaultSize = null
  splitterMocks.afterDefaultSize = null
  splitterMocks.beforeMinSize = null
  splitterMocks.keyboardResizeBy = null
  splitterMocks.handleDisabled = false
  splitterMocks.beforeCollapse.mockClear()
  splitterMocks.beforeResize.mockClear()
  splitterMocks.afterResize.mockClear()
  resizeObserverRecords.length = 0
  globalThis.ResizeObserver = class TestResizeObserver {
    private readonly record: ResizeObserverRecord

    constructor(callback: ResizeObserverCallback) {
      this.record = { callback, elements: new Set<Element>() }
      resizeObserverRecords.push(this.record)
    }

    observe = (element: Element) => {
      this.record.elements.add(element)
    }

    unobserve = (element: Element) => {
      this.record.elements.delete(element)
    }

    disconnect = () => {
      this.record.elements.clear()
    }
  }
})

afterEach(() => {
  globalThis.ResizeObserver = originalResizeObserver
})

describe('SplitPane', () => {
  test('preserves the mainline keyboard resize step', () => {
    const View = defineComponent({
      setup() {
        return () => <SplitPane before={<div />} after={<div />} afterSize={62} />
      },
    })
    renderInJsdom(View)

    expect(splitterMocks.keyboardResizeBy).toBe(5)
  })

  test('persists user layout changes while expanded', async () => {
    const onAfterSizeChange = vi.fn()
    const View = defineComponent({
      setup() {
        return () => <SplitPane before={<div />} after={<div />} afterSize={62} onAfterSizeChange={onAfterSizeChange} />
      },
    })
    renderInJsdom(View)

    expect(splitterMocks.beforeDefaultSize).toBe(38)
    expect(splitterMocks.afterDefaultSize).toBe(62)

    splitterMocks.onLayout?.([34, 66])

    expect(onAfterSizeChange).toHaveBeenCalledWith(66)
  })

  test('collapses the before pane without persisting the collapsed layout', async () => {
    const onAfterSizeChange = vi.fn()
    const View = defineComponent({
      setup() {
        return () => (
          <SplitPane
            before={<button type="button">before</button>}
            after={<div />}
            afterSize={62}
            beforeCollapsed
            beforeMinSize="14rem"
            beforeContentMinSize="14rem"
            afterMinSize="22rem"
            onAfterSizeChange={onAfterSizeChange}
          />
        )
      },
    })
    const { container } = renderInJsdom(View)

    expect(splitterMocks.beforeDefaultSize).toBe(0)
    expect(splitterMocks.afterDefaultSize).toBe(100)
    expect(splitterMocks.beforeMinSize).toBe(0)
    expect(splitterMocks.handleDisabled).toBe(true)
    expect(beforeClip(container)?.getAttribute('aria-hidden')).toBe('true')
    expect(beforeContent(container)?.style.getPropertyValue('--goblin-split-pane-before-open-size')).toBe('38cqw')
    expect(beforeContent(container)?.style.getPropertyValue('--goblin-split-pane-before-min-size')).toBe('14rem')
    expect(beforeContent(container)?.style.getPropertyValue('--goblin-split-pane-after-min-size')).toBe('22rem')
    expect(splitPane(container)?.style.getPropertyValue('--goblin-workspace-pane-transition-duration')).toBe(
      `${WORKSPACE_PANE_TRANSITION_MS}ms`,
    )
    expect(beforeContent(container)?.className).toContain('shrink-0')
    expect(beforeContent(container)?.className).not.toContain('flex-1')
    expect(resizeHandle(container)?.disabled).toBe(true)

    splitterMocks.onLayout?.([0, 100])
    expect(onAfterSizeChange).not.toHaveBeenCalled()
  })

  test('uses measured before panel width when available', async () => {
    const View = defineComponent({
      setup() {
        return () => (
          <SplitPane
            before={<div />}
            after={<div />}
            afterSize={62}
            beforeMinSize="14rem"
            beforeContentMinSize="14rem"
            afterMinSize="22rem"
          />
        )
      },
    })
    const { container } = renderInJsdom(View)

    await nextTick()
    emitElementResize(splitPane(container), 800)
    emitElementResize(beforeClip(container), 320)
    await nextTick()

    expect(beforeContent(container)?.style.getPropertyValue('--goblin-split-pane-before-measured-size')).toBe('320px')
  })

  test('does not animate the initially collapsed pane', async () => {
    const View = defineComponent({
      setup() {
        return () => (
          <SplitPane
            before={<div />}
            after={<div />}
            afterSize={62}
            beforeCollapsed
            animateBeforeCollapse
            beforeMinSize={0}
            beforeContentMinSize="14rem"
          />
        )
      },
    })
    const { container } = renderInJsdom(View)

    expect(splitPane(container)?.dataset.collapseTransition).toBeUndefined()
  })

  test('keeps panel transition active when collapse is reversed before the timeout settles', async () => {
    useFakeTimers()
    const collapsed = ref(false)
    const View = defineComponent({
      setup() {
        return () => (
          <SplitPane
            before={<div />}
            after={<div />}
            afterSize={62}
            beforeCollapsed={collapsed.value}
            animateBeforeCollapse
            beforeMinSize={collapsed.value ? 0 : '14rem'}
            beforeContentMinSize="14rem"
          />
        )
      },
    })
    const { container } = renderInJsdom(View)
    expect(splitPane(container)?.dataset.collapseTransition).toBeUndefined()

    collapsed.value = true
    await flushVueUpdates()
    expect(splitPane(container)?.dataset.collapseTransition).toBe('collapsing')
    expect(splitterMocks.beforeCollapse).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(120)
    expect(splitPane(container)?.dataset.collapseTransition).toBe('collapsing')

    collapsed.value = false
    await flushVueUpdates()
    expect(splitPane(container)?.dataset.collapseTransition).toBe('expanding')
    expect(splitterMocks.beforeResize).toHaveBeenLastCalledWith(38)

    vi.advanceTimersByTime(239)
    expect(splitPane(container)?.dataset.collapseTransition).toBe('expanding')

    vi.advanceTimersByTime(1)
    await nextTick()
    expect(splitPane(container)?.dataset.collapseTransition).toBeUndefined()
  })

  test('commits the transition style before changing the splitter layout', async () => {
    useFakeTimers()
    const collapsed = ref(false)
    const View = defineComponent({
      setup() {
        return () => (
          <SplitPane
            before={<div />}
            after={<div />}
            afterSize={62}
            beforeCollapsed={collapsed.value}
            animateBeforeCollapse
          />
        )
      },
    })
    const { container } = renderInJsdom(View)
    const root = splitPane(container)
    if (!root) throw new Error('missing split pane')
    const resolveTransitionStyle = vi.spyOn(root, 'getBoundingClientRect')
    splitterMocks.beforeCollapse.mockImplementationOnce(() => {
      expect(root.dataset.collapseTransition).toBe('collapsing')
      expect(resolveTransitionStyle).toHaveBeenCalledTimes(1)
    })

    collapsed.value = true
    await flushVueUpdates()

    expect(splitterMocks.beforeCollapse).toHaveBeenCalledTimes(1)
  })

  test('ends an active collapse transition when animation is disabled', async () => {
    useFakeTimers()
    const collapsed = ref(false)
    const animate = ref(true)
    const View = defineComponent({
      setup() {
        return () => (
          <SplitPane
            before={<div />}
            after={<div />}
            afterSize={62}
            beforeCollapsed={collapsed.value}
            animateBeforeCollapse={animate.value}
            beforeMinSize={collapsed.value ? 0 : '14rem'}
            beforeContentMinSize="14rem"
          />
        )
      },
    })
    const { container } = renderInJsdom(View)

    collapsed.value = true
    await flushVueUpdates()
    expect(splitPane(container)?.dataset.collapseTransition).toBe('collapsing')

    animate.value = false
    await flushVueUpdates()
    expect(splitPane(container)?.dataset.collapseTransition).toBeUndefined()

    vi.advanceTimersByTime(240)
    await nextTick()
    expect(splitPane(container)?.dataset.collapseTransition).toBeUndefined()
  })
})

async function flushVueUpdates(): Promise<void> {
  await nextTick()
  await nextTick()
}

function splitPane(container: Element): HTMLElement | null {
  return container.querySelector<HTMLElement>('.goblin-split-pane')
}

function beforeClip(container: Element): HTMLElement | null {
  return container.querySelector<HTMLElement>('.goblin-split-pane__before-clip')
}

function beforeContent(container: Element): HTMLElement | null {
  return container.querySelector<HTMLElement>('.goblin-split-pane__before-content')
}

function resizeHandle(container: Element): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('[data-testid="resize-handle"]')
}

function emitElementResize(element: Element | null, width: number): void {
  if (!element) throw new Error('Cannot resize a missing element')
  const entry = { target: element, contentRect: { width } } as ResizeObserverEntry
  for (const record of resizeObserverRecords) {
    if (record.elements.has(element)) record.callback([entry], {} as ResizeObserver)
  }
}
