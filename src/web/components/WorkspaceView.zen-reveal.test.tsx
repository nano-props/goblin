// @vitest-environment jsdom

import { act, cleanup } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import '#/web/test-utils/workspace-view.tsx'
import { useFakeTimers } from '#/test-utils/timers.ts'
import { WorkspaceView } from '#/web/components/WorkspaceView.tsx'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'
import {
  REPO_ID,
  branchWorkspaceView,
  render,
  workspaceLayout,
  zenModeSidebarHitArea,
  zenModeSidebarDragPlate,
  zenModeSidebarLayer,
  zenModeSidebarReveal,
  zenModeSidebarResizeHandle,
  zenModeSidebarTrigger,
  zenModeSidebarTriggerSurface,
  workspaceNavigationControls,
  zenModeToggleOverlay,
  mockZenRevealLayout,
} from '#/web/test-utils/workspace-view.tsx'

describe('WorkspaceView Zen reveal', () => {
  test('large-screen collapsed Zen Mode reveals the sidebar on left-edge hover below the titlebar', () => {
    useWorkspacesStore.getState().setZenMode(true)
    useWorkspacesStore.getState().setWorkspacePaneSize(55)
    const { container } = render(branchWorkspaceView())

    const reveal = zenModeSidebarReveal(container)
    expect(reveal).not.toBeNull()
    expect(reveal?.dataset.open).toBe('false')
    expect(reveal?.dataset.state).toBe('closed')
    expect(zenModeSidebarLayer(container)?.className).toContain('right-0')
    expect(reveal?.className).not.toContain('border-r')
    expect(reveal?.getAttribute('aria-hidden')).toBe('true')
    expect(reveal?.hasAttribute('inert')).toBe(true)

    act(() => {
      zenModeSidebarHitArea(container)?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    expect(zenModeSidebarHitArea(container)?.hasAttribute('data-zen-reveal-surface')).toBe(false)
    expect(zenModeSidebarHitArea(container)?.hasAttribute('data-interactive')).toBe(false)
    expect(zenModeSidebarHitArea(container)?.dataset.titleBarChromeRegion).toBeUndefined()
    expect(zenModeSidebarHitArea(container)?.className).toContain('pointer-events-auto')
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')
    expect(
      workspaceNavigationControls(container)?.closest('[data-title-bar-chrome-region="interactive"]'),
    ).not.toBeNull()
    expect(zenModeSidebarTrigger(container)?.tagName).toBe('BUTTON')
  })

  test('large-screen collapsed Zen Mode reveals the sidebar when the zen toggle is hovered', () => {
    useWorkspacesStore.getState().setZenMode(true)
    const { container } = render(branchWorkspaceView())

    const revealLayer = zenModeSidebarLayer(container)
    const toggleOverlay = zenModeToggleOverlay(container)
    expect(zenModeToggleOverlay(container)?.hasAttribute('data-interactive')).toBe(false)
    expect(zenModeToggleOverlay(container)?.dataset.titleBarChromeRegion).toBeUndefined()
    expect(zenModeToggleOverlay(container)?.hasAttribute('data-zen-reveal-surface')).toBe(false)
    expect(zenModeToggleOverlay(container)?.className).toContain('goblin-zen-reveal-trigger-layer')
    expect(zenModeToggleOverlay(container)?.className).toContain('z-40')
    expect(zenModeToggleOverlay(container)?.className).not.toContain('title-bar-chrome')
    expect(zenModeToggleOverlay(container)?.className).not.toContain('app-drag-region')
    expect(revealLayer).not.toBeNull()
    expect(toggleOverlay).not.toBeNull()
    expect(revealLayer!.compareDocumentPosition(toggleOverlay!) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(
      workspaceNavigationControls(container)?.closest('[data-title-bar-chrome-region="interactive"]'),
    ).not.toBeNull()
    expect(workspaceNavigationControls(container)?.hasAttribute('data-zen-reveal-surface')).toBe(false)
    expect(zenModeSidebarTriggerSurface(container)?.hasAttribute('data-zen-reveal-surface')).toBe(true)
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('false')

    act(() => {
      zenModeSidebarTrigger(container)?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')
    expect(zenModeToggleOverlay(container)?.className).toContain('z-40')
    expect(zenModeToggleOverlay(container)?.className).not.toContain('z-20')
    expect(zenModeSidebarReveal(container)?.dataset.panelInteractive).toBe('true')
    expect(zenModeSidebarReveal(container)?.hasAttribute('data-interactive')).toBe(false)
    expect(zenModeSidebarReveal(container)?.getAttribute('aria-hidden')).toBeNull()
    expect(zenModeSidebarReveal(container)?.hasAttribute('inert')).toBe(false)
    const dragPlate = zenModeSidebarDragPlate(container)
    expect(dragPlate?.dataset.titleBarChromeRegion).toBe('drag')
    expect(dragPlate?.hasAttribute('data-interactive')).toBe(false)
    expect(dragPlate?.hasAttribute('data-zen-reveal-surface')).toBe(true)
    expect(dragPlate?.className).toContain('pointer-events-auto')
    expect(
      zenModeSidebarReveal(container)!.compareDocumentPosition(dragPlate!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    const floatingSidebarTop = zenModeSidebarReveal(container)?.querySelector<HTMLElement>(
      '[data-testid="workspace-shell-sidebar-top"]',
    )
    expect(floatingSidebarTop?.hasAttribute('data-interactive')).toBe(false)
    expect(floatingSidebarTop?.dataset.titleBarChromeRegion).toBeUndefined()
    expect(floatingSidebarTop?.querySelector('[data-title-bar-chrome-region="no-drag"]')).toBeNull()
  })

  test('large-screen collapsed Zen Mode opens the dashboard from the revealed sidebar', () => {
    const onOpenWorkspaceDashboard = vi.fn()
    useWorkspacesStore.getState().setZenMode(true)
    const { container } = render(
      <WorkspaceView
        workspaceId={REPO_ID}
        routeView={{ kind: 'branch', workspaceId: REPO_ID, branchName: 'feature/a', workspacePaneRoute: null }}
        onOpenWorkspaceDashboard={onOpenWorkspaceDashboard}
      />,
    )

    act(() => {
      zenModeSidebarTrigger(container)?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    const revealedDashboardAction =
      zenModeSidebarReveal(container)?.querySelector<HTMLButtonElement>('[data-testid="dashboard-row-action"]') ?? null
    expect(revealedDashboardAction).not.toBeNull()

    act(() => {
      revealedDashboardAction?.click()
    })

    expect(onOpenWorkspaceDashboard).toHaveBeenCalledWith(REPO_ID)
    expect(onOpenWorkspaceDashboard).toHaveBeenCalledTimes(1)
  })

  test('large-screen collapsed Zen Mode keeps the sidebar open across the title-bar-chrome reveal surface', () => {
    useWorkspacesStore.getState().setZenMode(true)
    const { container } = render(branchWorkspaceView())

    act(() => {
      zenModeSidebarTrigger(container)?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')

    mockZenRevealLayout(container, {
      panelLeft: -14,
      panelWidth: 360,
    })

    act(() => {
      zenModeSidebarReveal(container)?.dispatchEvent(
        new MouseEvent('mouseout', {
          bubbles: true,
          relatedTarget: zenModeSidebarTriggerSurface(container),
          clientX: 355,
          clientY: 24,
        }),
      )
      zenModeSidebarTriggerSurface(container)?.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, clientX: 355, clientY: 24 }),
      )
    })

    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')
  })

  test('large-screen collapsed Zen Mode does not close from the trigger mouseout alone', () => {
    useWorkspacesStore.getState().setZenMode(true)
    const { container } = render(branchWorkspaceView())

    const toggle = zenModeSidebarTrigger(container)
    act(() => {
      toggle?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')

    act(() => {
      toggle?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
    })
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')

    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 800, clientY: 24 }))
    })
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('false')
  })

  test('large-screen collapsed Zen Mode stays open while the pointer remains on the zen trigger', () => {
    useWorkspacesStore.getState().setZenMode(true)
    const { container } = render(branchWorkspaceView())

    const trigger = zenModeSidebarTrigger(container)
    expect(workspaceNavigationControls(container)?.hasAttribute('data-zen-reveal-surface')).toBe(false)
    expect(zenModeSidebarTriggerSurface(container)?.hasAttribute('data-zen-reveal-surface')).toBe(true)

    act(() => {
      trigger?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      trigger?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
    })

    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')
  })

  test('large-screen collapsed Zen Mode opens reveal on first trigger hover', () => {
    const { container } = render(branchWorkspaceView())

    act(() => {
      useWorkspacesStore.getState().setZenMode(true)
    })

    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('false')

    const trigger = zenModeSidebarTrigger(container)
    act(() => {
      trigger?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')
  })

  test('large-screen collapsed Zen Mode stays open while moving from trigger into the revealed sidebar', () => {
    useWorkspacesStore.getState().setZenMode(true)
    const { container } = render(branchWorkspaceView())

    const toggle = zenModeSidebarTrigger(container)
    act(() => {
      toggle?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')

    const reveal = zenModeSidebarReveal(container)
    act(() => {
      toggle?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: reveal }))
      reveal?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')

    act(() => {
      zenModeSidebarReveal(container)?.dispatchEvent(
        new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }),
      )
    })

    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('false')
  })

  test('large-screen collapsed Zen Mode stays open while pointer moves into a portal floating surface', () => {
    const floatingSurface = document.createElement('div')
    floatingSurface.setAttribute('data-floating-surface', '')
    document.body.appendChild(floatingSurface)

    try {
      useWorkspacesStore.getState().setZenMode(true)
      const { container } = render(branchWorkspaceView())

      act(() => {
        zenModeSidebarTrigger(container)?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      })
      expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')

      act(() => {
        zenModeSidebarReveal(container)?.dispatchEvent(
          new MouseEvent('mouseout', { bubbles: true, relatedTarget: floatingSurface }),
        )
        floatingSurface.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
      })

      expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')

      act(() => {
        document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
      })

      expect(zenModeSidebarReveal(container)?.dataset.open).toBe('false')
    } finally {
      floatingSurface.remove()
    }
  })

  test('large-screen collapsed Zen Mode stays open when pointer coordinates remain inside the reveal', () => {
    useWorkspacesStore.getState().setZenMode(true)
    const { container } = render(branchWorkspaceView())

    act(() => {
      zenModeSidebarTrigger(container)?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')

    mockZenRevealLayout(container, {
      panelLeft: -14,
      panelWidth: 360,
    })

    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 355, clientY: 24 }))
    })

    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')
  })

  test('large-screen collapsed Zen Mode resizes the same sidebar width state from the reveal edge', () => {
    useWorkspacesStore.getState().setZenMode(true)
    useWorkspacesStore.getState().setWorkspacePaneSize(70)
    const { container } = render(branchWorkspaceView())

    Object.defineProperty(container.firstElementChild!, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, width: 1000, top: 0, right: 1000, bottom: 800, height: 800 }),
    })

    act(() => {
      zenModeSidebarTrigger(container)?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    act(() => {
      zenModeSidebarResizeHandle(container)?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, clientX: 420, pointerId: 1 }),
      )
    })

    expect(zenModeSidebarResizeHandle(container)?.dataset.separator).toBe('active')

    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 420, pointerId: 1 }))
    })

    expect(useWorkspacesStore.getState().workspacePaneSize).toBe(58)
    expect(zenModeSidebarResizeHandle(container)?.dataset.separator).toBeUndefined()
  })

  test('large-screen collapsed Zen Mode cleans resize listeners if the reveal unmounts mid-drag', () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    useWorkspacesStore.getState().setZenMode(true)
    const result = render(branchWorkspaceView())

    Object.defineProperty(result.container.firstElementChild!, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, width: 1000, top: 0, right: 1000, bottom: 800, height: 800 }),
    })

    act(() => {
      zenModeSidebarTrigger(result.container)?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    act(() => {
      zenModeSidebarResizeHandle(result.container)?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, clientX: 420, pointerId: 1 }),
      )
    })

    expect(zenModeSidebarResizeHandle(result.container)?.dataset.separator).toBe('active')

    act(() => {
      cleanup()
    })

    expect(removeEventListener).toHaveBeenCalledWith('pointermove', expect.any(Function))
    expect(removeEventListener).toHaveBeenCalledWith('pointerup', expect.any(Function))
    expect(removeEventListener).toHaveBeenCalledWith('pointercancel', expect.any(Function))
  })

  test('large-screen collapsed Zen Mode keeps the open reveal mounted while zen mode exits', () => {
    useFakeTimers()
    useWorkspacesStore.getState().setZenMode(true)
    const { container } = render(branchWorkspaceView())

    act(() => {
      zenModeSidebarTrigger(container)?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')

    act(() => {
      useWorkspacesStore.getState().setZenMode(false)
    })

    expect(workspaceLayout(container)?.dataset.sidebarCollapsed).toBe('false')
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')
    expect(zenModeSidebarReveal(container)?.dataset.panelInteractive).toBe('false')
    expect(zenModeSidebarReveal(container)?.hasAttribute('data-interactive')).toBe(false)
    expect(zenModeSidebarReveal(container)?.getAttribute('aria-hidden')).toBe('true')
    expect(zenModeSidebarReveal(container)?.hasAttribute('inert')).toBe(true)
    const retainedSidebarTop = zenModeSidebarReveal(container)?.querySelector<HTMLElement>(
      '[data-testid="workspace-shell-sidebar-top"]',
    )
    expect(retainedSidebarTop?.dataset.titleBarChromeRegion).toBeUndefined()
    expect(retainedSidebarTop?.querySelector('[data-title-bar-chrome-region="no-drag"]')).toBeNull()

    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
      vi.advanceTimersByTime(WORKSPACE_PANE_TRANSITION_MS - 1)
    })
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(zenModeSidebarReveal(container)).toBeNull()
  })

  test('large-screen collapsed Zen Mode does not reopen the reveal while zen mode is exiting', () => {
    useFakeTimers()
    useWorkspacesStore.getState().setZenMode(true)
    const { container } = render(branchWorkspaceView())

    act(() => {
      zenModeSidebarTrigger(container)?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')

    mockZenRevealLayout(container, { panelLeft: 0, panelWidth: 360 })

    act(() => {
      useWorkspacesStore.getState().setZenMode(false)
    })

    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')
    expect(zenModeSidebarReveal(container)?.dataset.panelInteractive).toBe('false')
    expect(zenModeSidebarReveal(container)?.hasAttribute('data-interactive')).toBe(false)
    expect(zenModeSidebarHitArea(container)?.className).toContain('pointer-events-none')

    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 120, clientY: 24 }))
      vi.advanceTimersByTime(WORKSPACE_PANE_TRANSITION_MS)
    })

    expect(zenModeSidebarReveal(container)).toBeNull()
  })
})
