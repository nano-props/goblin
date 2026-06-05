// @vitest-environment jsdom

import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { TerminalSwitcher } from '#/web/components/terminal/TerminalSwitcher.tsx'

vi.mock('#/web/components/ui/scroll-area.tsx', () => ({
  ScrollArea: ({
    children,
    className,
  }: {
    children: React.ReactNode
    className?: string
    viewportClassName?: string
  }) => <div className={className}>{children}</div>,
}))

vi.mock('#/web/stores/i18n.ts', () => ({
  useT: () => (key: string) => key,
}))

afterEach(() => {
  document.body.innerHTML = ''
})

type TerminalSwitcherSession = ComponentProps<typeof TerminalSwitcher>['sessions'][number]

function renderTerminalSwitcher(root: Root, sessions: TerminalSwitcherSession[]) {
  return act(async () => {
    root.render(
      <TerminalSwitcher
        worktreeTerminalKey="repo::worktree"
        sessions={sessions}
        onNew={() => {}}
        onSelect={() => {}}
        onScrollToBottom={() => {}}
        onClose={() => {}}
      />,
    )
  })
}

describe('TerminalSwitcher', () => {
  test('marks the selected session with stable state attributes', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)

    await act(async () => {
      root.render(
        <TerminalSwitcher
          worktreeTerminalKey="repo::worktree"
          sessions={[
            {
              key: 'terminal-1',
              worktreeTerminalKey: 'repo::worktree',
              terminalId: 'terminal-1',
              index: 1,
              title: 'zsh',
              phase: 'open',
              selected: true,
              hasBell: false,
            },
            {
              key: 'terminal-2',
              worktreeTerminalKey: 'repo::worktree',
              terminalId: 'terminal-2',
              index: 2,
              title: 'node',
              phase: 'open',
              selected: false,
              hasBell: false,
            },
          ]}
          onNew={() => {}}
          onSelect={() => {}}
          onScrollToBottom={() => {}}
          onClose={() => {}}
        />,
      )
    })

    try {
      const selectedRow = container.querySelector<HTMLElement>(".goblin-terminal-switcher__row[data-selected='true']")
      const selectedButton = selectedRow?.querySelector<HTMLButtonElement>('.goblin-terminal-switcher__select')
      const unselectedRow = container.querySelector<HTMLElement>(
        ".goblin-terminal-switcher__row:not([data-selected='true'])",
      )
      const unselectedButton = unselectedRow?.querySelector<HTMLButtonElement>('.goblin-terminal-switcher__select')

      expect(selectedRow).not.toBeNull()
      expect(selectedButton?.getAttribute('aria-current')).toBe('true')
      expect(unselectedRow?.getAttribute('data-selected')).toBeNull()
      expect(unselectedButton?.getAttribute('aria-current')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test('shows a delayed left-side tooltip and reuses it while moving between sessions', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)

    await act(async () => {
      root.render(
        <TerminalSwitcher
          worktreeTerminalKey="repo::worktree"
          sessions={[
            {
              key: 'terminal-1',
              worktreeTerminalKey: 'repo::worktree',
              terminalId: 'terminal-1',
              index: 1,
              title: 'npm run dev',
              fullTitle: '~/Developer/goblin — npm run dev',
              phase: 'open',
              selected: true,
              hasBell: false,
            },
            {
              key: 'terminal-2',
              worktreeTerminalKey: 'repo::worktree',
              terminalId: 'terminal-2',
              index: 2,
              title: 'pytest',
              fullTitle: '~/Developer/goblin — pytest -q',
              phase: 'open',
              selected: false,
              hasBell: false,
            },
          ]}
          onNew={() => {}}
          onSelect={() => {}}
          onScrollToBottom={() => {}}
          onClose={() => {}}
        />,
      )
    })

    try {
      const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.goblin-terminal-switcher__select'))
      expect(buttons[0]?.textContent).toContain('npm run dev')
      expect(buttons[0]?.getAttribute('aria-label')).toBe('~/Developer/goblin — npm run dev')
      expect(buttons[1]?.getAttribute('aria-label')).toBe('~/Developer/goblin — pytest -q')
      buttons[0]!.getBoundingClientRect = () =>
        ({
          left: 200,
          top: 40,
          width: 120,
          height: 28,
          right: 320,
          bottom: 68,
          x: 200,
          y: 40,
          toJSON: () => ({}),
        }) as DOMRect
      buttons[1]!.getBoundingClientRect = () =>
        ({
          left: 200,
          top: 80,
          width: 120,
          height: 28,
          right: 320,
          bottom: 108,
          x: 200,
          y: 80,
          toJSON: () => ({}),
        }) as DOMRect

      await act(async () => {
        buttons[0]?.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
      })
      expect(document.body.querySelector('[role="tooltip"]')).toBeNull()

      await act(async () => {
        vi.advanceTimersByTime(700)
        await Promise.resolve()
      })

      let tooltip = document.body.querySelector<HTMLElement>('[role="tooltip"]')
      expect(tooltip?.textContent).toContain('~/Developer/goblin — npm run dev')
      const firstTop = tooltip?.style.top
      const firstLeft = tooltip?.style.left
      expect(tooltip?.style.transform).toBe('translateX(-100%)')

      await act(async () => {
        buttons[1]?.dispatchEvent(
          new MouseEvent('pointerover', { bubbles: true, relatedTarget: buttons[0] ?? undefined }),
        )
      })

      tooltip = document.body.querySelector<HTMLElement>('[role="tooltip"]')
      expect(tooltip?.textContent).toContain('~/Developer/goblin — pytest -q')
      expect(tooltip?.style.top).not.toBe(firstTop)
      expect(tooltip?.style.left).toBe(firstLeft)
    } finally {
      await act(async () => root.unmount())
      container.remove()
      vi.useRealTimers()
    }
  })

  test('keeps close actions isolated from select clicks', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const onNew = vi.fn()
    const onSelect = vi.fn()
    const onScrollToBottom = vi.fn()
    const onClose = vi.fn()

    await act(async () => {
      root.render(
        <TerminalSwitcher
          worktreeTerminalKey="repo::worktree"
          sessions={[
            {
              key: 'terminal-1',
              worktreeTerminalKey: 'repo::worktree',
              terminalId: 'terminal-1',
              index: 1,
              title: 'zsh',
              phase: 'open',
              selected: true,
              hasBell: false,
            },
            {
              key: 'terminal-2',
              worktreeTerminalKey: 'repo::worktree',
              terminalId: 'terminal-2',
              index: 2,
              title: 'node',
              phase: 'open',
              selected: false,
              hasBell: true,
            },
          ]}
          onNew={onNew}
          onSelect={onSelect}
          onScrollToBottom={onScrollToBottom}
          onClose={onClose}
        />,
      )
    })

    try {
      const closeButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('.goblin-terminal-switcher__close'))
      expect(closeButtons).toHaveLength(2)

      await act(async () => {
        closeButtons[0]?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
        closeButtons[0]?.click()
      })

      expect(onClose).toHaveBeenCalledWith('terminal-1')
      expect(onSelect).not.toHaveBeenCalled()
      expect(onScrollToBottom).not.toHaveBeenCalled()
      expect(onNew).not.toHaveBeenCalled()
      expect(container.querySelector('.goblin-terminal-switcher__badge')?.textContent).toBe('1')
      expect(container.querySelectorAll('.goblin-terminal-switcher__bell-dot')).toHaveLength(1)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test('scrolls the selected terminal into view when selection changes', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const scrollIntoViewSpy = vi.fn()

    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollIntoViewSpy

    try {
      await renderTerminalSwitcher(root, [
        {
          key: 'terminal-1',
          worktreeTerminalKey: 'repo::worktree',
          terminalId: 'terminal-1',
          index: 1,
          title: 'zsh',
          phase: 'open',
          selected: true,
          hasBell: false,
        },
      ])

      scrollIntoViewSpy.mockClear()

      await renderTerminalSwitcher(root, [
        {
          key: 'terminal-1',
          worktreeTerminalKey: 'repo::worktree',
          terminalId: 'terminal-1',
          index: 1,
          title: 'zsh',
          phase: 'open',
          selected: false,
          hasBell: false,
        },
        {
          key: 'terminal-2',
          worktreeTerminalKey: 'repo::worktree',
          terminalId: 'terminal-2',
          index: 2,
          title: 'node',
          phase: 'open',
          selected: true,
          hasBell: false,
        },
      ])

      expect(scrollIntoViewSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          block: 'nearest',
          behavior: 'smooth',
        }),
      )
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test('does not scroll when the selected terminal stays the same', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const scrollIntoViewSpy = vi.fn()

    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollIntoViewSpy

    try {
      await renderTerminalSwitcher(root, [
        {
          key: 'terminal-1',
          worktreeTerminalKey: 'repo::worktree',
          terminalId: 'terminal-1',
          index: 1,
          title: 'zsh',
          phase: 'open',
          selected: true,
          hasBell: false,
        },
      ])

      scrollIntoViewSpy.mockClear()

      await renderTerminalSwitcher(root, [
        {
          key: 'terminal-1',
          worktreeTerminalKey: 'repo::worktree',
          terminalId: 'terminal-1',
          index: 1,
          title: 'bash',
          phase: 'open',
          selected: true,
          hasBell: true,
        },
      ])

      expect(scrollIntoViewSpy).not.toHaveBeenCalled()
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test('double-clicks the selected terminal to scroll to bottom', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const onSelect = vi.fn()
    const onScrollToBottom = vi.fn()

    await act(async () => {
      root.render(
        <TerminalSwitcher
          worktreeTerminalKey="repo::worktree"
          sessions={[
            {
              key: 'terminal-1',
              worktreeTerminalKey: 'repo::worktree',
              terminalId: 'terminal-1',
              index: 1,
              title: 'zsh',
              phase: 'open',
              selected: true,
              hasBell: false,
            },
            {
              key: 'terminal-2',
              worktreeTerminalKey: 'repo::worktree',
              terminalId: 'terminal-2',
              index: 2,
              title: 'node',
              phase: 'open',
              selected: false,
              hasBell: false,
            },
          ]}
          onNew={() => {}}
          onSelect={onSelect}
          onScrollToBottom={onScrollToBottom}
          onClose={() => {}}
        />,
      )
    })

    try {
      const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.goblin-terminal-switcher__select'))
      expect(buttons).toHaveLength(2)

      await act(async () => {
        buttons[0]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      })

      expect(onScrollToBottom).toHaveBeenCalledWith('terminal-1')
      expect(onScrollToBottom).toHaveBeenCalledTimes(1)
      expect(onSelect).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test('does not scroll when double-clicking an unselected terminal', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const onScrollToBottom = vi.fn()

    await act(async () => {
      root.render(
        <TerminalSwitcher
          worktreeTerminalKey="repo::worktree"
          sessions={[
            {
              key: 'terminal-1',
              worktreeTerminalKey: 'repo::worktree',
              terminalId: 'terminal-1',
              index: 1,
              title: 'zsh',
              phase: 'open',
              selected: true,
              hasBell: false,
            },
            {
              key: 'terminal-2',
              worktreeTerminalKey: 'repo::worktree',
              terminalId: 'terminal-2',
              index: 2,
              title: 'node',
              phase: 'open',
              selected: false,
              hasBell: false,
            },
          ]}
          onNew={() => {}}
          onSelect={() => {}}
          onScrollToBottom={onScrollToBottom}
          onClose={() => {}}
        />,
      )
    })

    try {
      const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('.goblin-terminal-switcher__select'))
      expect(buttons).toHaveLength(2)

      await act(async () => {
        buttons[1]?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      })

      expect(onScrollToBottom).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
