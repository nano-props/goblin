// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { terminalWorkspacePaneViewIdentity } from '#/web/components/workspace-pane/workspace-pane-view-model.ts'
import type { WorkspacePaneViewOrderEntry } from '#/shared/workspace-pane.ts'
import type {
  WorkspacePaneViewSummary,
  TerminalSessionSummary,
} from '#/web/components/terminal/types.ts'

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
    const { WorkspacePaneViewStrip } = await import('#/web/components/workspace-pane/WorkspacePaneViewStrip.tsx')
    const TestWorkspacePaneViewStrip = makeWorkspacePaneViewStrip(WorkspacePaneViewStrip)

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => {
      root!.render(
        <TestWorkspacePaneViewStrip
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

    const tabChrome = document.body.querySelector('[data-workspace-pane-view-tooltip-id="terminal:t1"]')
    if (!(tabChrome instanceof HTMLDivElement)) throw new Error('missing terminal view')
    expect(tabChrome.className).toContain('bg-selected')
    expect(tabChrome.className).toContain('cursor-grabbing')
    expect(tabChrome.className).not.toContain('bg-card')
  })

  test('registers a KeyboardSensor and preserves sortable onKeyDown listeners', async () => {
    const { WorkspacePaneViewStrip } = await import('#/web/components/workspace-pane/WorkspacePaneViewStrip.tsx')
    const TestWorkspacePaneViewStrip = makeWorkspacePaneViewStrip(WorkspacePaneViewStrip)

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => {
      root!.render(
        <TestWorkspacePaneViewStrip
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

    const tab = document.body.querySelector('#detail-workspace-pane-view')
    if (!(tab instanceof HTMLButtonElement)) throw new Error('missing terminal view')

    act(() => {
      tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }))
    })

    expect(sortableOnKeyDown).toHaveBeenCalledTimes(1)
  })
})

function makeWorkspacePaneViewStrip(
  WorkspacePaneViewStrip: typeof import('#/web/components/workspace-pane/WorkspacePaneViewStrip.tsx').WorkspacePaneViewStrip,
) {
  return function TestWorkspacePaneViewStrip(props: {
    worktreeTerminalKey: string
    sessions: TerminalSessionSummary[]
    detailId: string
    panelActive?: boolean
    onNew: () => void
    onSelect: (worktreeTerminalKey: string, tab: WorkspacePaneViewSummary) => void
    onScrollToBottom: (key: string) => void
    onClose: (tab: WorkspacePaneViewSummary) => void
    onReorder: (worktreeTerminalKey: string, orderedViews: WorkspacePaneViewOrderEntry[]) => void
  }) {
    const selected = props.sessions.find((candidate) => candidate.selected) ?? props.sessions[0]
    const { sessions, ...detailPaneProps } = props
    return (
      <WorkspacePaneViewStrip
        {...detailPaneProps}
        views={sessions}
        activeTabIdentity={selected ? terminalWorkspacePaneViewIdentity(selected.key) : null}
        getTooltip={(tab) => ('originalTitle' in tab ? (tab.originalTitle ?? tab.fullTitle ?? tab.title) : tab.id)}
        getLabel={(tab) => ('originalTitle' in tab ? (tab.originalTitle ?? tab.fullTitle ?? tab.title) : tab.id)}
        getCloseLabel={(tab) => `close ${'title' in tab ? tab.title : tab.id}`}
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
