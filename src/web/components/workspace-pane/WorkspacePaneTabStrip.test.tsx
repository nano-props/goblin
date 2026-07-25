// @vitest-environment jsdom

import { useState } from 'react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { WorkspacePaneTabStrip } from '#/web/components/workspace-pane/WorkspacePaneTabStrip.tsx'
import {
  createPendingWorkspacePaneTabItem,
  createRuntimeWorkspacePaneTabItem,
  isRuntimeWorkspacePaneTabItem,
  type WorkspacePaneTabItem,
} from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import { terminalWorkspacePaneTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import type { TerminalSessionSummary } from '#/web/components/terminal/types.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'

const reactActEnvironment = globalThis as typeof globalThis & {
  goblinNative?: unknown
  __GOBLIN_BOOTSTRAP__?: unknown
}
const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
let tabStripViewportRect: DOMRect | null = null
const tabStripTabRects = new Map<string, DOMRect>()
let tabStripNewButtonRect: DOMRect | null = null

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    writable: true,
    value(this: HTMLElement) {
      if (this.matches('[data-radix-scroll-area-viewport]') && tabStripViewportRect) return tabStripViewportRect
      if (this.matches('[data-workspace-pane-new-button]') && tabStripNewButtonRect) return tabStripNewButtonRect
      if (this.matches('[data-workspace-pane-tab-scroll-target]')) {
        const tabButton = this.querySelector<HTMLButtonElement>('[role="tab"][id]')
        const rect = tabButton?.id ? tabStripTabRects.get(tabButton.id) : null
        if (rect) return rect
      }
      const rect = this.id ? tabStripTabRects.get(this.id) : null
      return rect ?? originalGetBoundingClientRect.call(this)
    },
  })
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
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    writable: true,
    value: originalGetBoundingClientRect,
  })
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView
  tabStripViewportRect = null
  tabStripTabRects.clear()
  tabStripNewButtonRect = null
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
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        panelActive
        sessions={[
          session({
            terminalSessionId: 'term-111111111111111111111',
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

    const tab = document.body.querySelector(
      '[data-workspace-pane-tab-tooltip-id="terminal:term-111111111111111111111"]',
    )
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
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        responsiveCompact
        sessions={[
          session({ terminalSessionId: 'term-111111111111111111111', selected: false, title: 'term-1' }),
          session({ terminalSessionId: 'term-222222222222222222222', selected: true, title: 'term-2' }),
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

  test('disables the collapsed new-terminal action while terminal creation is busy', async () => {
    const onNew = vi.fn()
    render(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        responsiveCompact
        newTerminalBusy
        sessions={[session({ terminalSessionId: 'term-111111111111111111111', selected: true, title: 'term-1' })]}
        onNew={onNew}
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

    const newTerminalAction = [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent === 'terminal.new',
    )
    expect(newTerminalAction).not.toBeNull()

    act(() => {
      newTerminalAction?.click()
    })

    expect(onNew).not.toHaveBeenCalled()
  })

  test('does not let compact popover focus restoration steal an immediate terminal focus handoff', async () => {
    const terminalInput = appendTerminalFocusTarget()
    render(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        responsiveCompact
        sessions={[session({ terminalSessionId: 'term-111111111111111111111', selected: true, title: 'term-1' })]}
        onNew={() => terminalInput.focus()}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const trigger = document.body.querySelector<HTMLButtonElement>('button[aria-label="workspace-pane-tabs.tabs"]')
    if (!trigger) throw new Error('missing terminal popover trigger')
    await openCompactSwitcher(trigger)
    const newTerminalAction = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'terminal.new',
    )
    if (!newTerminalAction) throw new Error('missing new terminal action')

    act(() => newTerminalAction.click())
    expect(document.activeElement).toBe(terminalInput)
    await flushTimers()

    expect(document.activeElement).toBe(terminalInput)
  })

  test('allows a terminal mounted after compact popover close to receive focus', async () => {
    const terminalInput = appendTerminalFocusTarget()
    render(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        responsiveCompact
        sessions={[session({ terminalSessionId: 'term-111111111111111111111', selected: true, title: 'term-1' })]}
        onNew={() => setTimeout(() => terminalInput.focus(), 0)}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const trigger = document.body.querySelector<HTMLButtonElement>('button[aria-label="workspace-pane-tabs.tabs"]')
    if (!trigger) throw new Error('missing terminal popover trigger')
    await openCompactSwitcher(trigger)
    const newTerminalAction = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'terminal.new',
    )
    if (!newTerminalAction) throw new Error('missing new terminal action')

    act(() => newTerminalAction.click())
    await flushTimers()

    expect(document.activeElement).toBe(terminalInput)
  })

  test('restores compact popover trigger focus after a normal dismiss', async () => {
    render(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        responsiveCompact
        sessions={[session({ terminalSessionId: 'term-111111111111111111111', selected: true, title: 'term-1' })]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const trigger = document.body.querySelector<HTMLButtonElement>('button[aria-label="workspace-pane-tabs.tabs"]')
    if (!trigger) throw new Error('missing terminal popover trigger')
    await openCompactSwitcher(trigger)
    const content = document.body.querySelector<HTMLElement>('[data-slot="popover-content"]')
    if (!content) throw new Error('missing terminal popover content')

    act(() => content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    await flushTimers()

    expect(document.activeElement).toBe(trigger)
  })

  test('blocks tab switching and closing while terminal creation is pending', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        panelActive
        newTerminalBusy
        newTerminalBlocksTabInteraction
        sessions={[
          session({ terminalSessionId: 'term-111111111111111111111', selected: true, title: 'term-1' }),
          session({ terminalSessionId: 'term-222222222222222222222', selected: false, title: 'term-2' }),
        ]}
        onNew={() => {}}
        onSelect={onSelect}
        onScrollToBottom={() => {}}
        onClose={onClose}
        onReorder={() => {}}
      />,
    )

    const inactiveTab = document.body.querySelector<HTMLButtonElement>('#workspace-workspace-pane-tab-1')
    const activeClose = document.body.querySelector<HTMLButtonElement>('button[aria-label="close term-1"]')
    const inactiveClose = document.body.querySelector<HTMLButtonElement>('button[aria-label="close term-2"]')
    expect(inactiveTab).not.toBeNull()
    expect(inactiveTab?.disabled).toBe(true)
    expect(activeClose).not.toBeNull()
    expect(activeClose?.disabled).toBe(true)
    expect(activeClose?.className).toContain('opacity-100')
    expect(inactiveClose).not.toBeNull()
    expect(inactiveClose?.disabled).toBe(true)
    expect(inactiveClose?.className).toContain('opacity-0')
    expect(inactiveClose?.className).not.toContain('group-hover:opacity-100')

    act(() => {
      inactiveTab?.click()
      activeClose?.click()
      inactiveClose?.click()
    })

    expect(onSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  test('reserves close-action space for a pending terminal tab', () => {
    render(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        pendingTerminal
        newTerminalBusy
        newTerminalBlocksTabInteraction
        sessions={[session({ terminalSessionId: 'term-111111111111111111111', selected: true, title: 'term-1' })]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const pendingTab = document.body.querySelector('[data-workspace-pane-pending-tab="terminal"]')
    expect(pendingTab?.querySelector('[data-toolbar-tab-close-placeholder]')).not.toBeNull()
    expect(pendingTab?.querySelector('button[aria-label^="close "]')).toBeNull()
  })

  test('blocks compact popover tab switching while terminal creation is pending', async () => {
    const onSelect = vi.fn()
    render(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        responsiveCompact
        newTerminalBusy
        newTerminalBlocksTabInteraction
        sessions={[
          session({ terminalSessionId: 'term-111111111111111111111', selected: true, title: 'term-1' }),
          session({ terminalSessionId: 'term-222222222222222222222', selected: false, title: 'term-2' }),
        ]}
        onNew={() => {}}
        onSelect={onSelect}
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

    const inactiveItem = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'term-2',
    )
    expect(inactiveItem).not.toBeNull()
    expect(inactiveItem?.disabled).toBe(true)

    act(() => {
      inactiveItem?.click()
    })

    expect(onSelect).not.toHaveBeenCalled()
  })

  test('collapsed terminal tab only navigates out on arrow keys', () => {
    const onNavigateOut = vi.fn()
    render(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        responsiveCompact
        sessions={[
          session({ terminalSessionId: 'term-111111111111111111111', selected: false, title: 'term-1' }),
          session({ terminalSessionId: 'term-222222222222222222222', selected: true, title: 'term-2' }),
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
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 'term-111111111111111111111', title: 'term-1' }),
          session({ terminalSessionId: 'term-222222222222222222222', title: 'term-2', selected: false }),
          session({ terminalSessionId: 'term-333333333333333333333', title: 'term-3', selected: false }),
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
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        panelActive
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
    )

    const terminalTwo = document.body.querySelector(
      '[data-workspace-pane-tab-tooltip-id="terminal:term-222222222222222222222"]',
    )
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
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        panelActive
        sessions={[
          session({
            terminalSessionId: 'term-111111111111111111111',
            selected: true,
            hasBell: true,
            hasRecentOutput: false,
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
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 'term-111111111111111111111', title: 'term-1' }),
          session({ terminalSessionId: 'term-222222222222222222222', title: 'term-2', selected: false }),
          session({ terminalSessionId: 'term-333333333333333333333', title: 'term-3', selected: false }),
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
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 'term-111111111111111111111', title: 'term-1', selected: true }),
          session({ terminalSessionId: 'term-222222222222222222222', title: 'term-2', selected: false, index: 2 }),
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

  test('scrolls the active tab into view when selection changes', () => {
    render(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 'term-111111111111111111111', title: 'term-1' }),
          session({ terminalSessionId: 'term-222222222222222222222', title: 'term-2', selected: false }),
          session({ terminalSessionId: 'term-333333333333333333333', title: 'term-3', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const scrollIntoView = scrollIntoViewMock()
    scrollIntoView.mockClear()
    setTabStripScrollGeometry({
      viewport: { left: 0, right: 200 },
      newButton: { left: 230, right: 258 },
      tabs: {
        'workspace-workspace-pane-tab-2': { left: 120, right: 220 },
      },
    })

    rerender(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 'term-111111111111111111111', title: 'term-1', selected: false }),
          session({ terminalSessionId: 'term-222222222222222222222', title: 'term-2', selected: false }),
          session({ terminalSessionId: 'term-333333333333333333333', title: 'term-3', selected: true }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const newButton = document.body.querySelector('[data-workspace-pane-new-button]')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(newButton)
    expect(scrollIntoView).toHaveBeenLastCalledWith({
      inline: 'end',
      block: 'nearest',
      behavior: 'smooth',
    })
  })

  test('scrolls the active tab into view on initial mount', () => {
    setTabStripScrollGeometry({
      viewport: { left: 0, right: 200 },
      tabs: {
        'workspace-workspace-pane-tab': { left: 230, right: 330 },
      },
    })

    render(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 'term-111111111111111111111', title: 'term-1' }),
          session({ terminalSessionId: 'term-222222222222222222222', title: 'term-2', selected: false }),
          session({ terminalSessionId: 'term-333333333333333333333', title: 'term-3', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const scrollIntoView = scrollIntoViewMock()
    const activeTab = workspacePaneTabScrollTarget('workspace-workspace-pane-tab')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(activeTab)
    expect(scrollIntoView).toHaveBeenLastCalledWith({ inline: 'end', block: 'nearest', behavior: 'smooth' })
  })

  test('scrolls a left-clipped active tab to the start edge', () => {
    render(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 'term-111111111111111111111', title: 'term-1' }),
          session({ terminalSessionId: 'term-222222222222222222222', title: 'term-2', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const scrollIntoView = scrollIntoViewMock()
    scrollIntoView.mockClear()
    setTabStripScrollGeometry({
      viewport: { left: 0, right: 200 },
      tabs: {
        'workspace-workspace-pane-tab-1': { left: -80, right: 20 },
      },
    })

    rerender(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 'term-111111111111111111111', title: 'term-1', selected: false }),
          session({ terminalSessionId: 'term-222222222222222222222', title: 'term-2', selected: true }),
          session({ terminalSessionId: 'term-333333333333333333333', title: 'term-3', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const activeTab = workspacePaneTabScrollTarget('workspace-workspace-pane-tab-1')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(activeTab)
    expect(scrollIntoView).toHaveBeenLastCalledWith({ inline: 'start', block: 'nearest', behavior: 'smooth' })
  })

  test('does not scroll when compact mode renders without a scroll viewport', () => {
    render(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        responsiveCompact
        sessions={[
          session({ terminalSessionId: 'term-111111111111111111111', title: 'term-1' }),
          session({ terminalSessionId: 'term-222222222222222222222', title: 'term-2', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    expect(scrollIntoViewMock()).not.toHaveBeenCalled()
  })

  test('scrolls the new terminal button into view before creating a terminal', () => {
    const onNew = vi.fn()
    setTabStripScrollGeometry({
      viewport: { left: 0, right: 200 },
      newButton: { left: 230, right: 258 },
      tabs: {
        'workspace-workspace-pane-tab': { left: 20, right: 120 },
      },
    })
    render(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 'term-111111111111111111111', title: 'term-1' }),
          session({ terminalSessionId: 'term-222222222222222222222', title: 'term-2', selected: false }),
        ]}
        onNew={onNew}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )
    const scrollIntoView = scrollIntoViewMock()
    scrollIntoView.mockClear()
    const newButton = document.body.querySelector<HTMLButtonElement>('[data-workspace-pane-new-button]')
    expect(newButton).not.toBeNull()

    act(() => {
      newButton?.click()
    })

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(newButton)
    expect(scrollIntoView).toHaveBeenLastCalledWith({ inline: 'end', block: 'nearest', behavior: 'smooth' })
    expect(onNew).toHaveBeenCalledTimes(1)
  })

  test('does not scroll right when tab data refreshes without changing the active tab', () => {
    render(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 'term-111111111111111111111', title: 'term-1', selected: false }),
          session({ terminalSessionId: 'term-222222222222222222222', title: 'term-2', selected: true }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )
    const scrollIntoView = scrollIntoViewMock()
    scrollIntoView.mockClear()
    setTabStripScrollGeometry({
      viewport: { left: 0, right: 200 },
      newButton: { left: 230, right: 258 },
      tabs: {
        'workspace-workspace-pane-tab-1': { left: 120, right: 220 },
      },
    })

    rerender(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 'term-111111111111111111111', title: 'term-1 refreshed', selected: false }),
          session({ terminalSessionId: 'term-222222222222222222222', title: 'term-2 refreshed', selected: true }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  test('does not auto-scroll when the workspace tab target changes', () => {
    render(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree-a"
        workspacePaneTabTargetKey="/repo\0branch\0feature-a"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 'term-aaaaaaaaaaaaaaaaaaaa1', title: 'term-a1', selected: false }),
          session({ terminalSessionId: 'term-aaaaaaaaaaaaaaaaaaaa2', title: 'term-a2', selected: true }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )
    const scrollIntoView = scrollIntoViewMock()
    scrollIntoView.mockClear()
    setTabStripScrollGeometry({
      viewport: { left: 0, right: 200 },
      newButton: { left: 230, right: 258 },
      tabs: {
        'workspace-workspace-pane-tab-1': { left: 120, right: 220 },
      },
    })

    rerender(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree-b"
        workspacePaneTabTargetKey="/repo\0branch\0feature-b"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 'term-bbbbbbbbbbbbbbbbbbbb1', title: 'term-b1', selected: false }),
          session({ terminalSessionId: 'term-bbbbbbbbbbbbbbbbbbbb2', title: 'term-b2', selected: true }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  test('does not auto-scroll when target active tab appears after target change', () => {
    render(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree-a"
        workspacePaneTabTargetKey="/repo\0branch\0feature-a"
        workspacePaneId="workspace"
        sessions={[session({ terminalSessionId: 'term-aaaaaaaaaaaaaaaaaaaa1', title: 'term-a1', selected: true })]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )
    const scrollIntoView = scrollIntoViewMock()
    scrollIntoView.mockClear()

    rerender(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree-b"
        workspacePaneTabTargetKey="/repo\0branch\0feature-b"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 'term-bbbbbbbbbbbbbbbbbbbb1', title: 'term-b1', selected: false }),
          session({ terminalSessionId: 'term-bbbbbbbbbbbbbbbbbbbb2', title: 'term-b2', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    setTabStripScrollGeometry({
      viewport: { left: 0, right: 200 },
      newButton: { left: 230, right: 258 },
      tabs: {
        'workspace-workspace-pane-tab-1': { left: 120, right: 220 },
      },
    })

    rerender(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree-b"
        workspacePaneTabTargetKey="/repo\0branch\0feature-b"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 'term-bbbbbbbbbbbbbbbbbbbb1', title: 'term-b1', selected: false }),
          session({ terminalSessionId: 'term-bbbbbbbbbbbbbbbbbbbb2', title: 'term-b2', selected: true }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  test('restores horizontal scroll position for each workspace tab target', () => {
    render(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree-a"
        workspacePaneTabTargetKey="/repo\0branch\0feature-a"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 'term-aaaaaaaaaaaaaaaaaaaa1', title: 'term-a1', selected: false }),
          session({ terminalSessionId: 'term-aaaaaaaaaaaaaaaaaaaa2', title: 'term-a2', selected: true }),
          session({ terminalSessionId: 'term-aaaaaaaaaaaaaaaaaaaa3', title: 'term-a3', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const viewport = workspacePaneTabViewport()
    act(() => {
      viewport.scrollLeft = 180
      viewport.dispatchEvent(new Event('scroll', { bubbles: true }))
    })

    rerender(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree-b"
        workspacePaneTabTargetKey="/repo\0branch\0feature-b"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 'term-bbbbbbbbbbbbbbbbbbbb1', title: 'term-b1', selected: true }),
          session({ terminalSessionId: 'term-bbbbbbbbbbbbbbbbbbbb2', title: 'term-b2', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    expect(viewport.scrollLeft).toBe(0)

    act(() => {
      viewport.scrollLeft = 40
      viewport.dispatchEvent(new Event('scroll', { bubbles: true }))
    })

    rerender(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree-a"
        workspacePaneTabTargetKey="/repo\0branch\0feature-a"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 'term-aaaaaaaaaaaaaaaaaaaa1', title: 'term-a1', selected: false }),
          session({ terminalSessionId: 'term-aaaaaaaaaaaaaaaaaaaa2', title: 'term-a2', selected: true }),
          session({ terminalSessionId: 'term-aaaaaaaaaaaaaaaaaaaa3', title: 'term-a3', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    expect(viewport.scrollLeft).toBe(180)

    rerender(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree-b"
        workspacePaneTabTargetKey="/repo\0branch\0feature-b"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 'term-bbbbbbbbbbbbbbbbbbbb1', title: 'term-b1', selected: true }),
          session({ terminalSessionId: 'term-bbbbbbbbbbbbbbbbbbbb2', title: 'term-b2', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    expect(viewport.scrollLeft).toBe(40)
  })

  test('scrolls the right neighbour into view after closing the active tab', () => {
    function CloseActiveHarness() {
      const [sessions, setSessions] = useState([
        session({ terminalSessionId: 'term-111111111111111111111', title: 'term-1', selected: false }),
        session({ terminalSessionId: 'term-222222222222222222222', title: 'term-2', selected: true }),
        session({ terminalSessionId: 'term-333333333333333333333', title: 'term-3', selected: false }),
      ])

      return (
        <TestWorkspacePaneTabStrip
          terminalFilesystemTargetKey="/repo\0/repo/worktree"
          workspacePaneId="workspace"
          sessions={sessions}
          onNew={() => {}}
          onSelect={() => {}}
          onScrollToBottom={() => {}}
          onClose={(closed) => {
            setSessions((current) =>
              current
                .filter((candidate) => candidate.terminalSessionId !== closed.terminalSessionId)
                .map((candidate) => ({
                  ...candidate,
                  selected: candidate.terminalSessionId === 'term-333333333333333333333',
                })),
            )
          }}
          onReorder={() => {}}
        />
      )
    }

    render(<CloseActiveHarness />)
    const scrollIntoView = scrollIntoViewMock()
    scrollIntoView.mockClear()
    setTabStripScrollGeometry({
      viewport: { left: 0, right: 200 },
      newButton: { left: 230, right: 258 },
      tabs: {
        'workspace-workspace-pane-tab-1': { left: 120, right: 220 },
      },
    })
    const closeButton = document.body.querySelector<HTMLButtonElement>('button[aria-label="close term-2"]')
    expect(closeButton).not.toBeNull()

    act(() => {
      closeButton?.click()
    })

    const newButton = document.body.querySelector('[data-workspace-pane-new-button]')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(newButton)
    expect(scrollIntoView).toHaveBeenLastCalledWith({ inline: 'end', block: 'nearest', behavior: 'smooth' })
  })

  test('focuses the actual active tab after closing the active tab', () => {
    function CloseActiveSelectsLeftHarness() {
      const [sessions, setSessions] = useState([
        session({ terminalSessionId: 'term-111111111111111111111', title: 'term-1', selected: false }),
        session({ terminalSessionId: 'term-222222222222222222222', title: 'term-2', selected: true }),
        session({ terminalSessionId: 'term-333333333333333333333', title: 'term-3', selected: false }),
      ])

      return (
        <TestWorkspacePaneTabStrip
          terminalFilesystemTargetKey="/repo\0/repo/worktree"
          workspacePaneId="workspace"
          sessions={sessions}
          onNew={() => {}}
          onSelect={() => {}}
          onScrollToBottom={() => {}}
          onClose={(closed) => {
            setSessions((current) =>
              current
                .filter((candidate) => candidate.terminalSessionId !== closed.terminalSessionId)
                .map((candidate) => ({
                  ...candidate,
                  selected: candidate.terminalSessionId === 'term-111111111111111111111',
                })),
            )
          }}
          onReorder={() => {}}
        />
      )
    }

    render(<CloseActiveSelectsLeftHarness />)
    const closeButton = document.body.querySelector<HTMLButtonElement>('button[aria-label="close term-2"]')
    expect(closeButton).not.toBeNull()

    act(() => {
      closeButton?.click()
    })

    expect(document.activeElement?.textContent).toContain('term-1')
  })

  test('does not scroll when the active tab stays visible after a non-active terminal session is removed', () => {
    function CloseInactiveHarness() {
      const [sessions, setSessions] = useState([
        session({ terminalSessionId: 'term-111111111111111111111', title: 'term-1', selected: true }),
        session({ terminalSessionId: 'term-222222222222222222222', title: 'term-2', selected: false }),
        session({ terminalSessionId: 'term-333333333333333333333', title: 'term-3', selected: false }),
      ])

      return (
        <TestWorkspacePaneTabStrip
          terminalFilesystemTargetKey="/repo\0/repo/worktree"
          workspacePaneId="workspace"
          sessions={sessions}
          onNew={() => {}}
          onSelect={() => {}}
          onScrollToBottom={() => {}}
          onClose={(closed) => {
            setSessions((current) =>
              current.filter((candidate) => candidate.terminalSessionId !== closed.terminalSessionId),
            )
          }}
          onReorder={() => {}}
        />
      )
    }

    setTabStripScrollGeometry({
      viewport: { left: 0, right: 200 },
      tabs: {
        'workspace-workspace-pane-tab': { left: 20, right: 120 },
      },
    })

    render(<CloseInactiveHarness />)
    const scrollIntoView = scrollIntoViewMock()
    scrollIntoView.mockClear()
    const closeButton = document.body.querySelector<HTMLButtonElement>('button[aria-label="close term-2"]')
    expect(closeButton).not.toBeNull()

    act(() => {
      closeButton?.click()
    })

    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  test('restores the full tab strip after leaving compact mode', () => {
    rerender(
      <TestWorkspacePaneTabStrip
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        responsiveCompact
        sessions={[
          session({ terminalSessionId: 'term-111111111111111111111', title: 'term-1' }),
          session({ terminalSessionId: 'term-222222222222222222222', title: 'term-2', selected: false }),
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
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        sessions={[
          session({ terminalSessionId: 'term-111111111111111111111', title: 'term-1' }),
          session({ terminalSessionId: 'term-222222222222222222222', title: 'term-2', selected: false }),
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
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        responsiveCompact
        panelActive
        sessions={[
          session({ terminalSessionId: 'term-111111111111111111111', title: 'term-1' }),
          session({ terminalSessionId: 'term-222222222222222222222', title: 'term-2', selected: false }),
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
        session({ terminalSessionId: 'term-111111111111111111111', title: 'term-1', selected: true }),
        session({ terminalSessionId: 'term-222222222222222222222', title: 'term-2', selected: false }),
      ])

      return (
        <TestWorkspacePaneTabStrip
          terminalFilesystemTargetKey="/repo\0/repo/worktree"
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
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        responsiveCompact
        panelActive
        sessions={[
          session({ terminalSessionId: 'term-111111111111111111111', title: 'term-1', selected: false }),
          session({ terminalSessionId: 'term-222222222222222222222', title: 'term-2', selected: false }),
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
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        responsiveCompact
        panelActive
        sessions={[session({ terminalSessionId: 'term-111111111111111111111', title: 'term-1', selected: false })]}
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
        terminalFilesystemTargetKey="/repo\0/repo/worktree"
        workspacePaneId="workspace"
        panelActive
        sessions={[session({ terminalSessionId: 'term-111111111111111111111', title: 'term-1', selected: false })]}
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
    const busyNewButton = document.body.querySelector<HTMLButtonElement>('[data-workspace-pane-new-button]')
    expect(busyNewButton).not.toBeNull()
    expect(busyNewButton?.getAttribute('aria-label')).toBe('terminal.new')
    expect(busyNewButton?.getAttribute('aria-busy')).toBe('true')
    expect(busyNewButton?.disabled).toBe(true)
    expect(busyNewButton?.querySelector('.animate-spin')).toBeNull()
  })

  test('keeps placeholder terminal titles out of materialized tab text', () => {
    const placeholderView: TerminalSessionSummary = {
      ...session({ terminalSessionId: 'term-111111111111111111111', title: 'terminal', selected: true }),
      fullTitle: 'terminal',
      originalTitle: null,
    }
    const item = createRuntimeWorkspacePaneTabItem({
      view: placeholderView,
      label: '',
      tooltip: 'terminal.opening',
      closeLabel: 'terminal.close-named',
    })

    render(
      <WorkspacePaneTabStrip
        createAction={{ label: 'terminal.new', onCreate: () => {} }}
        workspacePaneTabTargetKey="/repo\0branch\0main"
        workspacePaneId="workspace"
        panelActive
        items={[item]}
        activeTabIdentity={terminalWorkspacePaneTabProvider.identity(placeholderView.terminalSessionId)}
        onSelect={() => {}}
        onReselect={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    const tab = document.body.querySelector('[role="tab"][aria-label="terminal.opening"]')
    const terminalView = document.body.querySelector(
      '[data-workspace-pane-tab-tooltip-id="terminal:term-111111111111111111111"]',
    )

    expect(tab).not.toBeNull()
    expect(terminalView?.textContent).not.toContain('terminal')
    expect(terminalView?.textContent).not.toContain('terminal.opening')
  })
})

function TestWorkspacePaneTabStrip(props: {
  terminalFilesystemTargetKey: string
  workspacePaneTabTargetKey?: string
  sessions: TerminalSessionSummary[]
  workspacePaneId: string
  pendingTerminal?: boolean
  responsiveCompact?: boolean
  panelActive?: boolean
  newTerminalBusy?: boolean
  newTerminalBlocksTabInteraction?: boolean
  onNew: () => void
  onSelect: (terminalFilesystemTargetKey: string, tab: TerminalSessionSummary) => void
  onScrollToBottom: (key: string) => void
  onClose: (tab: TerminalSessionSummary) => void
  onReorder: (tabs: WorkspacePaneTabEntry[]) => void
  onNavigateOut?: (direction: 'prev' | 'next' | 'first' | 'last') => void
}) {
  const selected = props.sessions.find((candidate) => candidate.selected) ?? null
  const {
    sessions,
    terminalFilesystemTargetKey,
    newTerminalBusy,
    newTerminalBlocksTabInteraction,
    onNew,
    onScrollToBottom,
    ...workspacePaneProps
  } = props
  const items: WorkspacePaneTabItem[] = sessions.map((tab) =>
    createRuntimeWorkspacePaneTabItem({
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
      createAction={
        terminalFilesystemTargetKey
          ? {
              label: 'terminal.new',
              busy: newTerminalBusy ?? false,
              blocksTabInteraction: newTerminalBlocksTabInteraction ?? false,
              onCreate: onNew,
            }
          : null
      }
      workspacePaneTabTargetKey={props.workspacePaneTabTargetKey ?? '/repo\0branch\0main'}
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

function scrollIntoViewMock() {
  return vi.mocked(HTMLElement.prototype.scrollIntoView)
}

function workspacePaneTabScrollTarget(tabId: string): HTMLElement {
  const tab = document.getElementById(tabId)
  const target = tab?.closest<HTMLElement>('[data-workspace-pane-tab-scroll-target]')
  if (!target) throw new Error(`missing scroll target for ${tabId}`)
  return target
}

function workspacePaneTabViewport(): HTMLDivElement {
  const viewport = document.body.querySelector<HTMLDivElement>('[data-radix-scroll-area-viewport]')
  if (!viewport) throw new Error('missing workspace pane tab viewport')
  return viewport
}

function setTabStripScrollGeometry(input: {
  viewport: { left: number; right: number }
  newButton?: { left: number; right: number }
  tabs: Record<string, { left: number; right: number }>
}) {
  tabStripViewportRect = rect(input.viewport)
  tabStripNewButtonRect = input.newButton ? rect(input.newButton) : null
  tabStripTabRects.clear()
  for (const [id, tabRect] of Object.entries(input.tabs)) {
    tabStripTabRects.set(id, rect(tabRect))
  }
}

function rect({ left, right }: { left: number; right: number }): DOMRect {
  const width = right - left
  return {
    left,
    right,
    width,
    x: left,
    top: 0,
    bottom: 28,
    height: 28,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect
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

async function flushTimers() {
  await act(async () => {
    vi.runAllTimers()
    await Promise.resolve()
  })
}

async function openCompactSwitcher(trigger: HTMLButtonElement) {
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
    await Promise.resolve()
  })
}

function appendTerminalFocusTarget(): HTMLTextAreaElement {
  const host = document.createElement('div')
  host.className = 'goblin-managed-terminal-host'
  const input = document.createElement('textarea')
  host.appendChild(input)
  document.body.appendChild(host)
  return input
}
