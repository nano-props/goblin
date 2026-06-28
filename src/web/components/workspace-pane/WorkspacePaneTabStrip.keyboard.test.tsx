// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { terminalWorkspacePaneTabProvider } from '#/web/components/workspace-pane/tab-providers.ts'
import {
  createTerminalWorkspacePaneTabItem,
  isTerminalWorkspacePaneTabItem,
} from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import type { WorkspacePaneTabOrderEntry } from '#/shared/workspace-pane.ts'
import type { TerminalSessionSummary } from '#/web/components/terminal/types.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'

let keyboardSensorToken: object
let pointerSensorToken: object
let sortableOnKeyDown: ReturnType<typeof vi.fn>
let sortableOnPointerDown: ReturnType<typeof vi.fn>
let useSensorMock: ReturnType<typeof vi.fn>
let sortableDragging = false

beforeEach(() => {
  vi.resetModules()
  keyboardSensorToken = {}
  pointerSensorToken = {}
  sortableOnKeyDown = vi.fn()
  sortableOnPointerDown = vi.fn()
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
      listeners: { onKeyDown: sortableOnKeyDown, onPointerDown: sortableOnPointerDown },
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
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
  vi.doUnmock('@dnd-kit/core')
  vi.doUnmock('@dnd-kit/sortable')
})

describe('WorkspacePaneTabStrip keyboard dnd wiring', () => {
  test('keeps selected styling while the active tab is dragging', async () => {
    sortableDragging = true
    const workspacePaneTabStripModule = await import('#/web/components/workspace-pane/WorkspacePaneTabStrip.tsx')
    const TestWorkspacePaneTabStrip = makeWorkspacePaneTabStrip(workspacePaneTabStripModule)

    renderInJsdom(
      <TestWorkspacePaneTabStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        panelActive
        sessions={[session({ key: 't1', selected: true })]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const tabChrome = document.body.querySelector('[data-workspace-pane-tab-tooltip-id="terminal:t1"]')
    if (!(tabChrome instanceof HTMLDivElement)) throw new Error('missing terminal tab')
    expect(tabChrome.className).toContain('bg-selected')
    expect(tabChrome.className).toContain('cursor-grabbing')
    expect(tabChrome.className).not.toContain('bg-card')
  })

  test('registers a KeyboardSensor and preserves sortable onKeyDown listeners', async () => {
    const workspacePaneTabStripModule = await import('#/web/components/workspace-pane/WorkspacePaneTabStrip.tsx')
    const TestWorkspacePaneTabStrip = makeWorkspacePaneTabStrip(workspacePaneTabStripModule)

    renderInJsdom(
      <TestWorkspacePaneTabStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ key: 't1', selected: true }),
          session({ key: 't2', selected: false, sessionId: 'session-2', index: 2 }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    expect(useSensorMock).toHaveBeenCalledWith(pointerSensorToken, { activationConstraint: { distance: 6 } })
    expect(useSensorMock).toHaveBeenCalledWith(
      keyboardSensorToken,
      expect.objectContaining({ coordinateGetter: expect.any(Function) }),
    )

    const tab = document.body.querySelector('#workspace-workspace-pane-tab')
    if (!(tab instanceof HTMLButtonElement)) throw new Error('missing terminal tab')
    const tabChrome = document.body.querySelector('[data-workspace-pane-tab-tooltip-id="terminal:t1"]')
    if (!(tabChrome instanceof HTMLDivElement)) throw new Error('missing terminal chrome')

    expect(tabChrome.dataset.titleBarChromeRegion).toBe('interactive')

    act(() => {
      tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }))
    })

    expect(sortableOnKeyDown).toHaveBeenCalledTimes(1)

    act(() => {
      tabChrome.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })

    expect(sortableOnPointerDown).toHaveBeenCalledTimes(1)

    const closeButton = tabChrome.querySelector('button[aria-label="close term-1"]')
    if (!(closeButton instanceof HTMLButtonElement)) throw new Error('missing close button')

    act(() => {
      closeButton.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })

    expect(sortableOnPointerDown).toHaveBeenCalledTimes(1)
  })
})

function makeWorkspacePaneTabStrip(
  workspacePaneTabStripModule: typeof import('#/web/components/workspace-pane/WorkspacePaneTabStrip.tsx'),
) {
  const { WorkspacePaneTabStrip } = workspacePaneTabStripModule
  return function TestWorkspacePaneTabStrip(props: {
    worktreeTerminalKey: string
    sessions: TerminalSessionSummary[]
    workspacePaneId: string
    panelActive?: boolean
    onNew: () => void
    onSelect: (worktreeTerminalKey: string, tab: TerminalSessionSummary) => void
    onScrollToBottom: (key: string) => void
    onClose: (tab: TerminalSessionSummary) => void
    onReorder: (orderedTabs: WorkspacePaneTabOrderEntry[]) => void
  }) {
    const selected = props.sessions.find((candidate) => candidate.selected) ?? null
    const { sessions, ...workspacePaneProps } = props
    const items = sessions.map((tab) =>
      createTerminalWorkspacePaneTabItem({
        view: tab,
        label: tab.originalTitle ?? tab.fullTitle ?? tab.title,
        tooltip: tab.originalTitle ?? tab.fullTitle ?? tab.title,
        closeLabel: `close ${tab.title}`,
      }),
    )
    return (
      <WorkspacePaneTabStrip
        {...workspacePaneProps}
        items={items}
        activeTabIdentity={selected ? terminalWorkspacePaneTabProvider.identity(selected.key) : null}
        onSelect={(item) => {
          if (isTerminalWorkspacePaneTabItem(item)) props.onSelect(props.worktreeTerminalKey, item.view)
        }}
        onClose={(item) => {
          if (isTerminalWorkspacePaneTabItem(item)) props.onClose(item.view)
        }}
      />
    )
  }
}

function session(overrides: Partial<TerminalSessionSummary> = {}): TerminalSessionSummary {
  const key = overrides.key ?? 't1'
  const title = overrides.title ?? 'term-1'
  return {
    type: 'terminal',
    id: overrides.id ?? key,
    key,
    worktreeTerminalKey: overrides.worktreeTerminalKey ?? '/repo\0/repo/worktree',
    sessionId: overrides.sessionId ?? 'session-1',
    index: overrides.index ?? 1,
    displayOrder: overrides.displayOrder ?? 1,
    title,
    fullTitle: overrides.fullTitle ?? title,
    originalTitle: overrides.originalTitle ?? title,
    phase: overrides.phase ?? 'open',
    selected: overrides.selected ?? true,
    hasBell: overrides.hasBell ?? false,
  }
}
