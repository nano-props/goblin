// @vitest-environment jsdom

import { flushTestUpdates } from '#/test-utils/render.tsx'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { WorkspacePaneTabStrip } from '#/web/components/workspace-pane/WorkspacePaneTabStrip.tsx'
import { createRuntimeWorkspacePaneTabItem } from '#/web/components/workspace-pane/workspace-pane-tab-types.ts'
import { terminalWorkspacePaneTabProvider } from '#/web/workspace-pane/tab-providers.ts'
import type { TerminalSessionSummary } from '#/web/components/terminal/types.ts'
import { TestWorkspacePaneTabStrip, flushTimers, render, session } from '#/web/test-utils/workspace-pane-tab-strip.tsx'

describe('WorkspacePaneTabStrip presentation and interaction', () => {
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

    await flushTestUpdates(() => {
      tab.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }))
    })
    await flushTimers()

    const tooltip = document.body.querySelector('[role="tooltip"]')
    expect(tooltip?.textContent).toContain('~/repo/worktree — npm run dev')
    expect(tooltip?.textContent).not.toContain('node')
    expect(tooltip?.textContent).not.toContain('~/Developer/goblin')
  })

  test('blocks tab switching and closing while terminal creation is pending', async () => {
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
    const activeClose = document.body.querySelector<HTMLElement>(
      '[data-toolbar-tab-close-action][title="close term-1"]',
    )
    const inactiveClose = document.body.querySelector<HTMLElement>(
      '[data-toolbar-tab-close-action][title="close term-2"]',
    )
    expect(inactiveTab).not.toBeNull()
    expect(inactiveTab?.disabled).toBe(true)
    expect(activeClose).not.toBeNull()
    expect(activeClose?.dataset.disabled).toBe('true')
    expect(activeClose?.className).toContain('opacity-100')
    expect(activeClose?.className).toContain('ml-auto')
    expect(inactiveClose).not.toBeNull()
    expect(inactiveClose?.dataset.disabled).toBe('true')
    expect(inactiveClose?.className).toContain('opacity-0')
    expect(inactiveClose?.className).not.toContain('group-hover:opacity-100')

    await flushTestUpdates(() => {
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
    const closePlaceholder = pendingTab?.querySelector<HTMLElement>('[data-toolbar-tab-close-placeholder]')
    expect(closePlaceholder).not.toBeNull()
    expect(closePlaceholder?.className).toContain('ml-auto')
    expect(pendingTab?.querySelector('button[aria-label^="close "]')).toBeNull()
  })

  test('keeps all terminal tabs visible in a horizontal scroll area when not in compact mode', async () => {
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
    const inactiveCloseButton = document.body.querySelector<HTMLElement>(
      '[data-toolbar-tab-close-action][title="close term-2"]',
    )
    expect(inactiveCloseButton?.className).toContain('shrink-0')
    expect(inactiveCloseButton?.className).toContain('before:-inset-x-1.5')
    expect(inactiveCloseButton?.className).toContain('before:-inset-y-1')
    expect(inactiveCloseButton?.className).toContain('pointer-events-none')
    expect(inactiveCloseButton?.className).toContain('group-hover:pointer-events-auto')
    expect(tablist?.querySelectorAll('button:not([role="tab"])')).toHaveLength(0)
    const firstTab = document.body.querySelector('#workspace-workspace-pane-tab')
    expect(firstTab?.getAttribute('aria-keyshortcuts')).toBe('Delete')
    expect(firstTab?.getAttribute('aria-posinset')).toBe('1')
    expect(firstTab?.getAttribute('aria-setsize')).toBe('3')
  })

  test('uses the last tab separator for the new terminal boundary while hovering new terminal', async () => {
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

    await flushTestUpdates(() => {
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

  test('moves focus across the full terminal tab strip and only navigates out at arrow-key edges', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
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

    tab1.focus()
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(tab2)
    expect(onNavigateOut).not.toHaveBeenCalled()

    tab3.focus()
    await user.keyboard('{ArrowRight}')
    expect(onNavigateOut).toHaveBeenNthCalledWith(1, 'next')

    tab2.focus()
    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(tab1)

    tab2.focus()
    await user.keyboard('{End}')
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
