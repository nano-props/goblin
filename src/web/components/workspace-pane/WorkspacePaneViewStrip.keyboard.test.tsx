// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { terminalWorkspacePaneViewIdentity } from '#/web/components/workspace-pane/workspace-pane-view-model.ts'
import type { WorkspacePaneWorktreeViewOrderEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneViewSummary, TerminalSessionSummary } from '#/web/components/terminal/types.ts'

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

describe('WorkspacePaneViewStrip keyboard dnd wiring', () => {
  test('keeps selected styling while the active tab is dragging', async () => {
    sortableDragging = true
    const workspacePaneViewStripModule = await import('#/web/components/workspace-pane/WorkspacePaneViewStrip.tsx')
    const TestWorkspacePaneViewStrip = makeWorkspacePaneViewStrip(workspacePaneViewStripModule)

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => {
      root!.render(
        <TestWorkspacePaneViewStrip
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
    })

    const tabChrome = document.body.querySelector('[data-workspace-pane-view-tooltip-id="terminal:t1"]')
    if (!(tabChrome instanceof HTMLDivElement)) throw new Error('missing terminal view')
    expect(tabChrome.className).toContain('bg-selected')
    expect(tabChrome.className).toContain('cursor-grabbing')
    expect(tabChrome.className).not.toContain('bg-card')
  })

  test('registers a KeyboardSensor and preserves sortable onKeyDown listeners', async () => {
    const workspacePaneViewStripModule = await import('#/web/components/workspace-pane/WorkspacePaneViewStrip.tsx')
    const TestWorkspacePaneViewStrip = makeWorkspacePaneViewStrip(workspacePaneViewStripModule)

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => {
      root!.render(
        <TestWorkspacePaneViewStrip
          worktreeTerminalKey="/repo\0/repo/worktree"
          workspacePaneId="workspace"
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

    const tab = document.body.querySelector('#workspace-workspace-pane-view')
    if (!(tab instanceof HTMLButtonElement)) throw new Error('missing terminal view')

    act(() => {
      tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }))
    })

    expect(sortableOnKeyDown).toHaveBeenCalledTimes(1)
  })
})

function makeWorkspacePaneViewStrip(
  workspacePaneViewStripModule: typeof import('#/web/components/workspace-pane/WorkspacePaneViewStrip.tsx'),
) {
  const { WorkspacePaneViewStrip, createWorktreeWorkspacePaneTabItem, isWorktreeWorkspacePaneTabItem } =
    workspacePaneViewStripModule
  return function TestWorkspacePaneViewStrip(props: {
    worktreeTerminalKey: string
    sessions: TerminalSessionSummary[]
    workspacePaneId: string
    panelActive?: boolean
    onNew: () => void
    onSelect: (worktreeTerminalKey: string, tab: WorkspacePaneViewSummary) => void
    onScrollToBottom: (key: string) => void
    onClose: (tab: WorkspacePaneViewSummary) => void
    onReorder: (worktreeTerminalKey: string, orderedViews: WorkspacePaneWorktreeViewOrderEntry[]) => void
  }) {
    const selected = props.sessions.find((candidate) => candidate.selected) ?? null
    const { sessions, ...workspacePaneProps } = props
    const items = sessions.map((tab) =>
      createWorktreeWorkspacePaneTabItem({
        view: tab,
        label: tab.originalTitle ?? tab.fullTitle ?? tab.title,
        tooltip: tab.originalTitle ?? tab.fullTitle ?? tab.title,
        closeLabel: `close ${tab.title}`,
      }),
    )
    return (
      <WorkspacePaneViewStrip
        {...workspacePaneProps}
        items={items}
        activeTabIdentity={selected ? terminalWorkspacePaneViewIdentity(selected.key) : null}
        onSelect={(item) => {
          if (isWorktreeWorkspacePaneTabItem(item)) props.onSelect(props.worktreeTerminalKey, item.view)
        }}
        onClose={(item) => {
          if (isWorktreeWorkspacePaneTabItem(item)) props.onClose(item.view)
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
    terminalId: overrides.terminalId ?? 'terminal-1',
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
