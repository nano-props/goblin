// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { terminalWorkspacePaneTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import {
  createRuntimeWorkspacePaneTabItem,
  isRuntimeWorkspacePaneTabItem,
} from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { TerminalSessionSummary } from '#/web/components/terminal/types.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { WorkspacePaneTabStrip } from '#/web/components/workspace-pane/WorkspacePaneTabStrip.tsx'
import { WorkspacePaneTabStripScrollMemoryProvider } from '#/web/components/workspace-pane/workspace-pane-tab-strip-scroll-memory.tsx'

const dndMocks = vi.hoisted(() => ({
  keyboardSensorToken: {},
  pointerSensorToken: {},
  sortableOnKeyDown: vi.fn(),
  sortableOnPointerDown: vi.fn(),
  useSensor: vi.fn((sensor, options) => ({ sensor, options })),
  sortableDragging: false,
}))

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: unknown }) => children,
  KeyboardSensor: dndMocks.keyboardSensorToken,
  PointerSensor: dndMocks.pointerSensorToken,
  closestCenter: vi.fn(),
  useSensor: (sensor: unknown, options: unknown) => dndMocks.useSensor(sensor, options),
  useSensors: (...sensors: unknown[]) => sensors,
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: unknown }) => children,
  horizontalListSortingStrategy: {},
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {
      onKeyDown: dndMocks.sortableOnKeyDown,
      onPointerDown: dndMocks.sortableOnPointerDown,
    },
    setNodeRef: vi.fn(),
    setActivatorNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: dndMocks.sortableDragging,
  }),
}))

beforeEach(() => {
  dndMocks.sortableOnKeyDown.mockReset()
  dndMocks.sortableOnPointerDown.mockReset()
  dndMocks.useSensor.mockReset()
  dndMocks.useSensor.mockImplementation((sensor, options) => ({ sensor, options }))
  dndMocks.sortableDragging = false
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
})

afterEach(() => {
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

describe('WorkspacePaneTabStrip keyboard dnd wiring', () => {
  test('keeps selected styling while the active tab is dragging', async () => {
    dndMocks.sortableDragging = true
    const TestWorkspacePaneTabStrip = makeWorkspacePaneTabStrip()

    renderInJsdom(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        panelActive
        sessions={[session({ terminalSessionId: 'term-111111111111111111111', selected: true })]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
      { wrapper: WorkspacePaneTabStripScrollMemoryProvider },
    )

    const tabChrome = document.body.querySelector(
      '[data-workspace-pane-tab-tooltip-id="terminal:term-111111111111111111111"]',
    )
    if (!(tabChrome instanceof HTMLDivElement)) throw new Error('missing terminal tab')
    expect(tabChrome.className).toContain('bg-selected')
    expect(tabChrome.className).toContain('cursor-grabbing')
    expect(tabChrome.className).not.toContain('bg-card')
  })

  test('registers a KeyboardSensor and preserves sortable onKeyDown listeners', async () => {
    const user = userEvent.setup()
    const TestWorkspacePaneTabStrip = makeWorkspacePaneTabStrip()

    renderInJsdom(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 'term-111111111111111111111', selected: true }),
          session({ terminalSessionId: 'term-222222222222222222222', selected: false, index: 2 }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
      { wrapper: WorkspacePaneTabStripScrollMemoryProvider },
    )

    expect(dndMocks.useSensor).toHaveBeenCalledWith(dndMocks.pointerSensorToken, {
      activationConstraint: { distance: 6 },
    })
    expect(dndMocks.useSensor).toHaveBeenCalledWith(
      dndMocks.keyboardSensorToken,
      expect.objectContaining({ coordinateGetter: expect.any(Function) }),
    )

    const tab = document.body.querySelector('#workspace-workspace-pane-tab')
    if (!(tab instanceof HTMLButtonElement)) throw new Error('missing terminal tab')
    const tabChrome = document.body.querySelector(
      '[data-workspace-pane-tab-tooltip-id="terminal:term-111111111111111111111"]',
    )
    if (!(tabChrome instanceof HTMLDivElement)) throw new Error('missing terminal chrome')

    expect(tabChrome.dataset.titleBarChromeRegion).toBe('interactive')

    tab.focus()
    await user.keyboard('{ArrowRight}')

    expect(dndMocks.sortableOnKeyDown).toHaveBeenCalledTimes(1)

    act(() => {
      tabChrome.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })

    expect(dndMocks.sortableOnPointerDown).toHaveBeenCalledTimes(1)

    const closeButton = tabChrome.querySelector('button[aria-label="close term-1"]')
    if (!(closeButton instanceof HTMLButtonElement)) throw new Error('missing close button')

    act(() => {
      closeButton.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })

    expect(dndMocks.sortableOnPointerDown).toHaveBeenCalledTimes(1)
  })
})

function makeWorkspacePaneTabStrip() {
  return function TestWorkspacePaneTabStrip(props: {
    terminalFilesystemTargetKey: string
    sessions: TerminalSessionSummary[]
    workspacePaneId: string
    panelActive?: boolean
    onNew: () => void
    onSelect: (terminalFilesystemTargetKey: string, tab: TerminalSessionSummary) => void
    onScrollToBottom: (key: string) => void
    onClose: (tab: TerminalSessionSummary) => void
    onReorder: (tabs: WorkspacePaneTabEntry[]) => void
  }) {
    const selected = props.sessions.find((candidate) => candidate.selected) ?? null
    const { sessions, terminalFilesystemTargetKey, onNew, onScrollToBottom, ...workspacePaneProps } = props
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
            props.onSelect(terminalFilesystemTargetKey, item.view)
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
  const terminalSessionId = overrides.terminalSessionId ?? 'term-111111111111111111111'
  const title = overrides.title ?? 'term-1'
  return {
    type: 'terminal',
    terminalSessionId,
    terminalFilesystemTargetKey: overrides.terminalFilesystemTargetKey ?? '/repo\0/repo/worktree',
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
