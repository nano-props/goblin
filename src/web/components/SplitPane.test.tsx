// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SplitPane } from '#/web/components/SplitPane.tsx'

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

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const originalResizeObserver = globalThis.ResizeObserver
const resizeObserverRecords: ResizeObserverRecord[] = []

interface ResizeObserverRecord {
  callback: ResizeObserverCallback
  elements: Set<Element>
}

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
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
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  globalThis.ResizeObserver = originalResizeObserver
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
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
    render(
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
    expect(beforePanel()?.getAttribute('aria-hidden')).toBe('true')
    expect(beforeClip()).not.toBeNull()
    expect(beforeContent()?.style.getPropertyValue('--goblin-split-pane-before-open-size')).toBe('38cqw')
    expect(beforeContent()?.style.getPropertyValue('--goblin-split-pane-before-min-size')).toBe('14rem')
    expect(beforeContent()?.style.getPropertyValue('--goblin-split-pane-after-min-size')).toBe('22rem')
    expect(splitPane()?.style.getPropertyValue('--goblin-split-pane-collapse-duration')).toBe('240ms')
    expect(beforeContent()?.className).toContain('shrink-0')
    expect(beforeContent()?.className).not.toContain('flex-1')
    expect(resizeHandle()?.disabled).toBe(true)

    act(() => {
      resizableMocks.onLayoutChanged?.({ before: 0, after: 100 })
    })

    expect(onAfterSizeChange).not.toHaveBeenCalled()
  })

  test('uses measured before panel width when available', async () => {
    render(
      <SplitPane
        before={<div />}
        after={<div />}
        afterSize={62}
        beforeMinSize="14rem"
        beforeContentMinSize="14rem"
        afterMinSize="22rem"
      />,
    )

    emitElementResize(splitPane(), 800)
    emitElementResize(beforeClip(), 320)
    await flushEffects()

    expect(beforeContent()?.style.getPropertyValue('--goblin-split-pane-before-measured-size')).toBe('320px')
  })

  test('does not animate the initially collapsed pane', () => {
    render(
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

    expect(splitPane()?.dataset.collapseTransition).toBeUndefined()
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

      render(splitPaneElement(false))
      expect(splitPane()?.dataset.collapseTransition).toBeUndefined()

      render(splitPaneElement(true))
      await flushEffects()
      expect(splitPane()?.dataset.collapseTransition).toBe('true')

      act(() => {
        vi.advanceTimersByTime(120)
      })
      expect(splitPane()?.dataset.collapseTransition).toBe('true')

      render(splitPaneElement(false))
      await flushEffects()
      expect(splitPane()?.dataset.collapseTransition).toBe('true')
      expect(resizableMocks.setLayout).toHaveBeenLastCalledWith({ before: 38, after: 62 })

      act(() => {
        vi.advanceTimersByTime(239)
      })
      expect(splitPane()?.dataset.collapseTransition).toBe('true')

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(splitPane()?.dataset.collapseTransition).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})

function render(element: React.ReactNode) {
  act(() => {
    root!.render(element)
  })
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve()
  })
}

function splitPane(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('.goblin-split-pane') ?? null
}

function beforePanel(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('section[id="before"]') ?? null
}

function beforeClip(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('.goblin-split-pane__before-clip') ?? null
}

function beforeContent(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('.goblin-split-pane__before-content') ?? null
}

function resizeHandle(): HTMLButtonElement | null {
  return container?.querySelector<HTMLButtonElement>('[data-testid="resize-handle"]') ?? null
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
