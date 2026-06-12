// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { TerminalSessionSummary } from '#/web/components/terminal/types.ts'

let container: HTMLDivElement | null = null
let root: Root | null = null
let keyboardSensorToken: object
let pointerSensorToken: object
let sortableOnKeyDown: ReturnType<typeof vi.fn>
let useSensorMock: ReturnType<typeof vi.fn>
let sortableDragging = false
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  vi.resetModules()
  keyboardSensorToken = {}
  pointerSensorToken = {}
  sortableOnKeyDown = vi.fn()
  sortableDragging = false
  useSensorMock = vi.fn((sensor, options) => ({ sensor, options }))

  vi.doMock('@dnd-kit/core', () => ({
    DndContext: ({ children }: { children: unknown }) => children,
    KeyboardSensor: keyboardSensorToken,
    PointerSensor: pointerSensorToken,
    closestCenter: vi.fn(),
    useSensor: useSensorMock,
    useSensors: (...sensors: unknown[]) => sensors,
  }))
  vi.doMock('@dnd-kit/sortable', () => ({
    SortableContext: ({ children }: { children: unknown }) => children,
    horizontalListSortingStrategy: {},
    sortableKeyboardCoordinates: vi.fn(),
    useSortable: () => ({
      attributes: {},
      listeners: { onKeyDown: sortableOnKeyDown },
      setNodeRef: vi.fn(),
      setActivatorNodeRef: vi.fn(),
      transform: null,
      transition: undefined,
      isDragging: sortableDragging,
    }),
  }))
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  vi.doUnmock('@dnd-kit/core')
  vi.doUnmock('@dnd-kit/sortable')
})

describe('TerminalTabs keyboard dnd wiring', () => {
  test('keeps selected styling while the active tab is dragging', async () => {
    sortableDragging = true
    const { TerminalTabs } = await import('#/web/components/terminal/TerminalTabs.tsx')

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => {
      root!.render(
        <TerminalTabs
          worktreeTerminalKey="/repo\0/repo/worktree"
          detailId="detail"
          panelActive
          sessions={[session({ key: 't1', selected: true })]}
          onNew={() => {}}
          onSelect={() => {}}
          onScrollToBottom={() => {}}
          onClose={() => {}}
          onReorder={() => {}}
        />,
      )
    })

    const tabChrome = document.body.querySelector('[data-terminal-tab-tooltip-id="t1"]')
    if (!(tabChrome instanceof HTMLDivElement)) throw new Error('missing terminal tab')
    expect(tabChrome.className).toContain('bg-selected')
    expect(tabChrome.className).toContain('cursor-grabbing')
    expect(tabChrome.className).not.toContain('bg-card')
  })

  test('registers a KeyboardSensor and preserves sortable onKeyDown listeners', async () => {
    const { TerminalTabs } = await import('#/web/components/terminal/TerminalTabs.tsx')

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => {
      root!.render(
        <TerminalTabs
          worktreeTerminalKey="/repo\0/repo/worktree"
          detailId="detail"
          sessions={[
            session({ key: 't1', selected: true }),
            session({ key: 't2', selected: false, terminalId: 'terminal-2', index: 2 }),
          ]}
          onNew={() => {}}
          onSelect={() => {}}
          onScrollToBottom={() => {}}
          onClose={() => {}}
          onReorder={() => {}}
        />,
      )
    })

    expect(useSensorMock).toHaveBeenCalledWith(pointerSensorToken, { activationConstraint: { distance: 6 } })
    expect(useSensorMock).toHaveBeenCalledWith(
      keyboardSensorToken,
      expect.objectContaining({ coordinateGetter: expect.any(Function) }),
    )

    const tab = document.body.querySelector('#detail-terminal-tab')
    if (!(tab instanceof HTMLButtonElement)) throw new Error('missing terminal tab')

    act(() => {
      tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }))
    })

    expect(sortableOnKeyDown).toHaveBeenCalledTimes(1)
  })
})

function session(overrides: Partial<TerminalSessionSummary> = {}): TerminalSessionSummary {
  return {
    key: 't1',
    worktreeTerminalKey: '/repo\0/repo/worktree',
    terminalId: 'terminal-1',
    index: 1,
    title: 'term-1',
    fullTitle: 'term-1',
    originalTitle: 'term-1',
    phase: 'open',
    selected: true,
    hasBell: false,
    ...overrides,
  }
}
