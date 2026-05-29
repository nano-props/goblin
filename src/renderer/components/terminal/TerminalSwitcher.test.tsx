// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { TerminalSwitcher } from '#/renderer/components/terminal/TerminalSwitcher.tsx'

vi.mock('#/renderer/components/ui/scroll-area.tsx', () => ({
  ScrollArea: ({
    children,
    className,
  }: {
    children: React.ReactNode
    className?: string
    viewportClassName?: string
  }) => <div className={className}>{children}</div>,
}))

vi.mock('#/renderer/stores/i18n.ts', () => ({
  useT: () => (key: string) => key,
}))

afterEach(() => {
  document.body.innerHTML = ''
})

describe('TerminalSwitcher', () => {
  test('keeps close actions isolated from select clicks', async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    const onNew = vi.fn()
    const onSelect = vi.fn()
    const onClose = vi.fn()

    await act(async () => {
      root.render(
        <TerminalSwitcher
          groupKey="repo::worktree"
          offsetForSearch={false}
          sessions={[
            {
              key: 'terminal-1',
              groupKey: 'repo::worktree',
              terminalId: 'terminal-1',
              index: 1,
              title: 'zsh',
              phase: 'open',
              active: true,
              hasBell: false,
            },
            {
              key: 'terminal-2',
              groupKey: 'repo::worktree',
              terminalId: 'terminal-2',
              index: 2,
              title: 'node',
              phase: 'open',
              active: false,
              hasBell: true,
            },
          ]}
          onNew={onNew}
          onSelect={onSelect}
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
      expect(onNew).not.toHaveBeenCalled()
      expect(container.querySelector('.goblin-terminal-switcher__badge')?.textContent).toBe('1')
      expect(container.querySelectorAll('.goblin-terminal-switcher__bell-dot')).toHaveLength(1)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
})
