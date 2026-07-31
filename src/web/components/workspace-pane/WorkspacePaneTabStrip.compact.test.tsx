// @vitest-environment jsdom

import { act, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, test, vi } from 'vitest'
import {
  TestWorkspacePaneTabStrip,
  appendTerminalFocusTarget,
  flushTimers,
  openCompactSwitcher,
  render,
  rerender,
  session,
  scrollIntoViewMock,
} from '#/web/test-utils/workspace-pane-tab-strip.tsx'

describe('WorkspacePaneTabStrip compact', () => {
  test('keeps the selected terminal in the collapsed popover list and still offers new terminal', () => {
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

    openCompactSwitcher(trigger)

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

  test('disables the collapsed new-terminal action while terminal creation is busy', () => {
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

    openCompactSwitcher(trigger)

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
    openCompactSwitcher(trigger)
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
    openCompactSwitcher(trigger)
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
    openCompactSwitcher(trigger)
    const content = document.body.querySelector<HTMLElement>('[data-slot="popover-content"]')
    if (!content) throw new Error('missing terminal popover content')

    vi.useRealTimers()
    const user = userEvent.setup()
    content.focus()
    await user.keyboard('{Escape}')

    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  test('blocks compact popover tab switching while terminal creation is pending', () => {
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

    openCompactSwitcher(trigger)

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

  test('collapsed terminal tab only navigates out on arrow keys', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
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

    tab.focus()
    await user.keyboard('{ArrowLeft}{ArrowRight}{Home}{End}')

    expect(onNavigateOut.mock.calls).toEqual([['prev'], ['next']])
    expect(document.activeElement).toBe(tab)
    expect(tab.getAttribute('aria-posinset')).toBeNull()
    expect(tab.getAttribute('aria-setsize')).toBeNull()
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
    // Compact UI delegates closing to the adjacent tab switcher, leaving the
    // selected tab's full trailing width available to its title.
    const compactCloseButton = compactTab?.querySelector('button[aria-label="close term-1"]')
    expect(compactCloseButton).toBeNull()
    expect(compactTab?.querySelector('[data-toolbar-tab-close-placeholder]')).toBeNull()
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

  test('keeps the compact tab visually unselected and free of close chrome when its panel is active', () => {
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
    // The active panel makes isActive=true, while compact chrome remains muted
    // and leaves closing to the adjacent tab switcher.
    expect(compactTab?.className).not.toContain('bg-selected')
    const compactCloseButton = compactTab?.querySelector('button[aria-label="close term-1"]')
    expect(compactCloseButton).toBeNull()
    expect(compactTab?.querySelector('[data-toolbar-tab-close-placeholder]')).toBeNull()
  })

  test('closes the active compact tab through the tab switcher', async () => {
    function CompactCloseHarness() {
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

    render(<CompactCloseHarness />)
    const compactTab = document.body.querySelector('[data-workspace-pane-tab-tooltip-id]')
    expect(compactTab?.querySelector('button[aria-label="close term-1"]')).toBeNull()

    const trigger = document.body.querySelector('button[aria-label="workspace-pane-tabs.tabs"]')
    if (!(trigger instanceof HTMLButtonElement)) throw new Error('missing terminal popover trigger')
    openCompactSwitcher(trigger)

    const list = document.body.querySelector('[role="list"]')
    const closeButton = list?.querySelector<HTMLButtonElement>('button[aria-label="close term-1"]')
    expect(closeButton).not.toBeNull()

    act(() => {
      closeButton?.click()
    })
    await flushTimers()

    expect(compactTab?.textContent).toContain('term-2')
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
})
