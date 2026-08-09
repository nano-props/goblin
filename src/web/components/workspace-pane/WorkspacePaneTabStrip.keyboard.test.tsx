// @vitest-environment jsdom

import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { FunctionalComponent } from 'vue'
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
  useSortable: vi.fn(),
  sortableDragging: false,
}))

vi.mock('@dnd-kit/vue/sortable', () => ({
  isSortable: () => false,
  useSortable: (input: unknown) => {
    dndMocks.useSortable(input)
    return {
      isDragging: {
        get value() {
          return dndMocks.sortableDragging
        },
      },
    }
  },
}))

beforeEach(() => {
  dndMocks.useSortable.mockReset()
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

  test('registers sortable elements and preserves tab keyboard navigation', async () => {
    const user = userEvent.setup()
    const TestWorkspacePaneTabStrip = makeWorkspacePaneTabStrip()

    const rendered = renderInJsdom(
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

    const tab = document.body.querySelector('#workspace-workspace-pane-tab')
    if (!(tab instanceof HTMLButtonElement)) throw new Error('missing terminal tab')
    const tabChrome = document.body.querySelector(
      '[data-workspace-pane-tab-tooltip-id="terminal:term-111111111111111111111"]',
    )
    if (!(tabChrome instanceof HTMLDivElement)) throw new Error('missing terminal chrome')

    expect(tabChrome.dataset.titleBarChromeRegion).toBe('interactive')
    expect(dndMocks.useSortable).toHaveBeenCalledTimes(2)
    const sortableInput = dndMocks.useSortable.mock.calls[0]?.[0] as {
      id: () => string
      group: string
      element: { value: HTMLElement | null }
      handle: { value: HTMLElement | null }
    }
    expect(sortableInput.id()).toBe('terminal:term-111111111111111111111')
    expect(sortableInput.group).toBe('workspace-pane-tabs')
    expect(sortableInput.element.value).toBe(tabChrome.parentElement)
    expect(sortableInput.handle.value).toBe(tab)

    tab.focus()
    await user.keyboard('{ArrowRight}')
    await rendered.flushAnimationFrames()

    expect(document.activeElement?.id).toBe('workspace-workspace-pane-tab-1')
  })

  test('closes the focused closable tab with Delete', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
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
        onClose={onClose}
        onReorder={() => {}}
      />,
      { wrapper: WorkspacePaneTabStripScrollMemoryProvider },
    )

    const tab = document.body.querySelector('#workspace-workspace-pane-tab')
    if (!(tab instanceof HTMLButtonElement)) throw new Error('missing terminal tab')

    expect(tab.getAttribute('aria-keyshortcuts')).toBe('Delete')
    tab.focus()
    await user.keyboard('{Delete}')

    expect(onClose).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledWith(expect.objectContaining({ terminalSessionId: 'term-111111111111111111111' }))
  })
})

interface TestWorkspacePaneTabStripProps {
  terminalFilesystemTargetKey: string
  sessions: TerminalSessionSummary[]
  workspacePaneId: string
  panelActive?: boolean
  onNew: () => void
  onSelect: (terminalFilesystemTargetKey: string, tab: TerminalSessionSummary) => void
  onScrollToBottom: (key: string) => void
  onClose: (tab: TerminalSessionSummary) => void
  onReorder: (tabs: WorkspacePaneTabEntry[]) => void
}

function makeWorkspacePaneTabStrip(): FunctionalComponent<TestWorkspacePaneTabStripProps> {
  const TestWorkspacePaneTabStrip: FunctionalComponent<TestWorkspacePaneTabStripProps> = (props) => {
    const selected = props.sessions.find((candidate) => candidate.selected) ?? null
    const { sessions, terminalFilesystemTargetKey, onNew, onSelect, onScrollToBottom, onClose, ...workspacePaneProps } =
      props
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
            onSelect(terminalFilesystemTargetKey, item.view)
          }
        }}
        onReselect={(item) => {
          if (isRuntimeWorkspacePaneTabItem(item) && item.view.type === 'terminal') {
            onScrollToBottom(item.view.terminalSessionId)
          }
        }}
        onClose={(item) => {
          if (isRuntimeWorkspacePaneTabItem(item) && item.view.type === 'terminal') {
            onClose(item.view)
          }
        }}
      />
    )
  }
  TestWorkspacePaneTabStrip.props = [
    'terminalFilesystemTargetKey',
    'sessions',
    'workspacePaneId',
    'panelActive',
    'onNew',
    'onSelect',
    'onScrollToBottom',
    'onClose',
    'onReorder',
  ]
  return TestWorkspacePaneTabStrip
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
