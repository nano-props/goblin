// @vitest-environment jsdom

import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { TerminalSwitcherDropdown } from '#/web/components/terminal/TerminalSwitcherDropdown.tsx'

vi.mock('#/web/stores/i18n.ts', () => ({
  useT: () => (key: string) => key,
}))

if (typeof globalThis.PointerEvent === 'undefined') {
  globalThis.PointerEvent = class PointerEvent extends MouseEvent {
    pointerId = 1
    pointerType = 'mouse'
    constructor(type: string, init?: MouseEventInit) {
      super(type, init)
    }
  } as unknown as typeof PointerEvent
}

afterEach(() => {
  document.body.innerHTML = ''
})

type TerminalSession = ComponentProps<typeof TerminalSwitcherDropdown>['sessions'][number]

function renderDropdown(
  root: Root,
  sessions: TerminalSession[],
  overrides?: Partial<ComponentProps<typeof TerminalSwitcherDropdown>>,
) {
  const onNew = vi.fn()
  const onSelect = vi.fn()
  const onScrollToBottom = vi.fn()
  const onClose = vi.fn()
  return {
    onNew,
    onSelect,
    onScrollToBottom,
    onClose,
    render: () =>
      act(async () => {
        root.render(
          <TerminalSwitcherDropdown
            worktreeTerminalKey="repo::worktree"
            sessions={sessions}
            onNew={onNew}
            onSelect={onSelect}
            onScrollToBottom={onScrollToBottom}
            onClose={onClose}
            {...overrides}
          />,
        )
      }),
  }
}

describe('TerminalSwitcherDropdown', () => {
  test('renders a new-terminal button when there are no sessions', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const { onNew, render } = renderDropdown(root, [])
    await render()

    try {
      const button = container.querySelector<HTMLButtonElement>('button')
      expect(button).not.toBeNull()
      expect(button?.textContent).toContain('terminal.new')
      expect(button?.querySelector('svg')).not.toBeNull()

      act(() => {
        button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(onNew).toHaveBeenCalledTimes(1)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test('renders dropdown trigger with selected session title and count badge', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const { render } = renderDropdown(root, [
      {
        key: 't1',
        worktreeTerminalKey: 'repo::worktree',
        terminalId: 't1',
        index: 1,
        title: 'zsh',
        phase: 'open',
        selected: true,
        hasBell: false,
      },
      {
        key: 't2',
        worktreeTerminalKey: 'repo::worktree',
        terminalId: 't2',
        index: 2,
        title: 'node',
        phase: 'open',
        selected: false,
        hasBell: false,
      },
    ])
    await render()

    try {
      const trigger = container.querySelector<HTMLButtonElement>('button')
      expect(trigger).not.toBeNull()
      expect(trigger?.textContent).toContain('zsh')
      expect(trigger?.textContent).toContain('2')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test('shows attention dot on trigger when there are unread bells', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const { render } = renderDropdown(root, [
      {
        key: 't1',
        worktreeTerminalKey: 'repo::worktree',
        terminalId: 't1',
        index: 1,
        title: 'zsh',
        phase: 'open',
        selected: true,
        hasBell: true,
      },
    ])
    await render()

    try {
      const trigger = container.querySelector<HTMLButtonElement>('button')
      expect(trigger).not.toBeNull()
      // The attention dot is rendered as nested spans inside the trigger
      expect(trigger?.querySelector('span.relative')).not.toBeNull()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test('opens dropdown and lists sessions with a new-terminal item at the bottom', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const { onNew, render } = renderDropdown(root, [
      {
        key: 't1',
        worktreeTerminalKey: 'repo::worktree',
        terminalId: 't1',
        index: 1,
        title: 'zsh',
        phase: 'open',
        selected: true,
        hasBell: false,
      },
    ])
    await render()

    try {
      const trigger = container.querySelector<HTMLButtonElement>('button')
      await act(async () => {
        trigger?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      })

      // Radix portal renders into document.body
      const menu = document.body.querySelector('[role="menu"]')
      expect(menu).not.toBeNull()
      const items = Array.from(menu?.querySelectorAll('[role="menuitem"]') ?? [])
      expect(items.length).toBe(2)
      expect(items[0]?.textContent).toContain('zsh')
      expect(items[1]?.textContent).toContain('terminal.new')

      await act(async () => {
        ;(items[1] as HTMLElement)?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(onNew).toHaveBeenCalledTimes(1)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test('selects an unselected session from the dropdown', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const { onSelect, onScrollToBottom, render } = renderDropdown(root, [
      {
        key: 't1',
        worktreeTerminalKey: 'repo::worktree',
        terminalId: 't1',
        index: 1,
        title: 'zsh',
        phase: 'open',
        selected: true,
        hasBell: false,
      },
      {
        key: 't2',
        worktreeTerminalKey: 'repo::worktree',
        terminalId: 't2',
        index: 2,
        title: 'node',
        phase: 'open',
        selected: false,
        hasBell: false,
      },
    ])
    await render()

    try {
      const trigger = container.querySelector<HTMLButtonElement>('button')
      await act(async () => {
        trigger?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      })

      const menu = document.body.querySelector('[role="menu"]')
      const items = Array.from(menu?.querySelectorAll('[role="menuitem"]') ?? [])
      // Last item is "new terminal"
      const sessionItem = items.find((item) => item.textContent?.includes('node'))
      expect(sessionItem).toBeDefined()

      await act(async () => {
        ;(sessionItem as HTMLElement)?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(onSelect).toHaveBeenCalledWith('repo::worktree', 't2')
      expect(onScrollToBottom).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test('scrolls to bottom when selecting the already-selected session', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const { onSelect, onScrollToBottom, render } = renderDropdown(root, [
      {
        key: 't1',
        worktreeTerminalKey: 'repo::worktree',
        terminalId: 't1',
        index: 1,
        title: 'zsh',
        phase: 'open',
        selected: true,
        hasBell: false,
      },
    ])
    await render()

    try {
      const trigger = container.querySelector<HTMLButtonElement>('button')
      await act(async () => {
        trigger?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      })

      const menu = document.body.querySelector('[role="menu"]')
      const item = menu?.querySelector('[role="menuitem"]')
      expect(item).not.toBeNull()

      await act(async () => {
        ;(item as HTMLElement)?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(onScrollToBottom).toHaveBeenCalledWith('t1')
      expect(onSelect).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test('closes a session without selecting it', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const { onClose, onSelect, render } = renderDropdown(root, [
      {
        key: 't1',
        worktreeTerminalKey: 'repo::worktree',
        terminalId: 't1',
        index: 1,
        title: 'zsh',
        phase: 'open',
        selected: false,
        hasBell: false,
      },
    ])
    await render()

    try {
      const trigger = container.querySelector<HTMLButtonElement>('button')
      await act(async () => {
        trigger?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      })

      const menu = document.body.querySelector('[role="menu"]')
      const closeButton = menu?.querySelector('button[aria-label="terminal.close"]')
      expect(closeButton).not.toBeNull()

      await act(async () => {
        ;(closeButton as HTMLElement)?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(onClose).toHaveBeenCalledWith('t1')
      expect(onSelect).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
