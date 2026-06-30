// @vitest-environment jsdom

import { useState } from 'react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { WorkspacePaneTabStrip } from '#/web/components/workspace-pane/WorkspacePaneTabStrip.tsx'
import {
  createPendingWorkspacePaneTabItem,
  createTerminalWorkspacePaneTabItem,
  isTerminalWorkspacePaneTabItem,
  type WorkspacePaneTabItem,
} from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import { terminalWorkspacePaneTabProvider } from '#/web/components/workspace-pane/tab-providers.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { TerminalSessionSummary } from '#/web/components/terminal/types.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'

const reactActEnvironment = globalThis as typeof globalThis & {
  goblinNative?: unknown
  __GOBLIN_BOOTSTRAP__?: unknown
}

beforeEach(() => {
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
  delete reactActEnvironment.goblinNative
  delete reactActEnvironment.__GOBLIN_BOOTSTRAP__
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView
  vi.useRealTimers()
  // Reset our module-level render handle so the next test that only
  // calls `rerender(...)` (e.g. "restores the full tab strip after
  // leaving compact mode") falls through to `render(...)` instead of
  // trying to rerender a root that `cleanup()` already unmounted.
  lastRender = null
})

describe('WorkspacePaneTabStrip', () => {
  test('shows terminal tooltip content with only the original title', async () => {
    render(
      <TestWorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        panelActive
        sessions={[
          session({
            terminalSessionId: 't1',
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

    const tab = document.body.querySelector('[data-workspace-pane-tab-tooltip-id="terminal:t1"]')
    if (!(tab instanceof HTMLElement)) throw new Error('missing terminal tab')
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
      <TestWorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        responsiveCompact
        sessions={[
          session({ terminalSessionId: 't1', selected: false, title: 'term-1' }),
          session({ terminalSessionId: 't2', selected: true, title: 'term-2' }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const trigger = document.body.querySelector('button[aria-label="workspace-pane-tabs.tabs"]')
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

  test('collapsed terminal tab only navigates out on arrow keys', () => {
    const onNavigateOut = vi.fn()
    render(
      <TestWorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        responsiveCompact
        sessions={[
          session({ terminalSessionId: 't1', selected: false, title: 'term-1' }),
          session({ terminalSessionId: 't2', selected: true, title: 'term-2' }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
        onNavigateOut={onNavigateOut}
      />,
    )

    const tab = document.body.querySelector('#workspace-workspace-pane-tab')
    if (!(tab instanceof HTMLButtonElement)) throw new Error('missing collapsed terminal tab')

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

  test('keeps all terminal tabs visible in a horizontal scroll area when not in compact mode', () => {
    render(
      <TestWorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 't1', title: 'term-1' }),
          session({ terminalSessionId: 't2', title: 'term-2', selected: false }),
          session({ terminalSessionId: 't3', title: 'term-3', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const tablist = document.body.querySelector('[role="tablist"][aria-label="workspace-pane-tabs.tabs"]')
    expect(tablist).not.toBeNull()
    expect(tablist?.getAttribute('aria-orientation')).toBe('horizontal')
    expect(document.body.querySelector('button[aria-label="workspace-pane-tabs.tabs"]')).toBeNull()
    expect(tablist?.className).toContain('h-full')
    expect(tablist?.parentElement?.className).toContain('w-max')
    expect(
      [...document.body.querySelectorAll('[data-workspace-pane-tab-tooltip-id]')].every(
        (tab) =>
          tab.className.includes('w-36') && !tab.className.includes('min-w-') && !tab.className.includes('max-w-'),
      ),
    ).toBe(true)
    expect(document.body.querySelectorAll('[role="tab"]').length).toBe(3)
    const inactiveCloseButton = document.body.querySelector<HTMLButtonElement>('button[aria-label="close term-2"]')
    expect(inactiveCloseButton?.className).toContain('shrink-0')
    expect(inactiveCloseButton?.className).toContain('before:-inset-x-1.5')
    expect(inactiveCloseButton?.className).toContain('before:-inset-y-1')
    expect(inactiveCloseButton?.className).toContain('pointer-events-none')
    expect(inactiveCloseButton?.className).toContain('group-hover:pointer-events-auto')
    const firstTab = document.body.querySelector('#workspace-workspace-pane-tab')
    expect(firstTab?.getAttribute('aria-posinset')).toBe('1')
    expect(firstTab?.getAttribute('aria-setsize')).toBe('3')
  })

  test('uses the last tab separator for the new terminal boundary while hovering new terminal', () => {
    render(
      <TestWorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        panelActive
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

    const terminalTwo = document.body.querySelector('[data-workspace-pane-tab-tooltip-id="terminal:session-2"]')
    const newButton = document.body.querySelector('button[aria-label="terminal.new"]')
    if (!(terminalTwo instanceof HTMLElement)) throw new Error('missing terminal tab')
    if (!(newButton instanceof HTMLButtonElement)) throw new Error('missing new terminal button')

    expect(terminalTwo.querySelector(':scope > [data-slot="separator"][data-orientation="vertical"]')).not.toBeNull()

    act(() => {
      newButton.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    })

    expect(terminalTwo.querySelector(':scope > [data-slot="separator"][data-orientation="vertical"]')).not.toBeNull()
  })

  test('uses the full terminal title and unread state in the tab aria-label', () => {
    render(
      <TestWorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        panelActive
        sessions={[
          session({
            terminalSessionId: 't1',
            selected: true,
            hasBell: true,
            recentlyActive: false,
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

    const tab = document.body.querySelector('#workspace-workspace-pane-tab')
    expect(tab?.getAttribute('aria-label')).toContain('~/repo/worktree — npm run dev')
    expect(tab?.getAttribute('aria-label')).toContain('terminal.bell-unread')
    expect(tab?.querySelector('.bg-notification')).not.toBeNull()
    expect(tab?.querySelector('.bg-attention')).toBeNull()
  })

  test('moves focus across the full terminal tab strip and only navigates out at arrow-key edges', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
    const onNavigateOut = vi.fn()

    render(
      <TestWorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 't1', title: 'term-1' }),
          session({ terminalSessionId: 't2', title: 'term-2', selected: false }),
          session({ terminalSessionId: 't3', title: 'term-3', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
        onNavigateOut={onNavigateOut}
      />,
    )

    const tab1 = document.body.querySelector('#workspace-workspace-pane-tab')
    const tab2 = document.body.querySelector('#workspace-workspace-pane-tab-1')
    const tab3 = document.body.querySelector('#workspace-workspace-pane-tab-2')
    if (
      !(tab1 instanceof HTMLButtonElement) ||
      !(tab2 instanceof HTMLButtonElement) ||
      !(tab3 instanceof HTMLButtonElement)
    ) {
      throw new Error('missing terminal tabs')
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

  test('keeps the selected terminal tab semantically selected even when the panel is inactive', () => {
    render(
      <TestWorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 't1', title: 'term-1', selected: true }),
          session({ terminalSessionId: 'session-2', title: 'term-2', selected: false, index: 2 }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const tab1 = document.body.querySelector('#workspace-workspace-pane-tab')
    const tab2 = document.body.querySelector('#workspace-workspace-pane-tab-1')
    if (!(tab1 instanceof HTMLButtonElement) || !(tab2 instanceof HTMLButtonElement)) {
      throw new Error('missing terminal tabs')
    }

    expect(tab1.getAttribute('aria-selected')).toBe('true')
    expect(tab1.tabIndex).toBe(0)
    expect(tab2.getAttribute('aria-selected')).toBe('false')
    expect(tab2.tabIndex).toBe(-1)
  })

  test('scrolls the tab strip to the far right when a new terminal session is added', () => {
    render(
      <TestWorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 't1', title: 'term-1' }),
          session({ terminalSessionId: 't2', title: 'term-2', selected: false }),
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

    rerender(
      <TestWorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 't1', title: 'term-1' }),
          session({ terminalSessionId: 't2', title: 'term-2', selected: false }),
          session({ terminalSessionId: 't3', title: 'term-3', selected: false }),
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
      <TestWorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 't1', title: 'term-1' }),
          session({ terminalSessionId: 't2', title: 'term-2', selected: false }),
          session({ terminalSessionId: 't3', title: 'term-3', selected: false }),
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
      <TestWorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 't1', title: 'term-1' }),
          session({ terminalSessionId: 't2', title: 'term-2', selected: false }),
          session({ terminalSessionId: 't3', title: 'term-3', selected: false }),
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

  test('does not scroll when the tab strip does not overflow horizontally', () => {
    render(
      <TestWorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 't1', title: 'term-1' }),
          session({ terminalSessionId: 't2', title: 'term-2', selected: false }),
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

    // Content fits within the viewport (no horizontal overflow).
    Object.defineProperty(viewport, 'scrollWidth', { value: 400, writable: true, configurable: true })
    Object.defineProperty(viewport, 'clientWidth', { value: 600, writable: true, configurable: true })
    Object.defineProperty(viewport, 'scrollLeft', { value: 0, writable: true, configurable: true })

    rerender(
      <TestWorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 't1', title: 'term-1' }),
          session({ terminalSessionId: 't2', title: 'term-2', selected: false }),
          session({ terminalSessionId: 't3', title: 'term-3', selected: false }),
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
      <TestWorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 't1', title: 'term-1' }),
          session({ terminalSessionId: 't2', title: 'term-2', selected: false }),
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
    Object.defineProperty(viewport, 'clientWidth', { value: 600, writable: true, configurable: true })
    Object.defineProperty(viewport, 'scrollLeft', { value: 0, writable: true, configurable: true })

    rerender(
      <TestWorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 't1', title: 'term-1' }),
          session({ terminalSessionId: 't2', title: 'term-2', selected: false }),
          session({ terminalSessionId: 't3', title: 'term-3', selected: false }),
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

  test('keeps the auto-scroll cleanup frame alive across same-length rerenders', () => {
    const scheduledFrame: { id: number; callback: FrameRequestCallback; canceled: boolean } = {
      id: 0,
      callback: () => {},
      canceled: false,
    }
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      scheduledFrame.id = 1
      scheduledFrame.callback = callback
      scheduledFrame.canceled = false
      return 1
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
      if (scheduledFrame.id === id) scheduledFrame.canceled = true
    })

    render(
      <TestWorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 't1', title: 'term-1' }),
          session({ terminalSessionId: 't2', title: 'term-2', selected: false }),
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
    Object.defineProperty(viewport, 'clientWidth', { value: 600, writable: true, configurable: true })
    Object.defineProperty(viewport, 'scrollLeft', { value: 0, writable: true, configurable: true })

    rerender(
      <TestWorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 't1', title: 'term-1' }),
          session({ terminalSessionId: 't2', title: 'term-2', selected: false }),
          session({ terminalSessionId: 't3', title: 'term-3', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    expect(viewport.style.scrollBehavior).toBe('smooth')
    expect(scheduledFrame.canceled).toBe(false)

    rerender(
      <TestWorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 't1', title: 'term-1' }),
          session({ terminalSessionId: 't2', title: 'term-2', selected: false }),
          session({ terminalSessionId: 't3', title: 'term-3 updated', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    expect(scheduledFrame.canceled).toBe(false)
    act(() => {
      scheduledFrame.callback(0)
    })
    expect(viewport.style.scrollBehavior).toBe('')
    expect(viewport.scrollLeft).toBe(1000)
  })

  test('does not scroll when a terminal session is removed', () => {
    render(
      <TestWorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 't1', title: 'term-1' }),
          session({ terminalSessionId: 't2', title: 'term-2', selected: false }),
          session({ terminalSessionId: 't3', title: 'term-3', selected: false }),
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
      <TestWorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 't1', title: 'term-1' }),
          session({ terminalSessionId: 't2', title: 'term-2', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    expect(viewport.scrollLeft).toBe(500)
  })

  test('restores the full tab strip after leaving compact mode', () => {
    rerender(
      <TestWorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        responsiveCompact
        sessions={[
          session({ terminalSessionId: 't1', title: 'term-1' }),
          session({ terminalSessionId: 't2', title: 'term-2', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    expect(document.body.querySelectorAll('[role="tab"]').length).toBe(1)
    const compactTablist = document.body.querySelector('[role="tablist"][aria-label="workspace-pane-tabs.tabs"]')
    const compactTab = document.body.querySelector('[data-workspace-pane-tab-tooltip-id]')
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
    expect(document.body.querySelector('button[aria-label="workspace-pane-tabs.tabs"]')).not.toBeNull()

    rerender(
      <TestWorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 't1', title: 'term-1' }),
          session({ terminalSessionId: 't2', title: 'term-2', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    expect(document.body.querySelectorAll('[role="tab"]').length).toBe(2)
    expect(document.body.querySelector('button[aria-label="workspace-pane-tabs.tabs"]')).toBeNull()
  })

  test('keeps the compact tab visually unselected even when its panel is active', () => {
    render(
      <TestWorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        responsiveCompact
        panelActive
        sessions={[
          session({ terminalSessionId: 't1', title: 'term-1' }),
          session({ terminalSessionId: 't2', title: 'term-2', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const compactTab = document.body.querySelector('[data-workspace-pane-tab-tooltip-id]')
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
        session({ terminalSessionId: 't1', title: 'term-1', selected: true }),
        session({ terminalSessionId: 't2', title: 'term-2', selected: false }),
      ])

      return (
        <TestWorkspacePaneTabStrip
          terminalWorktreeKey="/repo\0/repo/worktree"
          workspacePaneId="workspace"
          responsiveCompact
          panelActive
          sessions={sessions}
          onNew={() => {}}
          onSelect={() => {}}
          onScrollToBottom={() => {}}
          onClose={(closed) => {
            setSessions((current) =>
              current
                .filter((candidate) => candidate.terminalSessionId !== closed.terminalSessionId)
                .map((candidate, index) => ({
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

    expect(document.activeElement?.id).toBe('workspace-workspace-pane-tab')
    expect(document.activeElement?.textContent).toContain('term-2')
  })

  test('compact mode renders an empty tab area but keeps the popover switcher reachable when no tab is active', () => {
    render(
      <TestWorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        responsiveCompact
        panelActive
        sessions={[
          session({ terminalSessionId: 't1', title: 'term-1', selected: false }),
          session({ terminalSessionId: 't2', title: 'term-2', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    // In compact mode, when no tab is active and there is no pending tab
    // to anchor the selection, the strip renders an empty tab area + the
    // popover switcher (chevron). The compact layout is a structural
    // choice driven by screen size — it must not fall through to the
    // scrollable (expanded) layout, which would render fixed-width
    // `w-36` tabs. No fallback invents a "selected" tab out of
    // items[0]: the toolbar must not lie about the user's active view
    // when the body is rendering a non-materialized terminal panel.
    const tabs = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    const tablist = document.body.querySelector('[role="tablist"][aria-label="workspace-pane-tabs.tabs"]')
    const switcherTrigger = document.body.querySelector('button[aria-label="workspace-pane-tabs.tabs"]')

    expect(tabs).toHaveLength(0)
    expect(tablist).not.toBeNull()
    expect(tablist?.className).toContain('flex-1')
    expect(switcherTrigger).not.toBeNull()
  })

  test('renders a compact pending item across the available tab row', () => {
    render(
      <TestWorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        responsiveCompact
        panelActive
        sessions={[session({ terminalSessionId: 't1', title: 'term-1', selected: false })]}
        pendingTerminal
        newTerminalBusy
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const pendingView = document.body.querySelector('[data-workspace-pane-pending-tab="terminal"]')
    const tablist = document.body.querySelector('[role="tablist"][aria-label="workspace-pane-tabs.tabs"]')
    const tab = document.body.querySelector('[role="tab"][aria-label="terminal.opening"]')

    expect(pendingView).not.toBeNull()
    expect(pendingView?.className).toContain('min-w-0')
    expect(pendingView?.className).toContain('flex-1')
    expect(tablist?.className).toContain('flex-1')
    expect(tab?.getAttribute('aria-busy')).toBeNull()
    expect(pendingView?.textContent).not.toContain('terminal.opening')
    expect(document.body.querySelectorAll('[role="tab"]')).toHaveLength(1)
    expect(document.body.querySelector('button[aria-label="terminal.loading"]')).toBeNull()
    expect(document.body.querySelector('button[aria-label="workspace-pane-tabs.tabs"]')).not.toBeNull()
  })

  test('renders the same pending item as a busy tab in expanded mode', () => {
    render(
      <TestWorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        panelActive
        sessions={[session({ terminalSessionId: 't1', title: 'term-1', selected: false })]}
        pendingTerminal
        newTerminalBusy
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const pendingView = document.body.querySelector('[data-workspace-pane-pending-tab="terminal"]')
    const tabs = Array.from(document.body.querySelectorAll('[role="tab"]'))

    expect(pendingView).not.toBeNull()
    expect(tabs).toHaveLength(2)
    expect(tabs.map((tab) => tab.getAttribute('aria-label'))).toEqual(['term-1', 'terminal.opening'])
    expect(pendingView?.textContent).not.toContain('terminal.opening')
    const disabledNewButton = document.body.querySelector<HTMLButtonElement>('[data-workspace-pane-new-button]')
    expect(disabledNewButton).not.toBeNull()
    expect(disabledNewButton?.getAttribute('aria-label')).toBe('terminal.new')
    expect(disabledNewButton?.disabled).toBe(true)
    expect(disabledNewButton?.querySelector('.animate-spin')).toBeNull()
  })

  test('keeps placeholder terminal titles out of materialized tab text', () => {
    const placeholderView: TerminalSessionSummary = {
      ...session({ terminalSessionId: 't1', title: 'terminal', selected: true }),
      fullTitle: 'terminal',
      originalTitle: null,
    }
    const item = createTerminalWorkspacePaneTabItem({
      view: placeholderView,
      label: '',
      tooltip: 'terminal.opening',
      closeLabel: 'terminal.close-named',
    })

    render(
      <WorkspacePaneTabStrip
        terminalWorktreeKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        panelActive
        items={[item]}
        activeTabIdentity={terminalWorkspacePaneTabProvider.identity(placeholderView.terminalSessionId)}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const tab = document.body.querySelector('[role="tab"][aria-label="terminal.opening"]')
    const terminalView = document.body.querySelector('[data-workspace-pane-tab-tooltip-id="terminal:t1"]')

    expect(tab).not.toBeNull()
    expect(terminalView?.textContent).not.toContain('terminal')
    expect(terminalView?.textContent).not.toContain('terminal.opening')
  })
})

function TestWorkspacePaneTabStrip(props: {
  terminalWorktreeKey: string
  sessions: TerminalSessionSummary[]
  workspacePaneId: string
  pendingTerminal?: boolean
  responsiveCompact?: boolean
  panelActive?: boolean
  newTerminalBusy?: boolean
  onNew: () => void
  onSelect: (terminalWorktreeKey: string, tab: TerminalSessionSummary) => void
  onScrollToBottom: (key: string) => void
  onClose: (tab: TerminalSessionSummary) => void
  onReorder: (tabs: WorkspacePaneTabEntry[]) => void
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
    <WorkspacePaneTabStrip
      {...workspacePaneProps}
      items={items}
      activeTabIdentity={selected ? terminalWorkspacePaneTabProvider.identity(selected.terminalSessionId) : null}
      onSelect={(item) => {
        if (isTerminalWorkspacePaneTabItem(item)) props.onSelect(props.terminalWorktreeKey, item.view)
      }}
      onClose={(item) => {
        if (isTerminalWorkspacePaneTabItem(item)) props.onClose(item.view)
      }}
    />
  )
}

let lastRender: RenderResult | null = null

function render(element: ReactNode): RenderResult {
  lastRender = renderInJsdom(element)
  return lastRender
}

function rerender(element: ReactNode): RenderResult {
  if (!lastRender) return render(element)
  lastRender.rerender(element)
  return lastRender
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
    recentlyActive: overrides.recentlyActive ?? false,
  }
}

async function flushTimers() {
  await act(async () => {
    vi.runAllTimers()
    await Promise.resolve()
  })
}
