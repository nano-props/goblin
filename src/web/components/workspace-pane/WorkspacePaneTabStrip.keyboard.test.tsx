// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { terminalWorkspacePaneTabProvider } from '#/web/components/workspace-pane/tab-providers.ts'
import {
  createRuntimeWorkspacePaneTabItem,
  isRuntimeWorkspacePaneTabItem,
} from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
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
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        panelActive
        sessions={[session({ terminalSessionId: 't1', selected: true })]}
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
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 't1', selected: true }),
          session({ terminalSessionId: 'session-2', selected: false, index: 2 }),
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
    terminalWorktreeKey: string
    sessions: TerminalSessionSummary[]
    workspacePaneId: string
    panelActive?: boolean
    onNew: () => void
    onSelect: (terminalWorktreeKey: string, tab: TerminalSessionSummary) => void
    onScrollToBottom: (key: string) => void
    onClose: (tab: TerminalSessionSummary) => void
    onReorder: (tabs: WorkspacePaneTabEntry[]) => void
  }) {
    const selected = props.sessions.find((candidate) => candidate.selected) ?? null
    const { sessions, terminalWorktreeKey, onNew, onScrollToBottom, ...workspacePaneProps } = props
    const items = sessions.map((tab) =>
      createRuntimeWorkspacePaneTabItem({
        view: tab,
        label: tab.originalTitle ?? tab.fullTitle ?? tab.title,
        tooltip: tab.originalTitle ?? tab.fullTitle ?? tab.title,
        closeLabel: `close ${tab.title}`,
      }),
    )
    return (
      <WorkspacePaneTabStrip
        {...workspacePaneProps}
        createAction={{ label: 'terminal.new', onCreate: onNew }}
        workspacePaneTabTargetKey="/repo\0branch\0main"
        items={items}
        activeTabIdentity={selected ? terminalWorkspacePaneTabProvider.identity(selected.terminalSessionId) : null}
        onSelect={(item) => {
          if (isRuntimeWorkspacePaneTabItem(item) && item.view.type === 'terminal') {
            props.onSelect(terminalWorktreeKey, item.view)
          }
        }}
        onReselect={(item) => {
          if (isRuntimeWorkspacePaneTabItem(item) && item.view.type === 'terminal') {
            onScrollToBottom(item.view.terminalSessionId)
          }
        }}
        onClose={(item) => {
          if (isRuntimeWorkspacePaneTabItem(item) && item.view.type === 'terminal') {
            props.onClose(item.view)
          }
        }}
      />
    )
  }
}

function session(overrides: Partial<TerminalSessionSummary> = {}): TerminalSessionSummary {
  const terminalSessionId = overrides.terminalSessionId ?? 't1'
  const title = overrides.title ?? 'term-1'
  return {
    type: 'terminal',
    terminalSessionId,
    terminalWorktreeKey: overrides.terminalWorktreeKey ?? '/repo\0/repo/worktree',
    index: overrides.index ?? 1,
    title,
    fullTitle: overrides.fullTitle ?? title,
    originalTitle: overrides.originalTitle ?? title,
    phase: overrides.phase ?? 'open',
    selected: overrides.selected ?? true,
    hasBell: overrides.hasBell ?? false,
    hasRecentOutput: overrides.hasRecentOutput ?? false,
  }
}
