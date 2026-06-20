// @vitest-environment jsdom

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  WorkspacePaneViewStrip,
  createWorktreeWorkspacePaneTabItem,
  isWorktreeWorkspacePaneTabItem,
} from '#/web/components/workspace-pane/WorkspacePaneViewStrip.tsx'
import { terminalWorkspacePaneViewIdentity } from '#/web/components/workspace-pane/workspace-pane-view-model.ts'
import type { WorkspacePaneViewOrderEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneViewSummary, TerminalSessionSummary } from '#/web/components/terminal/types.ts'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
  goblinNative?: unknown
  __GOBLIN_BOOTSTRAP__?: unknown
}

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
  reactActEnvironment.__GOBLIN_BOOTSTRAP__ = {
    runtime: { kind: 'electron', bridgeVersion: 1, capabilities: [] },
    initialServer: null,
  }
  reactActEnvironment.goblinNative = {
    pathForFile: () => '',
    invokeIpc: async () => null,
    abortIpc: async () => true,
    onEvent: () => () => {},
  }
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ''
  delete reactActEnvironment.goblinNative
  delete reactActEnvironment.__GOBLIN_BOOTSTRAP__
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView
  vi.useRealTimers()
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('WorkspacePaneViewStrip', () => {
  test('shows terminal tooltip content with only the original title', async () => {
    render(
      <TestWorkspacePaneViewStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        detailId="detail"
        panelActive
        sessions={[
          session({
            key: 't1',
            selected: true,
            originalTitle: '~/repo/worktree — npm run dev',
          }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const tab = document.body.querySelector('[data-workspace-pane-view-tooltip-id="terminal:t1"]')
    if (!(tab instanceof HTMLElement)) throw new Error('missing terminal view')
    tab.getBoundingClientRect = () =>
      ({
        left: 12,
        top: 8,
        width: 120,
        height: 28,
        right: 132,
        bottom: 36,
        x: 12,
        y: 8,
        toJSON: () => ({}),
      }) as DOMRect

    act(() => {
      tab.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    })
    await flushTimers()

    const tooltip = document.body.querySelector('[role="tooltip"]')
    expect(tooltip?.textContent).toContain('~/repo/worktree — npm run dev')
    expect(tooltip?.textContent).not.toContain('node')
    expect(tooltip?.textContent).not.toContain('~/Developer/goblin')
  })

  test('keeps the selected terminal in the collapsed popover list and still offers new terminal', async () => {
    render(
      <TestWorkspacePaneViewStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        detailId="detail"
        responsiveCompact
        sessions={[
          session({ key: 't1', selected: false, title: 'term-1' }),
          session({ key: 't2', selected: true, title: 'term-2' }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const trigger = document.body.querySelector('button[aria-label="workspace-pane-views.tabs"]')
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('missing terminal popover trigger')

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
      await Promise.resolve()
    })

    const selectedItem = [...document.body.querySelectorAll('button[aria-current="true"]')].find((item) =>
      item.textContent?.includes('term-2'),
    )
    expect(selectedItem).not.toBeNull()
    expect(selectedItem?.className).toContain('bg-selected')
    expect(document.body.textContent).toContain('terminal.new')
    const list = document.body.querySelector('[role="list"]')
    const closeButton = list?.querySelector('button[aria-label="close term-2"]')
    expect(closeButton).not.toBeNull()
    expect(closeButton?.className).not.toContain('opacity-0')
    expect(closeButton?.className).not.toContain('group-hover:opacity-100')
  })

  test('collapsed terminal view only navigates out on arrow keys', () => {
    const onNavigateOut = vi.fn()
    render(
      <TestWorkspacePaneViewStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        detailId="detail"
        responsiveCompact
        sessions={[
          session({ key: 't1', selected: false, title: 'term-1' }),
          session({ key: 't2', selected: true, title: 'term-2' }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
        onNavigateOut={onNavigateOut}
      />,
    )

    const tab = document.body.querySelector('#detail-workspace-pane-view')
    if (!(tab instanceof HTMLButtonElement)) throw new Error('missing collapsed terminal view')

    act(() => {
      tab.focus()
      tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
      tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
      tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    })

    expect(onNavigateOut.mock.calls).toEqual([['prev'], ['next']])
    expect(document.activeElement).toBe(tab)
    expect(tab.getAttribute('aria-posinset')).toBeNull()
    expect(tab.getAttribute('aria-setsize')).toBeNull()
  })

  test('keeps all terminal views visible in a horizontal scroll area when not in compact mode', () => {
    render(
      <TestWorkspacePaneViewStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        detailId="detail"
        sessions={[
          session({ key: 't1', title: 'term-1' }),
          session({ key: 't2', title: 'term-2', selected: false }),
          session({ key: 't3', title: 'term-3', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const tablist = document.body.querySelector('[role="tablist"][aria-label="workspace-pane-views.tabs"]')
    expect(tablist).not.toBeNull()
    expect(tablist?.getAttribute('aria-orientation')).toBe('horizontal')
    expect(document.body.querySelector('button[aria-label="workspace-pane-views.tabs"]')).toBeNull()
    expect(tablist?.className).toContain('h-full')
    expect(tablist?.parentElement?.className).toContain('w-max')
    expect(
      [...document.body.querySelectorAll('[data-workspace-pane-view-tooltip-id]')].every(
        (tab) =>
          tab.className.includes('w-36') && !tab.className.includes('min-w-') && !tab.className.includes('max-w-'),
      ),
    ).toBe(true)
    expect(document.body.querySelectorAll('[role="tab"]').length).toBe(3)
    const firstTab = document.body.querySelector('#detail-workspace-pane-view')
    expect(firstTab?.getAttribute('aria-posinset')).toBe('1')
    expect(firstTab?.getAttribute('aria-setsize')).toBe('3')
  })

  test('uses the last tab separator for the new terminal boundary while hovering new terminal', () => {
    render(
      <TestWorkspacePaneViewStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        detailId="detail"
        panelActive
        sessions={[session({ key: 't1', selected: true }), session({ key: 't2', selected: false })]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const terminalTwo = document.body.querySelector('[data-workspace-pane-view-tooltip-id="terminal:t2"]')
    const newButton = document.body.querySelector('button[aria-label="terminal.new"]')
    if (!(terminalTwo instanceof HTMLElement)) throw new Error('missing terminal view')
    if (!(newButton instanceof HTMLButtonElement)) throw new Error('missing new terminal button')

    expect(terminalTwo.querySelector(':scope > .pointer-events-none.border-r.border-separator')).not.toBeNull()

    act(() => {
      newButton.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    })

    expect(terminalTwo.querySelector(':scope > .pointer-events-none.border-r.border-separator')).not.toBeNull()
  })

  test('uses the full terminal title and unread state in the tab aria-label', () => {
    render(
      <TestWorkspacePaneViewStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        detailId="detail"
        panelActive
        sessions={[
          session({
            key: 't1',
            selected: true,
            hasBell: true,
            originalTitle: '~/repo/worktree — npm run dev',
          }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const tab = document.body.querySelector('#detail-workspace-pane-view')
    expect(tab?.getAttribute('aria-label')).toContain('~/repo/worktree — npm run dev')
    expect(tab?.getAttribute('aria-label')).toContain('terminal.bell-unread')
  })

  test('moves focus across the full terminal view strip and only navigates out at arrow-key edges', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
    const onNavigateOut = vi.fn()

    render(
      <TestWorkspacePaneViewStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        detailId="detail"
        sessions={[
          session({ key: 't1', title: 'term-1' }),
          session({ key: 't2', title: 'term-2', selected: false }),
          session({ key: 't3', title: 'term-3', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
        onNavigateOut={onNavigateOut}
      />,
    )

    const tab1 = document.body.querySelector('#detail-workspace-pane-view')
    const tab2 = document.body.querySelector('#detail-workspace-pane-view-1')
    const tab3 = document.body.querySelector('#detail-workspace-pane-view-2')
    if (
      !(tab1 instanceof HTMLButtonElement) ||
      !(tab2 instanceof HTMLButtonElement) ||
      !(tab3 instanceof HTMLButtonElement)
    ) {
      throw new Error('missing terminal views')
    }

    act(() => {
      tab1.focus()
      tab1.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(document.activeElement).toBe(tab2)
    expect(onNavigateOut).not.toHaveBeenCalled()

    act(() => {
      tab3.focus()
      tab3.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(onNavigateOut).toHaveBeenNthCalledWith(1, 'next')

    act(() => {
      tab2.focus()
      tab2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    })
    expect(document.activeElement).toBe(tab1)

    act(() => {
      tab2.focus()
      tab2.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    })
    expect(document.activeElement).toBe(tab3)
  })

  test('keeps the selected terminal view semantically selected even when the panel is inactive', () => {
    render(
      <TestWorkspacePaneViewStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        detailId="detail"
        sessions={[
          session({ key: 't1', title: 'term-1', selected: true }),
          session({ key: 't2', title: 'term-2', selected: false, terminalId: 'terminal-2', index: 2 }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const tab1 = document.body.querySelector('#detail-workspace-pane-view')
    const tab2 = document.body.querySelector('#detail-workspace-pane-view-1')
    if (!(tab1 instanceof HTMLButtonElement) || !(tab2 instanceof HTMLButtonElement)) {
      throw new Error('missing terminal views')
    }

    expect(tab1.getAttribute('aria-selected')).toBe('true')
    expect(tab1.tabIndex).toBe(0)
    expect(tab2.getAttribute('aria-selected')).toBe('false')
    expect(tab2.tabIndex).toBe(-1)
  })

  test('scrolls the view strip to the far right when a new terminal session is added', () => {
    render(
      <TestWorkspacePaneViewStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        detailId="detail"
        sessions={[session({ key: 't1', title: 'term-1' }), session({ key: 't2', title: 'term-2', selected: false })]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const viewport = document.body.querySelector('[data-radix-scroll-area-viewport]')
    if (!(viewport instanceof HTMLDivElement)) throw new Error('missing scroll viewport')

    Object.defineProperty(viewport, 'scrollWidth', { value: 1000, writable: true, configurable: true })
    Object.defineProperty(viewport, 'scrollLeft', { value: 0, writable: true, configurable: true })

    rerender(
      <TestWorkspacePaneViewStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        detailId="detail"
        sessions={[
          session({ key: 't1', title: 'term-1' }),
          session({ key: 't2', title: 'term-2', selected: false }),
          session({ key: 't3', title: 'term-3', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    expect(viewport.scrollLeft).toBe(1000)
  })

  test('does not scroll on initial mount', () => {
    render(
      <TestWorkspacePaneViewStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        detailId="detail"
        sessions={[
          session({ key: 't1', title: 'term-1' }),
          session({ key: 't2', title: 'term-2', selected: false }),
          session({ key: 't3', title: 'term-3', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const viewport = document.body.querySelector('[data-radix-scroll-area-viewport]')
    if (!(viewport instanceof HTMLDivElement)) throw new Error('missing scroll viewport')

    Object.defineProperty(viewport, 'scrollWidth', { value: 1000, writable: true, configurable: true })
    Object.defineProperty(viewport, 'scrollLeft', { value: 0, writable: true, configurable: true })

    // Trigger a re-render with the same sessions to confirm the effect does not scroll.
    rerender(
      <TestWorkspacePaneViewStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        detailId="detail"
        sessions={[
          session({ key: 't1', title: 'term-1' }),
          session({ key: 't2', title: 'term-2', selected: false }),
          session({ key: 't3', title: 'term-3', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    expect(viewport.scrollLeft).toBe(0)
  })

  test('does not scroll when the view strip does not overflow horizontally', () => {
    render(
      <TestWorkspacePaneViewStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        detailId="detail"
        sessions={[session({ key: 't1', title: 'term-1' }), session({ key: 't2', title: 'term-2', selected: false })]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const viewport = document.body.querySelector('[data-radix-scroll-area-viewport]')
    if (!(viewport instanceof HTMLDivElement)) throw new Error('missing scroll viewport')

    // Content fits within the viewport (no horizontal overflow).
    Object.defineProperty(viewport, 'scrollWidth', { value: 400, writable: true, configurable: true })
    Object.defineProperty(viewport, 'clientWidth', { value: 600, writable: true, configurable: true })
    Object.defineProperty(viewport, 'scrollLeft', { value: 0, writable: true, configurable: true })

    rerender(
      <TestWorkspacePaneViewStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        detailId="detail"
        sessions={[
          session({ key: 't1', title: 'term-1' }),
          session({ key: 't2', title: 'term-2', selected: false }),
          session({ key: 't3', title: 'term-3', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    expect(viewport.scrollLeft).toBe(0)
  })

  test('resets the inline scroll-behavior after a new session scroll settles', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })

    render(
      <TestWorkspacePaneViewStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        detailId="detail"
        sessions={[session({ key: 't1', title: 'term-1' }), session({ key: 't2', title: 'term-2', selected: false })]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const viewport = document.body.querySelector('[data-radix-scroll-area-viewport]')
    if (!(viewport instanceof HTMLDivElement)) throw new Error('missing scroll viewport')

    Object.defineProperty(viewport, 'scrollWidth', { value: 1000, writable: true, configurable: true })
    Object.defineProperty(viewport, 'clientWidth', { value: 600, writable: true, configurable: true })
    Object.defineProperty(viewport, 'scrollLeft', { value: 0, writable: true, configurable: true })

    rerender(
      <TestWorkspacePaneViewStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        detailId="detail"
        sessions={[
          session({ key: 't1', title: 'term-1' }),
          session({ key: 't2', title: 'term-2', selected: false }),
          session({ key: 't3', title: 'term-3', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    // After the rAF callback runs, the inline scroll-behavior should be cleared so that
    // subsequent user-driven scrolls (e.g. dragging the scrollbar) are not animated.
    expect(viewport.style.scrollBehavior).toBe('')
    expect(viewport.scrollLeft).toBe(1000)
  })

  test('does not scroll when a terminal session is removed', () => {
    render(
      <TestWorkspacePaneViewStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        detailId="detail"
        sessions={[
          session({ key: 't1', title: 'term-1' }),
          session({ key: 't2', title: 'term-2', selected: false }),
          session({ key: 't3', title: 'term-3', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const viewport = document.body.querySelector('[data-radix-scroll-area-viewport]')
    if (!(viewport instanceof HTMLDivElement)) throw new Error('missing scroll viewport')

    Object.defineProperty(viewport, 'scrollWidth', { value: 1000, writable: true, configurable: true })
    Object.defineProperty(viewport, 'scrollLeft', { value: 500, writable: true, configurable: true })

    rerender(
      <TestWorkspacePaneViewStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        detailId="detail"
        sessions={[session({ key: 't1', title: 'term-1' }), session({ key: 't2', title: 'term-2', selected: false })]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    expect(viewport.scrollLeft).toBe(500)
  })

  test('restores the full view strip after leaving compact mode', () => {
    rerender(
      <TestWorkspacePaneViewStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        detailId="detail"
        responsiveCompact
        sessions={[session({ key: 't1', title: 'term-1' }), session({ key: 't2', title: 'term-2', selected: false })]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    expect(document.body.querySelectorAll('[role="tab"]').length).toBe(1)
    // Compact mode pins the tab one step tighter than the default fixed width
    // to fit narrow toolbars alongside the popover trigger.
    expect(document.body.querySelector('[data-workspace-pane-view-tooltip-id]')?.className).toContain('w-32')
    expect(document.body.querySelector('[data-workspace-pane-view-tooltip-id]')?.className).not.toContain('w-36')

    rerender(
      <TestWorkspacePaneViewStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        detailId="detail"
        sessions={[session({ key: 't1', title: 'term-1' }), session({ key: 't2', title: 'term-2', selected: false })]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    expect(document.body.querySelectorAll('[role="tab"]').length).toBe(2)
    expect(document.body.querySelector('button[aria-label="workspace-pane-views.tabs"]')).toBeNull()
  })
})

function TestWorkspacePaneViewStrip(props: {
  worktreeTerminalKey: string
  sessions: TerminalSessionSummary[]
  detailId: string
  responsiveCompact?: boolean
  panelActive?: boolean
  isLoading?: boolean
  onNew: () => void
  onSelect: (worktreeTerminalKey: string, tab: WorkspacePaneViewSummary) => void
  onScrollToBottom: (key: string) => void
  onClose: (tab: WorkspacePaneViewSummary) => void
  onReorder: (worktreeTerminalKey: string, orderedViews: WorkspacePaneViewOrderEntry[]) => void
  onNavigateOut?: (direction: 'prev' | 'next' | 'first' | 'last') => void
}) {
  const selected = props.sessions.find((candidate) => candidate.selected) ?? props.sessions[0]
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
      onClose={(item) => props.onClose(item.view)}
    />
  )
}

function render(element: ReactNode) {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => {
    root!.render(element)
  })
}

function rerender(element: ReactNode) {
  if (!container || !root) {
    render(element)
    return
  }
  act(() => {
    root!.render(element)
  })
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

async function flushTimers() {
  await act(async () => {
    vi.runAllTimers()
    await Promise.resolve()
  })
}
