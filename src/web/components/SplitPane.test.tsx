// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { act } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SplitPane } from '#/web/components/SplitPane.tsx'
import { WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'

const resizableMocks = vi.hoisted(() => ({
  setLayout: vi.fn<(layout: Record<string, number>) => void>(),
  onLayoutChanged: null as null | ((layout: Record<string, number>) => void),
  groupDisabled: null as boolean | null,
  beforePanelMinSize: null as number | string | null,
}))

vi.mock('react-resizable-panels', () => ({
  useGroupRef: () => ({ current: { setLayout: resizableMocks.setLayout } }),
}))

vi.mock('#/web/components/ui/resizable.tsx', () => ({
  ResizablePanelGroup: ({
    children,
    disabled,
    onLayoutChanged,
    className,
    ...props
  }: {
    children: React.ReactNode
    disabled?: boolean
    onLayoutChanged?: (layout: Record<string, number>) => void
    className?: string
  } & Record<string, unknown>) => {
    resizableMocks.onLayoutChanged = onLayoutChanged ?? null
    resizableMocks.groupDisabled = disabled ?? null
    const {
      groupRef: _groupRef,
      orientation: _orientation,
      resizeTargetMinimumSize: _resizeTargetMinimumSize,
      defaultLayout: _defaultLayout,
      ...domProps
    } = props
    return (
      <div className={className} {...domProps}>
        {children}
      </div>
    )
  },
  ResizablePanel: ({
    children,
    className,
    ...props
  }: {
    children: React.ReactNode
    className?: string
  } & Record<string, unknown>) => {
    const { minSize, maxSize: _maxSize, ...domProps } = props
    if (props.id === 'before') resizableMocks.beforePanelMinSize = (minSize as number | string | undefined) ?? null
    return (
      <section className={className} {...domProps}>
        {children}
      </section>
    )
  },
  ResizableHandle: ({ disabled, className }: { disabled?: boolean; className?: string }) => (
    <button type="button" data-testid="resize-handle" disabled={disabled} className={className} />
  ),
}))

const originalResizeObserver = globalThis.ResizeObserver
const resizeObserverRecords: ResizeObserverRecord[] = []

interface ResizeObserverRecord {
  callback: ResizeObserverCallback
  elements: Set<Element>
}

beforeEach(() => {
  resizableMocks.setLayout.mockClear()
  resizableMocks.onLayoutChanged = null
  resizableMocks.groupDisabled = null
  resizableMocks.beforePanelMinSize = null
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
  // Reset our module-level render handle so the next test that only
  // calls `rerender(...)` (e.g. "keeps panel transition active when
  // collapse is reversed before the timeout settles") falls through to
  // `render(...)` instead of trying to rerender a root that
  // `cleanup()` already unmounted.
  lastRender = null
})

describe('SplitPane', () => {
  test('persists user layout changes while expanded', () => {
    const onAfterSizeChange = vi.fn()
    render(<SplitPane before={<div />} after={<div />} afterSize={62} onAfterSizeChange={onAfterSizeChange} />)

    expect(resizableMocks.setLayout).toHaveBeenLastCalledWith({ before: 38, after: 62 })

    act(() => {
      resizableMocks.onLayoutChanged?.({ before: 34, after: 66 })
    })

    expect(onAfterSizeChange).toHaveBeenCalledWith(66)
  })

  test('collapses the before pane without persisting the collapsed layout', () => {
    const onAfterSizeChange = vi.fn()
    const { container } = render(
      <SplitPane
        before={<button type="button">before</button>}
        after={<div />}
        afterSize={62}
        beforeCollapsed
        beforeMinSize="14rem"
        beforeContentMinSize="14rem"
        afterMinSize="22rem"
        onAfterSizeChange={onAfterSizeChange}
      />,
    )

    expect(resizableMocks.setLayout).toHaveBeenLastCalledWith({ before: 0, after: 100 })
    expect(resizableMocks.groupDisabled).toBe(true)
    expect(resizableMocks.beforePanelMinSize).toBe(0)
    expect(beforePanel(container)?.getAttribute('aria-hidden')).toBe('true')
    expect(beforeClip(container)).not.toBeNull()
    expect(beforeContent(container)?.style.getPropertyValue('--goblin-split-pane-before-open-size')).toBe('38cqw')
    expect(beforeContent(container)?.style.getPropertyValue('--goblin-split-pane-before-min-size')).toBe('14rem')
    expect(beforeContent(container)?.style.getPropertyValue('--goblin-split-pane-after-min-size')).toBe('22rem')
    expect(splitPane(container)?.style.getPropertyValue('--goblin-workspace-pane-transition-duration')).toBe(
      `${WORKSPACE_PANE_TRANSITION_MS}ms`,
    )
    expect(beforeContent(container)?.className).toContain('shrink-0')
    expect(beforeContent(container)?.className).not.toContain('flex-1')
    expect(resizeHandle(container)?.disabled).toBe(true)

    act(() => {
      resizableMocks.onLayoutChanged?.({ before: 0, after: 100 })
    })

    expect(onAfterSizeChange).not.toHaveBeenCalled()
  })

  test('uses measured before panel width when available', async () => {
    const { container } = render(
      <SplitPane
        before={<div />}
        after={<div />}
        afterSize={62}
        beforeMinSize="14rem"
        beforeContentMinSize="14rem"
        afterMinSize="22rem"
      />,
    )

    emitElementResize(splitPane(container), 800)
    emitElementResize(beforeClip(container), 320)
    await flushEffects()

    expect(beforeContent(container)?.style.getPropertyValue('--goblin-split-pane-before-measured-size')).toBe('320px')
  })

  test('does not animate the initially collapsed pane', () => {
    const { container } = render(
      <SplitPane
        before={<div />}
        after={<div />}
        afterSize={62}
        beforeCollapsed
        animateBeforeCollapse
        beforeMinSize={0}
        beforeContentMinSize="14rem"
      />,
    )

    expect(splitPane(container)?.dataset.collapseTransition).toBeUndefined()
  })

  test('keeps panel transition active when collapse is reversed before the timeout settles', async () => {
    vi.useFakeTimers()
    try {
      const splitPaneElement = (collapsed: boolean) => (
        <SplitPane
          before={<div />}
          after={<div />}
          afterSize={62}
          beforeCollapsed={collapsed}
          animateBeforeCollapse
          beforeMinSize={collapsed ? 0 : '14rem'}
          beforeContentMinSize="14rem"
        />
      )

      const { container } = render(splitPaneElement(false))
      expect(splitPane(container)?.dataset.collapseTransition).toBeUndefined()

      rerender(splitPaneElement(true))
      await flushEffects()
      expect(splitPane(container)?.dataset.collapseTransition).toBe('collapsing')

      act(() => {
        vi.advanceTimersByTime(120)
      })
      expect(splitPane(container)?.dataset.collapseTransition).toBe('collapsing')

      rerender(splitPaneElement(false))
      await flushEffects()
      expect(splitPane(container)?.dataset.collapseTransition).toBe('expanding')
      expect(resizableMocks.setLayout).toHaveBeenLastCalledWith({ before: 38, after: 62 })

      act(() => {
        vi.advanceTimersByTime(239)
      })
      expect(splitPane(container)?.dataset.collapseTransition).toBe('expanding')

      act(() => {
        vi.advanceTimersByTime(1)
      })
      await flushEffects()
      expect(splitPane(container)?.dataset.collapseTransition).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})

let lastRender: RenderResult | null = null

function render(element: ReactNode): RenderResult {
  lastRender = renderInJsdom(element)
  return lastRender
}

function rerender(element: ReactNode): RenderResult {
  if (!lastRender) return render(element)
  lastRender.rerender(element)
  return lastRender
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve()
  })
}

function splitPane(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('.goblin-split-pane') ?? null
}

function beforePanel(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('section[id="before"]') ?? null
}

function beforeClip(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('.goblin-split-pane__before-clip') ?? null
}

function beforeContent(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('.goblin-split-pane__before-content') ?? null
}

function resizeHandle(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('[data-testid="resize-handle"]') ?? null
}

function emitElementResize(element: Element | null, width: number) {
  if (!element) throw new Error('Cannot resize a missing element')
  const entry = { target: element, contentRect: { width } } as ResizeObserverEntry
  act(() => {
    for (const record of resizeObserverRecords) {
      if (record.elements.has(element)) record.callback([entry], {} as ResizeObserver)
    }
  })
}
