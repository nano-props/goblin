// @vitest-environment jsdom

import { act, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  WorkspacePaneViewStrip,
  createPendingWorkspacePaneTabItem,
  createTerminalWorkspacePaneTabItem,
  isTerminalWorkspacePaneTabItem,
  type WorkspacePaneTabItem,
} from '#/web/components/workspace-pane/WorkspacePaneViewStrip.tsx'
import { terminalWorkspacePaneViewIdentity } from '#/web/components/workspace-pane/workspace-pane-view-model.ts'
import type { WorkspacePaneTabOrderEntry } from '#/shared/workspace-pane.ts'
import type { TerminalSlotSummary } from '#/web/components/terminal/types.ts'

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
        workspacePaneId="workspace"
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
        workspacePaneId="workspace"
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
        workspacePaneId="workspace"
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

    const tab = document.body.querySelector('#workspace-workspace-pane-view')
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
        workspacePaneId="workspace"
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
    const firstTab = document.body.querySelector('#workspace-workspace-pane-view')
    expect(firstTab?.getAttribute('aria-posinset')).toBe('1')
    expect(firstTab?.getAttribute('aria-setsize')).toBe('3')
  })

  test('uses the last tab separator for the new terminal boundary while hovering new terminal', () => {
    render(
      <TestWorkspacePaneViewStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
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

    expect(
      terminalTwo.querySelector(':scope > [data-slot="separator"][data-orientation="vertical"]'),
    ).not.toBeNull()

    act(() => {
      newButton.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    })

    expect(
      terminalTwo.querySelector(':scope > [data-slot="separator"][data-orientation="vertical"]'),
    ).not.toBeNull()
  })

  test('uses the full terminal title and unread state in the tab aria-label', () => {
    render(
      <TestWorkspacePaneViewStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
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

    const tab = document.body.querySelector('#workspace-workspace-pane-view')
    expect(tab?.getAttribute('aria-label')).toContain('~/repo/worktree — npm run dev')
    expect(tab?.getAttribute('aria-label')).toContain('terminal.bell-unread')
    expect(tab?.querySelector('.bg-notification')).not.toBeNull()
    expect(tab?.querySelector('.bg-attention')).toBeNull()
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
        workspacePaneId="workspace"
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

    const tab1 = document.body.querySelector('#workspace-workspace-pane-view')
    const tab2 = document.body.querySelector('#workspace-workspace-pane-view-1')
    const tab3 = document.body.querySelector('#workspace-workspace-pane-view-2')
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
        workspacePaneId="workspace"
        sessions={[
          session({ key: 't1', title: 'term-1', selected: true }),
          session({ key: 't2', title: 'term-2', selected: false, slotId: 'terminal-2', index: 2 }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const tab1 = document.body.querySelector('#workspace-workspace-pane-view')
    const tab2 = document.body.querySelector('#workspace-workspace-pane-view-1')
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
        workspacePaneId="workspace"
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
        workspacePaneId="workspace"
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
        workspacePaneId="workspace"
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
        workspacePaneId="workspace"
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
        workspacePaneId="workspace"
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
        workspacePaneId="workspace"
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
        workspacePaneId="workspace"
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
        workspacePaneId="workspace"
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
        workspacePaneId="workspace"
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
        workspacePaneId="workspace"
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
        workspacePaneId="workspace"
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
    const compactTablist = document.body.querySelector('[role="tablist"][aria-label="workspace-pane-views.tabs"]')
    const compactTab = document.body.querySelector('[data-workspace-pane-view-tooltip-id]')
    expect(compactTablist?.className).toContain('flex-1')
    expect(compactTablist?.parentElement?.className).toContain('flex-1')
    expect(compactTab?.className).toContain('min-w-0')
    expect(compactTab?.className).toContain('flex-1')
    expect(compactTab?.className).not.toContain('w-32')
    expect(compactTab?.className).not.toContain('w-36')
    // The compact tab treats itself as visually unselected, so the chrome
    // matches an idle tab on the expanded strip: muted foreground and a
    // right-edge separator between this tab and the popover button.
    expect(compactTab?.className).not.toContain('bg-selected')
    expect(compactTab?.querySelector(':scope > [data-slot="separator"][data-orientation="vertical"]')).not.toBeNull()
    // Close button stays in the DOM but is hidden until hover/focus,
    // matching the expanded strip's unselected-tab behaviour.
    const compactCloseButton = compactTab?.querySelector('button[aria-label="close term-1"]')
    expect(compactCloseButton?.className).toContain('opacity-0')
    expect(document.body.querySelector('button[aria-label="workspace-pane-views.tabs"]')).not.toBeNull()

    rerender(
      <TestWorkspacePaneViewStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
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

  test('keeps the compact tab visually unselected even when its panel is active', () => {
    render(
      <TestWorkspacePaneViewStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        responsiveCompact
        panelActive
        sessions={[session({ key: 't1', title: 'term-1' }), session({ key: 't2', title: 'term-2', selected: false })]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const compactTab = document.body.querySelector('[data-workspace-pane-view-tooltip-id]')
    // The active panel makes isActive=true, but the compact tab still mutes
    // the active chrome — so the close button stays hidden-until-hover, just
    // like an unselected tab on the expanded strip.
    expect(compactTab?.className).not.toContain('bg-selected')
    const compactCloseButton = compactTab?.querySelector('button[aria-label="close term-1"]')
    expect(compactCloseButton?.className).toContain('opacity-0')
  })

  test('focuses the next compact tab after closing the active tab', async () => {
    function CompactCloseFocusHarness() {
      const [sessions, setSessions] = useState([
        session({ key: 't1', title: 'term-1', selected: true }),
        session({ key: 't2', title: 'term-2', selected: false }),
      ])

      return (
        <TestWorkspacePaneViewStrip
          worktreeTerminalKey="/repo\0/repo/worktree"
          workspacePaneId="workspace"
          responsiveCompact
          panelActive
          sessions={sessions}
          onNew={() => {}}
          onSelect={() => {}}
          onScrollToBottom={() => {}}
          onClose={(closed) => {
            setSessions((current) =>
              current.filter((candidate) => candidate.key !== closed.key).map((candidate, index) => ({
                ...candidate,
                selected: index === 0,
              })),
            )
          }}
          onReorder={() => {}}
        />
      )
    }

    render(<CompactCloseFocusHarness />)
    const closeButton = document.body.querySelector<HTMLButtonElement>('button[aria-label="close term-1"]')
    expect(closeButton).not.toBeNull()

    act(() => {
      closeButton?.click()
    })
    await flushTimers()

    expect(document.activeElement?.id).toBe('workspace-workspace-pane-view')
    expect(document.activeElement?.textContent).toContain('term-2')
  })

  test('does not collapse to the first tab when compact mode has no active tab', () => {
    render(
      <TestWorkspacePaneViewStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        responsiveCompact
        panelActive
        sessions={[
          session({ key: 't1', title: 'term-1', selected: false }),
          session({ key: 't2', title: 'term-2', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const tabs = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    expect(tabs).toHaveLength(2)
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'false'])
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1])
    expect(document.body.querySelector('button[aria-label="workspace-pane-views.tabs"]')).toBeNull()

    act(() => {
      tabs[0]?.focus()
      tabs[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      vi.runAllTimers()
    })

    expect(document.activeElement).toBe(tabs[1])
  })

  test('renders a compact pending item across the available tab row', () => {
    render(
      <TestWorkspacePaneViewStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        responsiveCompact
        panelActive
        sessions={[session({ key: 't1', title: 'term-1', selected: false })]}
        pendingTerminal
        newTerminalBusy
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const pendingView = document.body.querySelector('[data-workspace-pane-pending-view="terminal"]')
    const tablist = document.body.querySelector('[role="tablist"][aria-label="workspace-pane-views.tabs"]')
    const tab = document.body.querySelector('[role="tab"][aria-label="terminal.opening"]')

    expect(pendingView).not.toBeNull()
    expect(pendingView?.className).toContain('min-w-0')
    expect(pendingView?.className).toContain('flex-1')
    expect(tablist?.className).toContain('flex-1')
    expect(tab?.getAttribute('aria-busy')).toBe('true')
    expect(document.body.querySelectorAll('[role="tab"]')).toHaveLength(1)
    expect(document.body.querySelector('button[aria-label="terminal.loading"]')).toBeNull()
    expect(document.body.querySelector('button[aria-label="workspace-pane-views.tabs"]')).not.toBeNull()
  })

  test('renders the same pending item as a busy tab in expanded mode', () => {
    render(
      <TestWorkspacePaneViewStrip
        worktreeTerminalKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        panelActive
        sessions={[session({ key: 't1', title: 'term-1', selected: false })]}
        pendingTerminal
        newTerminalBusy
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const pendingView = document.body.querySelector('[data-workspace-pane-pending-view="terminal"]')
    const tabs = Array.from(document.body.querySelectorAll('[role="tab"]'))

    expect(pendingView).not.toBeNull()
    expect(tabs).toHaveLength(2)
    expect(tabs.map((tab) => tab.getAttribute('aria-label'))).toEqual(['term-1', 'terminal.opening'])
    expect(document.body.querySelector('button[aria-label="terminal.loading"]')).not.toBeNull()
  })
})

function TestWorkspacePaneViewStrip(props: {
  worktreeTerminalKey: string
  sessions: TerminalSlotSummary[]
  workspacePaneId: string
  pendingTerminal?: boolean
  responsiveCompact?: boolean
  panelActive?: boolean
  newTerminalBusy?: boolean
  onNew: () => void
  onSelect: (worktreeTerminalKey: string, tab: TerminalSlotSummary) => void
  onScrollToBottom: (key: string) => void
  onClose: (tab: TerminalSlotSummary) => void
  onReorder: (orderedTabs: WorkspacePaneTabOrderEntry[]) => void
  onNavigateOut?: (direction: 'prev' | 'next' | 'first' | 'last') => void
}) {
  const selected = props.sessions.find((candidate) => candidate.selected) ?? null
  const { sessions, ...workspacePaneProps } = props
  const items: WorkspacePaneTabItem[] = sessions.map((tab) =>
    createTerminalWorkspacePaneTabItem({
      view: tab,
      label: tab.originalTitle ?? tab.fullTitle ?? tab.title,
      tooltip: tab.originalTitle ?? tab.fullTitle ?? tab.title,
      closeLabel: `close ${tab.title}`,
    }),
  )
  if (props.pendingTerminal) {
    items.push(
      createPendingWorkspacePaneTabItem({
        type: 'terminal',
        label: 'terminal.opening',
        tooltip: 'terminal.opening',
      }),
    )
  }
  return (
    <WorkspacePaneViewStrip
      {...workspacePaneProps}
      items={items}
      activeTabIdentity={selected ? terminalWorkspacePaneViewIdentity(selected.key) : null}
      onSelect={(item) => {
        if (isTerminalWorkspacePaneTabItem(item)) props.onSelect(props.worktreeTerminalKey, item.view)
      }}
      onClose={(item) => {
        if (isTerminalWorkspacePaneTabItem(item)) props.onClose(item.view)
      }}
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

function session(overrides: Partial<TerminalSlotSummary> = {}): TerminalSlotSummary {
  const key = overrides.key ?? 't1'
  const title = overrides.title ?? 'term-1'
  return {
    type: 'terminal',
    id: overrides.id ?? key,
    key,
    worktreeTerminalKey: overrides.worktreeTerminalKey ?? '/repo\0/repo/worktree',
    slotId: overrides.slotId ?? 'terminal-1',
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
