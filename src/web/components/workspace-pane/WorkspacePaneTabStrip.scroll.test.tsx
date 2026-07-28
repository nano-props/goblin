// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, test, vi } from 'vitest'
import {
  TestWorkspacePaneTabStrip,
  render,
  rerender,
  session,
  setTabStripScrollGeometry,
  scrollIntoViewMock,
  workspacePaneTabScrollTarget,
  workspacePaneTabViewport,
} from '#/web/test-utils/workspace-pane-tab-strip.tsx'

describe('WorkspacePaneTabStrip scroll', () => {
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

  test('positions the active tab without animation on initial mount', () => {
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
    expect(scrollIntoView).toHaveBeenLastCalledWith({ inline: 'end', block: 'nearest', behavior: 'auto' })
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

  test('positions an unseen workspace tab target without animation', () => {
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

    const newButton = document.body.querySelector('[data-workspace-pane-new-button]')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(newButton)
    expect(scrollIntoView).toHaveBeenLastCalledWith({ inline: 'end', block: 'nearest', behavior: 'auto' })
  })

  test('positions a delayed active tab without animation after the target changes', () => {
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

    const newButton = document.body.querySelector('[data-workspace-pane-new-button]')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(newButton)
    expect(scrollIntoView).toHaveBeenLastCalledWith({ inline: 'end', block: 'nearest', behavior: 'auto' })
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
})
