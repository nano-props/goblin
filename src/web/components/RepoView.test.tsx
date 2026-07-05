// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { RepoView } from '#/web/components/RepoView.tsx'
import {
  resetReposStore,
  seedRepoShellForTest,
  seedRepoWithReadModelForTest,
  createRepoBranch,
} from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'

const responsiveMocks = vi.hoisted(() => ({
  mode: 'default' as 'default' | 'compact',
}))
const branchNavigatorMocks = vi.hoisted(() => ({
  activate: vi.fn<(repoId: string) => void>(),
}))

vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useResponsiveUiMode: () => responsiveMocks.mode,
}))

vi.mock('#/web/hooks/useRepoToasts.tsx', () => ({
  useRepoToasts: () => {},
}))

vi.mock('#/web/components/BranchNavigator.tsx', () => ({
  BranchNavigator: ({ repoId }: { repoId: string }) => (
    <button
      type="button"
      data-testid="branch-navigator"
      onClick={() => {
        branchNavigatorMocks.activate(repoId)
      }}
    >
      branch
    </button>
  ),
}))

vi.mock('#/web/components/RepoWorkspace.tsx', () => ({
  RepoWorkspace: ({
    currentBranchName,
    shortcutsEnabled = true,
    toolbarTrafficLightOffset = false,
  }: {
    currentBranchName?: string | null
    shortcutsEnabled?: boolean
    toolbarTrafficLightOffset?: boolean
  }) => (
    <div
      data-testid="repo-workspace"
      data-current-branch-name={currentBranchName ?? ''}
      data-shortcuts-enabled={shortcutsEnabled ? 'true' : 'false'}
      data-traffic-light-offset={toolbarTrafficLightOffset ? 'true' : 'false'}
    />
  ),
}))

vi.mock('#/web/components/RepoPickerHost.tsx', () => ({
  RepoPickerHost: () => <div data-testid="repo-picker" />,
}))

vi.mock('#/web/components/repo-toolbar/RepoToolbarActions.tsx', () => ({
  BranchFilterAction: () => <div data-testid="branch-filter-action" />,
  CreateWorktreeRowAction: () => <button data-testid="create-worktree-row-action" type="button" />,
  DashboardRowAction: () => <button data-testid="dashboard-row-action" type="button" />,
  RepoSyncAction: () => <div data-testid="repo-sync-action" />,
}))

vi.mock('#/web/components/WorkspaceZenModeToggle.tsx', () => ({
  WorkspaceZenModeToggle: (props: React.ComponentProps<'button'>) => (
    <button type="button" {...props}>
      zen
    </button>
  ),
}))

vi.mock('#/web/components/Layout.tsx', () => ({
  RepoWorkspace: ({
    mode,
    branchNavigatorCollapsed,
    branchNavigatorPane,
    repoWorkspacePane,
  }: {
    mode?: 'split' | 'single-pane'
    branchNavigatorCollapsed?: boolean
    branchNavigatorPane: React.ReactNode
    repoWorkspacePane: React.ReactNode
  }) => (
    <div
      data-testid="repo-workspace-layout"
      data-mode={mode ?? 'split'}
      data-branch-navigator-collapsed={branchNavigatorCollapsed ? 'true' : 'false'}
    >
      {mode === 'single-pane' ? (
        repoWorkspacePane
      ) : (
        <>
          {branchNavigatorPane}
          {repoWorkspacePane}
        </>
      )}
    </div>
  ),
  RepoWorkspacePane: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CompactRepoWorkspace: ({
    activePane,
    branchNavigatorPane,
    repoWorkspacePane,
  }: {
    activePane: 'navigator' | 'workspace'
    branchNavigatorPane: React.ReactNode
    repoWorkspacePane: React.ReactNode
  }) => (
    <div data-compact-workspace="" data-active-pane={activePane}>
      <div data-compact-workspace-pane="navigator" aria-hidden={activePane === 'workspace' ? 'true' : undefined}>
        {branchNavigatorPane}
      </div>
      <div data-compact-workspace-pane="workspace" aria-hidden={activePane === 'navigator' ? 'true' : undefined}>
        {repoWorkspacePane}
      </div>
    </div>
  ),
  EmptyState: ({ title, body }: { title: React.ReactNode; body?: React.ReactNode }) => (
    <div data-testid="empty-state">
      {title}
      {body}
    </div>
  ),
}))

const REPO_ID = '/tmp/repo-view-test'

function branchRepoView(branchName = 'feature/a') {
  return <RepoView repoId={REPO_ID} routeView={{ kind: 'branch', repoId: REPO_ID, branchName }} />
}

beforeEach(() => {
  responsiveMocks.mode = 'default'
  resetReposStore()
  seedRepoWithReadModelForTest({
    id: REPO_ID,
    branches: [createRepoBranch('main'), createRepoBranch('feature/a')],
    currentBranchName: null,
  })
  branchNavigatorMocks.activate.mockImplementation((repoId) => {
  })
})

afterEach(() => {
  branchNavigatorMocks.activate.mockReset()
  vi.restoreAllMocks()
})

describe('RepoView workspace navigation', () => {
  test('large-screen branch activation keeps the Branch Navigator visible', () => {
    const { container } = render(branchRepoView())

    expect(workspace(container)?.dataset.mode).toBe('split')

    act(() => {
      branchNavigator(container)?.click()
    })

    expect(branchNavigator(container)).not.toBeNull()
    expect(workspace(container)?.dataset.mode).toBe('split')
    expect(repoWorkspace(container)).not.toBeNull()
  })

  test('route branch view does not write current branch into the store before read model is ready', () => {
    resetReposStore()
    seedRepoShellForTest({ id: REPO_ID, currentBranchName: null })

    expect(() =>
      render(<RepoView repoId={REPO_ID} routeView={{ kind: 'branch', repoId: REPO_ID, branchName: 'feature/a' }} />),
    ).not.toThrow()

  })

  test('route branch view uses the URL branch as the displayed workspace branch', () => {
    const { container } = render(
      <RepoView repoId={REPO_ID} routeView={{ kind: 'branch', repoId: REPO_ID, branchName: 'feature/a' }} />,
    )

    expect(repoWorkspace(container)?.dataset.currentBranchName).toBe('feature/a')
  })

  test('route branch view leaves store selection unchanged when read model is ready', () => {
    render(<RepoView repoId={REPO_ID} routeView={{ kind: 'branch', repoId: REPO_ID, branchName: 'feature/a' }} />)

  })

  test('large-screen Zen Mode uses Branch Navigator until a branch opens a collapsed split workspace', () => {
    useReposStore.getState().setZenMode(true)
    const { container, rerender } = render(<RepoView repoId={REPO_ID} />)

    expect(branchNavigator(container)).not.toBeNull()
    expect(repoWorkspace(container)).toBeNull()
    expect(workspace(container)).toBeNull()

    act(() => {
      branchNavigator(container)?.click()
      rerender(branchRepoView())
    })

    expect(branchNavigator(container)).not.toBeNull()
    expect(workspace(container)?.dataset.mode).toBe('split')
    expect(workspace(container)?.dataset.branchNavigatorCollapsed).toBe('true')
    expect(repoWorkspace(container)).not.toBeNull()
    expect(repoWorkspace(container)?.dataset.trafficLightOffset).toBe('true')
    expect(zenModeSidebarTrigger(container)).not.toBeNull()
    const sidebarTops = [...container.querySelectorAll<HTMLElement>('[data-testid="repo-shell-sidebar-top"]')]
    expect(sidebarTops.length).toBeGreaterThan(0)
    const closedRevealTop = zenModeSidebarReveal(container)?.querySelector<HTMLElement>(
      '[data-testid="repo-shell-sidebar-top"]',
    )
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('false')
    expect(zenModeSidebarReveal(container)?.dataset.interactive).toBe('false')
    expect(closedRevealTop?.dataset.titleBarChromeRegion).toBeUndefined()
    expect(closedRevealTop?.querySelector('[data-title-bar-chrome-region="no-drag"]')).toBeNull()
  })

  test('large-screen collapsed Zen Mode reveals the sidebar on left-edge hover', () => {
    useReposStore.getState().setZenMode(true)
    useReposStore.getState().setWorkspacePaneSize(55)
    const { container } = render(branchRepoView())

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

    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')
    expect(zenModeSidebarReveal(container)?.dataset.interactive).toBe('true')
    expect(zenModeSidebarReveal(container)?.getAttribute('aria-hidden')).toBeNull()
    expect(zenModeSidebarReveal(container)?.hasAttribute('inert')).toBe(false)
    const floatingSidebarTop = zenModeSidebarReveal(container)?.querySelector<HTMLElement>(
      '[data-testid="repo-shell-sidebar-top"]',
    )
    expect(floatingSidebarTop?.hasAttribute('data-interactive')).toBe(false)
    expect(floatingSidebarTop?.dataset.titleBarChromeRegion).toBe('drag')
    expect(floatingSidebarTop?.querySelector('[data-title-bar-chrome-region="no-drag"]')).toBeNull()
    expect(zenModeSidebarTrigger(container)?.dataset.titleBarChromeRegion).toBe('interactive')
    expect(zenModeSidebarTrigger(container)?.tagName).toBe('BUTTON')
  })

  test('large-screen collapsed Zen Mode reveals the sidebar when the zen toggle is hovered', () => {
    useReposStore.getState().setZenMode(true)
    const { container } = render(branchRepoView())

    const revealLayer = zenModeSidebarLayer(container)
    const toggleOverlay = zenModeToggleOverlay(container)
    expect(zenModeToggleOverlay(container)?.hasAttribute('data-interactive')).toBe(false)
    expect(zenModeToggleOverlay(container)?.dataset.titleBarChromeRegion).toBeUndefined()
    expect(zenModeToggleOverlay(container)?.hasAttribute('data-zen-reveal-surface')).toBe(true)
    expect(zenModeToggleOverlay(container)?.className).toContain('goblin-zen-reveal-trigger-layer')
    expect(zenModeToggleOverlay(container)?.className).not.toContain('title-bar-chrome')
    expect(zenModeToggleOverlay(container)?.className).not.toContain('app-drag-region')
    expect(revealLayer).not.toBeNull()
    expect(toggleOverlay).not.toBeNull()
    expect(revealLayer!.compareDocumentPosition(toggleOverlay!) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(zenModeSidebarTrigger(container)?.hasAttribute('data-interactive')).toBe(true)
    expect(zenModeSidebarTrigger(container)?.dataset.titleBarChromeRegion).toBe('interactive')
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('false')

    act(() => {
      zenModeSidebarTrigger(container)?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')
  })

  test('large-screen collapsed Zen Mode keeps the sidebar open across the title-bar-chrome reveal surface', () => {
    useReposStore.getState().setZenMode(true)
    const { container } = render(branchRepoView())

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
          relatedTarget: zenModeToggleOverlay(container),
          clientX: 355,
          clientY: 24,
        }),
      )
      zenModeToggleOverlay(container)?.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, clientX: 355, clientY: 24 }),
      )
    })

    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')
  })

  test('large-screen collapsed Zen Mode does not close from the trigger mouseout alone', () => {
    useReposStore.getState().setZenMode(true)
    const { container } = render(branchRepoView())

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
    useReposStore.getState().setZenMode(true)
    const { container } = render(branchRepoView())

    const trigger = zenModeSidebarTrigger(container)
    expect(trigger?.hasAttribute('data-zen-reveal-surface')).toBe(true)

    act(() => {
      trigger?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      trigger?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
    })

    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')
  })

  test('large-screen collapsed Zen Mode opens reveal on first trigger hover', () => {
    const { container } = render(branchRepoView())

    act(() => {
      useReposStore.getState().setZenMode(true)
    })

    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('false')

    const trigger = zenModeSidebarTrigger(container)
    act(() => {
      trigger?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')
  })

  test('large-screen collapsed Zen Mode stays open while moving from trigger into the revealed sidebar', () => {
    useReposStore.getState().setZenMode(true)
    const { container } = render(branchRepoView())

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
      useReposStore.getState().setZenMode(true)
      const { container } = render(branchRepoView())

      act(() => {
        zenModeSidebarHitArea(container)?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
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
    useReposStore.getState().setZenMode(true)
    const { container } = render(branchRepoView())

    act(() => {
      zenModeSidebarHitArea(container)?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
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
    useReposStore.getState().setZenMode(true)
    useReposStore.getState().setWorkspacePaneSize(70)
    const { container } = render(branchRepoView())

    Object.defineProperty(container.firstElementChild!, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, width: 1000, top: 0, right: 1000, bottom: 800, height: 800 }),
    })

    act(() => {
      zenModeSidebarHitArea(container)?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
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

    expect(useReposStore.getState().workspacePaneSize).toBe(58)
    expect(zenModeSidebarResizeHandle(container)?.dataset.separator).toBeUndefined()
  })

  test('large-screen collapsed Zen Mode cleans resize listeners if the reveal unmounts mid-drag', () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    useReposStore.getState().setZenMode(true)
    const result = render(branchRepoView())

    Object.defineProperty(result.container.firstElementChild!, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, width: 1000, top: 0, right: 1000, bottom: 800, height: 800 }),
    })

    act(() => {
      zenModeSidebarHitArea(result.container)?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
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
    vi.useFakeTimers()
    try {
      useReposStore.getState().setZenMode(true)
      const { container } = render(branchRepoView())

      act(() => {
        zenModeSidebarHitArea(container)?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      })
      expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')

      act(() => {
        useReposStore.getState().setZenMode(false)
      })

      expect(workspace(container)?.dataset.branchNavigatorCollapsed).toBe('false')
      expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')
      expect(zenModeSidebarReveal(container)?.dataset.interactive).toBe('false')
      expect(zenModeSidebarReveal(container)?.getAttribute('aria-hidden')).toBe('true')
      expect(zenModeSidebarReveal(container)?.hasAttribute('inert')).toBe(true)
      const retainedSidebarTop = zenModeSidebarReveal(container)?.querySelector<HTMLElement>(
        '[data-testid="repo-shell-sidebar-top"]',
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
    } finally {
      vi.useRealTimers()
    }
  })

  test('large-screen collapsed Zen Mode does not reopen the reveal while zen mode is exiting', () => {
    vi.useFakeTimers()
    try {
      useReposStore.getState().setZenMode(true)
      const { container } = render(branchRepoView())

      act(() => {
        zenModeSidebarHitArea(container)?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      })
      expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')

      mockZenRevealLayout(container, { panelLeft: 0, panelWidth: 360 })

      act(() => {
        useReposStore.getState().setZenMode(false)
      })

      expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')
      expect(zenModeSidebarReveal(container)?.dataset.interactive).toBe('false')
      expect(zenModeSidebarHitArea(container)?.className).toContain('pointer-events-none')

      act(() => {
        document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 120, clientY: 24 }))
        vi.advanceTimersByTime(WORKSPACE_PANE_TRANSITION_MS)
      })

      expect(zenModeSidebarReveal(container)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  test('compact branch activation slides Repo Workspace into the active pane', () => {
    responsiveMocks.mode = 'compact'
    const { container, rerender } = render(<RepoView repoId={REPO_ID} />)

    expect(container.querySelector('[data-testid="repo-shell-sidebar-top"]')).toBeNull()
    expect(zenModeSidebarTrigger(container)).toBeNull()
    expect(compactWorkspace(container)?.dataset.activePane).toBe('navigator')
    expect(compactPane(container, 'navigator')?.getAttribute('aria-hidden')).toBeNull()
    expect(compactPane(container, 'workspace')?.getAttribute('aria-hidden')).toBe('true')

    act(() => {
      branchNavigator(container)?.click()
      rerender(branchRepoView())
    })

    expect(compactWorkspace(container)?.dataset.activePane).toBe('workspace')
    expect(compactPane(container, 'navigator')?.getAttribute('aria-hidden')).toBe('true')
    expect(compactPane(container, 'workspace')?.getAttribute('aria-hidden')).toBeNull()
    expect(repoWorkspace(container)).not.toBeNull()
  })

  test('compact mode derives Repo Workspace from an existing current branch', () => {
    responsiveMocks.mode = 'compact'
    const { container } = render(branchRepoView())

    act(() => {
    })

    expect(compactWorkspace(container)?.dataset.activePane).toBe('workspace')
    expect(compactPane(container, 'navigator')?.getAttribute('aria-hidden')).toBe('true')
    expect(compactPane(container, 'workspace')?.getAttribute('aria-hidden')).toBeNull()
    expect(repoWorkspace(container)).not.toBeNull()
  })

  test('compact back transition keeps the outgoing Repo Workspace content during slide-out', () => {
    vi.useFakeTimers()
    try {
      responsiveMocks.mode = 'compact'
      const { container, rerender } = render(branchRepoView())

      expect(repoWorkspace(container)?.dataset.currentBranchName).toBe('feature/a')
      expect(repoWorkspace(container)?.dataset.shortcutsEnabled).toBe('true')

      act(() => {
        rerender(<RepoView repoId={REPO_ID} />)
      })

      expect(compactWorkspace(container)?.dataset.activePane).toBe('navigator')
      expect(compactPane(container, 'workspace')?.getAttribute('aria-hidden')).toBe('true')
      expect(repoWorkspace(container)?.dataset.currentBranchName).toBe('feature/a')
      expect(repoWorkspace(container)?.dataset.shortcutsEnabled).toBe('false')

      act(() => {
        vi.advanceTimersByTime(WORKSPACE_PANE_TRANSITION_MS)
      })

      expect(repoWorkspace(container)?.dataset.currentBranchName).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  test('large-screen initial loading keeps the workspace pane empty when no branch is selected', () => {
    setSnapshotLoading(REPO_ID)
    const { container } = render(<RepoView repoId={REPO_ID} />)

    expect(workspace(container)?.dataset.mode).toBe('split')
    expect(container.querySelector('[data-testid="repo-picker"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="create-worktree-row-action"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="repo-workspace-empty-skeleton"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="repo-workspace-skeleton"]')).toBeNull()
    expect(container.querySelectorAll('[data-testid="branch-navigator-skeleton-action"]')).toHaveLength(6)
  })

  test('large-screen focused initial loading with current branch keeps floating sidebar reveal available', () => {
    useReposStore.getState().setZenMode(true)
    setSnapshotLoading(REPO_ID)

    const { container } = render(branchRepoView())

    expect(workspace(container)?.dataset.branchNavigatorCollapsed).toBe('true')
    expect(zenModeSidebarReveal(container)).not.toBeNull()
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('false')
  })

  test('large-screen unavailable repo keeps the repo shell chrome available', () => {
    setRepoUnavailable(REPO_ID)
    const { container } = render(branchRepoView())

    expect(workspace(container)?.dataset.mode).toBe('split')
    expect(container.querySelector('[data-testid="repo-picker"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="create-worktree-row-action"]')).not.toBeNull()
    expect(container.querySelector('button[aria-label="app-chrome.settings"]')).not.toBeNull()
    expect(document.body.textContent).toContain('repo-unavailable.title')
  })

  test('large-screen focused unavailable repo with current branch keeps floating sidebar reveal available', () => {
    useReposStore.getState().setZenMode(true)
    setRepoUnavailable(REPO_ID)

    const { container } = render(branchRepoView())

    expect(workspace(container)?.dataset.branchNavigatorCollapsed).toBe('true')
    expect(zenModeSidebarReveal(container)).not.toBeNull()
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('false')
  })

  test('compact initial loading shows the selected Repo Workspace skeleton as the single pane', () => {
    responsiveMocks.mode = 'compact'
    setSnapshotLoading(REPO_ID)

    const { container } = render(branchRepoView())

    expect(workspace(container)).toBeNull()
    expect(container.querySelector('[data-testid="repo-workspace-skeleton"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="repo-workspace-empty-skeleton"]')).toBeNull()
    expect(container.querySelectorAll('[data-testid="branch-navigator-skeleton-action"]')).toHaveLength(0)
  })

  test('resizing from split large-screen mode to compact shows Repo Workspace when a branch is selected', () => {
    const { container, rerender } = render(branchRepoView())

    act(() => {
      branchNavigator(container)?.click()
    })

    expect(branchNavigator(container)).not.toBeNull()
    expect(repoWorkspace(container)).not.toBeNull()

    responsiveMocks.mode = 'compact'
    rerender(branchRepoView())

    expect(compactWorkspace(container)?.dataset.activePane).toBe('workspace')
    expect(compactPane(container, 'navigator')?.getAttribute('aria-hidden')).toBe('true')
    expect(compactPane(container, 'workspace')?.getAttribute('aria-hidden')).toBeNull()
    expect(repoWorkspace(container)).not.toBeNull()
  })
})

function render(element: React.ReactNode) {
  return renderInJsdom(element)
}

function branchNavigator(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('[data-testid="branch-navigator"]')
}

function repoWorkspace(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="repo-workspace"]')
}

function workspace(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="repo-workspace-layout"]')
}

function compactWorkspace(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-compact-workspace]')
}

function compactPane(container: HTMLElement, pane: 'navigator' | 'workspace'): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-compact-workspace-pane="${pane}"]`)
}

function zenModeSidebarHitArea(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="zen-mode-sidebar-hit-area"]')
}

function zenModeSidebarReveal(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="zen-mode-sidebar-reveal"]')
}

function zenModeSidebarLayer(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="zen-mode-sidebar-layer"]')
}

function zenModeSidebarResizeHandle(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="zen-mode-sidebar-resize-handle"]')
}

function zenModeSidebarTrigger(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="zen-mode-sidebar-trigger"]')
}

function zenModeToggleOverlay(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="zen-mode-toggle-overlay"]')
}

function mockZenRevealLayout(
  container: HTMLElement,
  {
    panelLeft = 0,
    panelWidth = 360,
    panelTop = 0,
    panelHeight = 800,
    hostLeft = 0,
    hostTop = 0,
    hostWidth = 1000,
    hostHeight = 800,
  }: {
    panelLeft?: number
    panelWidth?: number
    panelTop?: number
    panelHeight?: number
    hostLeft?: number
    hostTop?: number
    hostWidth?: number
    hostHeight?: number
  },
) {
  const layer = zenModeSidebarLayer(container)
  const reveal = zenModeSidebarReveal(container)
  if (!layer || !reveal) throw new Error('missing zen reveal')

  Object.defineProperty(layer, 'getBoundingClientRect', {
    configurable: true,
    value: () => domRect({ left: hostLeft, top: hostTop, width: hostWidth, height: hostHeight }),
  })
  Object.defineProperty(reveal, 'getBoundingClientRect', {
    configurable: true,
    value: () => domRect({ left: panelLeft, top: panelTop, width: panelWidth, height: panelHeight }),
  })
  Object.defineProperty(reveal, 'offsetWidth', {
    configurable: true,
    value: panelWidth,
  })
}

function domRect({ left, top, width, height }: { left: number; top: number; width: number; height: number }) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }
}

function setSnapshotLoading(repoId: string) {
  const repo = useReposStore.getState().repos[repoId]
  if (!repo) throw new Error(`missing repo ${repoId}`)
  useReposStore.setState({
    repos: {
      [repoId]: {
        ...repo,
        dataLoads: {
          ...repo.dataLoads,
          snapshot: {
            ...repo.dataLoads.snapshot,
            phase: 'loading' as const,
            loadedAt: null,
            error: null,
            stale: false,
          },
        },
      },
    },
  })
}

function setRepoUnavailable(repoId: string) {
  const repo = useReposStore.getState().repos[repoId]
  if (!repo) throw new Error(`missing repo ${repoId}`)
  useReposStore.setState({
    repos: {
      [repoId]: {
        ...repo,
        availability: { phase: 'unavailable' as const, reason: 'error.failed-read-repo', checkedAt: 0 },
      },
    },
  })
}
