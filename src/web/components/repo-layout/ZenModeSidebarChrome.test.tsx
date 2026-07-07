// @vitest-environment jsdom

import { useState } from 'react'
import { userEvent } from '@testing-library/user-event'
import { act, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { ZenModeSidebarChrome } from '#/web/components/repo-layout/ZenModeSidebarChrome.tsx'
import { TITLE_BAR_HEIGHT_PX } from '#/shared/title-bar-chrome.ts'
import { Popover, PopoverContent, PopoverTrigger } from '#/web/components/ui/popover.tsx'

vi.mock('#/web/components/WorkspaceNavigationControls.tsx', () => ({
  WorkspaceNavigationControls: ({
    zenRevealTriggerEnabled,
    onZenRevealTriggerEnter,
    repoId,
  }: {
    zenRevealTriggerEnabled?: boolean
    onZenRevealTriggerEnter?: () => void
    repoId?: string
  }) => (
    <div data-testid="mock-workspace-navigation-controls" data-repo-id={repoId}>
      <span data-testid="mock-zen-reveal-surface" data-zen-reveal-surface={zenRevealTriggerEnabled ? '' : undefined}>
        <button type="button" data-testid="zen-mode-sidebar-trigger" onMouseEnter={onZenRevealTriggerEnter}>
          zen
        </button>
      </span>
      <button type="button" disabled>
        back
      </button>
      <button type="button" disabled>
        forward
      </button>
    </div>
  ),
}))

beforeEach(() => {
  const win = window as typeof window & {
    PointerEvent?: typeof PointerEvent
    requestAnimationFrame?: typeof requestAnimationFrame
    cancelAnimationFrame?: typeof cancelAnimationFrame
  }
  win.PointerEvent ??= MouseEvent as unknown as typeof PointerEvent
  globalThis.PointerEvent ??= win.PointerEvent
  win.requestAnimationFrame ??= (callback: FrameRequestCallback) => window.setTimeout(callback, 0)
  win.cancelAnimationFrame ??= (id: number) => window.clearTimeout(id)
  globalThis.requestAnimationFrame ??= win.requestAnimationFrame
  globalThis.cancelAnimationFrame ??= win.cancelAnimationFrame
})

describe('ZenModeSidebarChrome', () => {
  test('uses the zen control as the reveal trigger surface', () => {
    const { container } = renderInJsdom(
      <ZenModeSidebarChrome
        repoId="/tmp/repo"
        zenModeToggleEnabled
        revealEnabled
        sidebarSize={36}
        onSidebarSizeChange={() => {}}
        sidebarPane={mockSidebarPane()}
      />,
    )

    const controls = screen.getByTestId('mock-workspace-navigation-controls')
    const zenSurface = screen.getByTestId('mock-zen-reveal-surface')
    expect(controls.dataset.repoId).toBe('/tmp/repo')
    expect(controls.hasAttribute('data-zen-reveal-surface')).toBe(false)
    expect(zenSurface.hasAttribute('data-zen-reveal-surface')).toBe(true)
    expect(controls.closest('[data-title-bar-chrome-region="interactive"]')).not.toBeNull()
    act(() => {
      screen.getByTestId('zen-mode-sidebar-trigger').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')
  })

  test('reveals from the left-edge hit area below the draggable titlebar', () => {
    const { container } = renderInJsdom(
      <ZenModeSidebarChrome
        repoId="/tmp/repo"
        zenModeToggleEnabled
        revealEnabled
        sidebarSize={36}
        onSidebarSizeChange={() => {}}
        sidebarPane={mockSidebarPane()}
      />,
    )

    const hitArea = zenModeSidebarHitArea(container)
    expect(hitArea?.className).toContain('pointer-events-auto')
    expect(hitArea?.style.top).toBe(`${TITLE_BAR_HEIGHT_PX}px`)
    expect(hitArea?.hasAttribute('data-interactive')).toBe(false)
    expect(hitArea?.dataset.titleBarChromeRegion).toBeUndefined()
    expect(hitArea?.hasAttribute('data-zen-reveal-surface')).toBe(false)

    act(() => {
      hitArea?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')
  })

  test('uses a top-level drag plate for the revealed sidebar titlebar', () => {
    renderInJsdom(
      <ZenModeSidebarChrome
        repoId="/tmp/repo"
        zenModeToggleEnabled
        revealEnabled
        sidebarSize={36}
        onSidebarSizeChange={() => {}}
        sidebarPane={mockSidebarPane()}
      />,
    )

    expect(screen.queryByTestId('zen-mode-sidebar-drag-plate')).toBeNull()

    act(() => {
      screen.getByTestId('zen-mode-sidebar-trigger').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    const dragPlate = screen.getByTestId('zen-mode-sidebar-drag-plate')
    expect(dragPlate.dataset.titleBarChromeRegion).toBe('drag')
    expect(dragPlate.hasAttribute('data-interactive')).toBe(false)
    expect(dragPlate.hasAttribute('data-zen-reveal-surface')).toBe(true)
    expect(dragPlate.className).toContain('pointer-events-auto')
    expect(dragPlate.style.height).toBe(`${TITLE_BAR_HEIGHT_PX}px`)
  })

  test('keeps the resize visual full-height while the hit target stays below the draggable reveal titlebar', () => {
    renderInJsdom(
      <ZenModeSidebarChrome
        repoId="/tmp/repo"
        zenModeToggleEnabled
        revealEnabled
        sidebarSize={36}
        onSidebarSizeChange={() => {}}
        sidebarPane={mockSidebarPane()}
      />,
    )

    act(() => {
      screen.getByTestId('zen-mode-sidebar-trigger').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    const resizeVisual = screen.getByTestId('zen-mode-sidebar-resize-visual')
    const resizeHandle = screen.getByTestId('zen-mode-sidebar-resize-handle')
    expect(resizeVisual.className).toContain('pointer-events-none')
    expect(resizeVisual.className).toContain('inset-y-0')
    expect(resizeVisual.dataset.titleBarChromeRegion).toBeUndefined()
    expect(resizeVisual.hasAttribute('data-interactive')).toBe(false)
    expect(resizeVisual.querySelector('span')).not.toBeNull()
    expect(resizeHandle.dataset.titleBarChromeRegion).toBe('interactive')
    expect(resizeHandle.style.top).toBe(`${TITLE_BAR_HEIGHT_PX}px`)
    expect(resizeHandle.style.height).toBe(`calc(100% - ${TITLE_BAR_HEIGHT_PX}px)`)
  })

  test('forwards route actions to the revealed sidebar controls', async () => {
    const user = userEvent.setup()
    const onOpenDashboard = vi.fn()
    const onCreateWorktree = vi.fn()
    const onSelectBranch = vi.fn()
    renderInJsdom(
      <ZenModeSidebarChrome
        repoId="/tmp/repo"
        zenModeToggleEnabled
        revealEnabled
        sidebarSize={36}
        onSidebarSizeChange={() => {}}
        sidebarPane={mockSidebarPane({
          onOpenDashboard,
          onCreateWorktree,
          onSelectBranch,
          dashboardSelected: true,
          newWorktreeSelected: true,
          currentBranchName: 'feature/a',
        })}
      />,
    )

    act(() => {
      screen.getByTestId('zen-mode-sidebar-trigger').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    const sidebar = screen.getByTestId('mock-sidebar')
    expect(sidebar.dataset.dashboardSelected).toBe('true')
    expect(sidebar.dataset.newWorktreeSelected).toBe('true')
    expect(sidebar.dataset.currentBranchName).toBe('feature/a')

    await user.click(screen.getByTestId('mock-dashboard-action'))
    await user.click(screen.getByTestId('mock-create-worktree-action'))
    await user.click(screen.getByTestId('mock-branch-action'))

    expect(onOpenDashboard).toHaveBeenCalledTimes(1)
    expect(onCreateWorktree).toHaveBeenCalledTimes(1)
    expect(onSelectBranch).toHaveBeenCalledWith('feature/a')
  })

  test('keeps the reveal open while a descendant Popover is open', async () => {
    const user = userEvent.setup()
    const { container } = renderInJsdom(
      <ZenModeSidebarChrome
        repoId="/tmp/repo"
        zenModeToggleEnabled
        revealEnabled
        sidebarSize={36}
        onSidebarSizeChange={() => {}}
        sidebarPane={mockSidebarPane()}
      />,
    )

    act(() => {
      screen.getByTestId('zen-mode-sidebar-trigger').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')

    await user.click(screen.getByTestId('descendant-popover-trigger'))
    await waitFor(() => {
      expect(screen.queryByTestId('descendant-popover-content')).not.toBeNull()
    })

    act(() => {
      zenModeSidebarReveal(container)?.dispatchEvent(
        new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }),
      )
      document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 900, clientY: 24 }))
    })
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')

    const closedFloatingSurface = document.createElement('div')
    closedFloatingSurface.setAttribute('data-floating-surface', '')
    closedFloatingSurface.setAttribute('data-state', 'closed')
    document.body.appendChild(closedFloatingSurface)
    const originalElementFromPoint = document.elementFromPoint
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => closedFloatingSurface,
    })

    try {
      await user.click(screen.getByRole('button', { name: 'Close descendant menu' }))
      await waitFor(() => {
        expect(screen.queryByTestId('descendant-popover-content')).toBeNull()
      })

      await waitFor(() => {
        expect(zenModeSidebarReveal(container)?.dataset.open).toBe('false')
      })
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      })
      closedFloatingSurface.remove()
    }
  })
})

function zenModeSidebarHitArea(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="zen-mode-sidebar-hit-area"]')
}

function zenModeSidebarReveal(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="zen-mode-sidebar-reveal"]')
}

interface MockSidebarProps {
  onOpenDashboard?: () => void
  onCreateWorktree?: () => void
  onSelectBranch?: (branch: string) => void
  dashboardSelected?: boolean
  newWorktreeSelected?: boolean
  currentBranchName?: string | null
}

function mockSidebarPane(props: MockSidebarProps = {}) {
  return <MockSidebar {...props} />
}

function MockSidebar({
  onOpenDashboard,
  onCreateWorktree,
  onSelectBranch,
  dashboardSelected = false,
  newWorktreeSelected = false,
  currentBranchName,
}: MockSidebarProps) {
  const [open, setOpen] = useState(false)

  return (
    <div
      data-testid="mock-sidebar"
      data-dashboard-selected={String(dashboardSelected)}
      data-new-worktree-selected={String(newWorktreeSelected)}
      data-current-branch-name={currentBranchName ?? ''}
    >
      <button type="button" data-testid="mock-dashboard-action" onClick={onOpenDashboard}>
        Dashboard
      </button>
      <button type="button" data-testid="mock-create-worktree-action" onClick={onCreateWorktree}>
        Create worktree
      </button>
      <button type="button" data-testid="mock-branch-action" onClick={() => onSelectBranch?.('feature/a')}>
        Open branch
      </button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" data-testid="descendant-popover-trigger">
            Open descendant menu
          </button>
        </PopoverTrigger>
        <PopoverContent>
          <div data-testid="descendant-popover-content">Descendant menu</div>
          <button type="button" onClick={() => setOpen(false)}>
            Close descendant menu
          </button>
        </PopoverContent>
      </Popover>
    </div>
  )
}
