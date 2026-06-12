// @vitest-environment jsdom

import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { TerminalTabs } from '#/web/components/terminal/TerminalTabs.tsx'
import type { TerminalSessionSummary } from '#/web/components/terminal/types.ts'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean; goblinNative?: unknown }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  reactActEnvironment.goblinNative = {
    homeDir: '/Users/tester',
    pathForFile: () => '',
    invokeRpc: async () => null,
    abortRpc: async () => true,
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
  vi.useRealTimers()
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('TerminalTabs', () => {
  test('shows terminal tooltip content with only the original title', async () => {
    render(
      <TerminalTabs
        worktreeTerminalKey="/repo\0/repo/worktree"
        detailId="detail"
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

    const tab = document.body.querySelector('[data-terminal-tab-tooltip-id="t1"]')
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

  test('keeps the selected terminal in the collapsed dropdown and still offers new terminal', async () => {
    render(
      <TerminalTabs
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

    const trigger = document.body.querySelector('button[aria-label="terminal.sessions"]')
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('missing terminal menu trigger')

    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
      await Promise.resolve()
    })

    const selectedItem = [...document.body.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent?.includes('term-2'))
    expect(selectedItem?.getAttribute('aria-current')).toBe('true')
    expect(document.body.textContent).toContain('terminal.new')
  })

  test('navigates out of the collapsed terminal tab instead of focusing hidden keyed tabs', () => {
    const onNavigateOut = vi.fn()
    render(
      <TerminalTabs
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

    const tab = document.body.querySelector('#detail-terminal-tab')
    if (!(tab instanceof HTMLButtonElement)) throw new Error('missing collapsed terminal tab')

    act(() => {
      tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
      tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
      tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    })

    expect(onNavigateOut.mock.calls).toEqual([['prev'], ['next'], ['last']])
  })

  test('keeps all terminal tabs visible in a horizontal scroll area when not in compact mode', () => {
    render(
      <TerminalTabs
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

    const tablist = document.body.querySelector('[role="tablist"][aria-label="terminal.sessions"]')
    expect(tablist).not.toBeNull()
    expect(document.body.querySelector('button[aria-label="terminal.sessions"]')).toBeNull()
    expect(tablist?.className).toContain('h-full')
    expect(tablist?.parentElement?.className).toContain('w-max')
    expect(
      [...document.body.querySelectorAll('[data-terminal-tab-tooltip-id]')].every((tab) => tab.className.includes('w-28')),
    ).toBe(true)
    expect(document.body.querySelectorAll('[role="tab"]').length).toBe(3)
  })

  test('moves focus across the full terminal tab strip and navigates out at the edges', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
    const onNavigateOut = vi.fn()

    render(
      <TerminalTabs
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

    const tab1 = document.body.querySelector('#detail-terminal-tab')
    const tab2 = document.body.querySelector('#detail-terminal-tab-t2')
    const tab3 = document.body.querySelector('#detail-terminal-tab-t3')
    if (!(tab1 instanceof HTMLButtonElement) || !(tab2 instanceof HTMLButtonElement) || !(tab3 instanceof HTMLButtonElement)) {
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
    expect(onNavigateOut).toHaveBeenNthCalledWith(2, 'first')
  })

  test('scrolls the tab strip to the far right when a new terminal session is added', () => {
    render(
      <TerminalTabs
        worktreeTerminalKey="/repo\0/repo/worktree"
        detailId="detail"
        sessions={[
          session({ key: 't1', title: 'term-1' }),
          session({ key: 't2', title: 'term-2', selected: false }),
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
      <TerminalTabs
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
      <TerminalTabs
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
      <TerminalTabs
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

  test('does not scroll when the tab strip does not overflow horizontally', () => {
    render(
      <TerminalTabs
        worktreeTerminalKey="/repo\0/repo/worktree"
        detailId="detail"
        sessions={[
          session({ key: 't1', title: 'term-1' }),
          session({ key: 't2', title: 'term-2', selected: false }),
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
      <TerminalTabs
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
      <TerminalTabs
        worktreeTerminalKey="/repo\0/repo/worktree"
        detailId="detail"
        sessions={[
          session({ key: 't1', title: 'term-1' }),
          session({ key: 't2', title: 'term-2', selected: false }),
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
      <TerminalTabs
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
      <TerminalTabs
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
      <TerminalTabs
        worktreeTerminalKey="/repo\0/repo/worktree"
        detailId="detail"
        sessions={[
          session({ key: 't1', title: 'term-1' }),
          session({ key: 't2', title: 'term-2', selected: false }),
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
      <TerminalTabs
        worktreeTerminalKey="/repo\0/repo/worktree"
        detailId="detail"
        responsiveCompact
        sessions={[
          session({ key: 't1', title: 'term-1' }),
          session({ key: 't2', title: 'term-2', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    expect(document.body.querySelectorAll('[role="tab"]').length).toBe(1)
    expect(document.body.querySelector('[data-terminal-tab-tooltip-id]')?.className).toContain('w-28')

    rerender(
      <TerminalTabs
        worktreeTerminalKey="/repo\0/repo/worktree"
        detailId="detail"
        sessions={[
          session({ key: 't1', title: 'term-1' }),
          session({ key: 't2', title: 'term-2', selected: false }),
        ]}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
        onReorder={() => {}}
      />,
    )

    expect(document.body.querySelectorAll('[role="tab"]').length).toBe(2)
    expect(document.body.querySelector('button[aria-label="terminal.sessions"]')).toBeNull()
  })
})

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
  return {
    key: 't1',
    worktreeTerminalKey: '/repo\0/repo/worktree',
    terminalId: 'terminal-1',
    index: 1,
    title: 'term-1',
    fullTitle: 'term-1',
    originalTitle: 'term-1',
    phase: 'open',
    selected: true,
    hasBell: false,
    ...overrides,
  }
}

async function flushTimers() {
  await act(async () => {
    vi.runAllTimers()
    await Promise.resolve()
  })
}
