// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoView } from '#/web/components/RepoView.tsx'
import { resetReposStore, seedRepoState, createRepoBranch } from '#/web/stores/repos/test-utils.ts'
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
    selectedBranchName,
    shortcutsEnabled = true,
    toolbarTrafficLightOffset = false,
  }: {
    selectedBranchName?: string | null
    shortcutsEnabled?: boolean
    toolbarTrafficLightOffset?: boolean
  }) => (
    <div
      data-testid="branch-workspace"
      data-selected-branch-name={selectedBranchName ?? ''}
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
    branchWorkspacePane,
  }: {
    mode?: 'split' | 'single-pane'
    branchNavigatorCollapsed?: boolean
    branchNavigatorPane: React.ReactNode
    branchWorkspacePane: React.ReactNode
  }) => (
    <div
      data-testid="repo-workspace"
      data-mode={mode ?? 'split'}
      data-branch-navigator-collapsed={branchNavigatorCollapsed ? 'true' : 'false'}
    >
      {mode === 'single-pane' ? (
        branchWorkspacePane
      ) : (
        <>
          {branchNavigatorPane}
          {branchWorkspacePane}
        </>
      )}
    </div>
  ),
  RepoWorkspacePane: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CompactRepoWorkspace: ({
    activePane,
    branchNavigatorPane,
    branchWorkspacePane,
  }: {
    activePane: 'navigator' | 'workspace'
    branchNavigatorPane: React.ReactNode
    branchWorkspacePane: React.ReactNode
  }) => (
    <div data-compact-workspace="" data-active-pane={activePane}>
      <div data-compact-workspace-pane="navigator" aria-hidden={activePane === 'workspace' ? 'true' : undefined}>
        {branchNavigatorPane}
      </div>
      <div data-compact-workspace-pane="workspace" aria-hidden={activePane === 'navigator' ? 'true' : undefined}>
        {branchWorkspacePane}
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
let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  responsiveMocks.mode = 'default'
  resetReposStore()
  seedRepoState({
    id: REPO_ID,
    branches: [createRepoBranch('main'), createRepoBranch('feature/a')],
    selectedBranch: null,
  })
  branchNavigatorMocks.activate.mockImplementation((repoId) => {
    useReposStore.getState().selectBranch(repoId, 'feature/a')
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  branchNavigatorMocks.activate.mockReset()
  vi.restoreAllMocks()
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('RepoView workspace navigation', () => {
  test('large-screen branch activation keeps the Branch Navigator visible', () => {
    render(<RepoView repoId={REPO_ID} />)

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBeNull()
    expect(workspace()?.dataset.mode).toBe('split')

    act(() => {
      branchNavigator()?.click()
    })

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBe('feature/a')
    expect(branchNavigator()).not.toBeNull()
    expect(workspace()?.dataset.mode).toBe('split')
    expect(repoWorkspace()).not.toBeNull()
  })

  test('large-screen Zen Mode uses Branch Navigator until a branch opens a collapsed split workspace', () => {
    useReposStore.getState().setZenMode(true)
    render(<RepoView repoId={REPO_ID} />)

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBeNull()
    expect(branchNavigator()).not.toBeNull()
    expect(repoWorkspace()).toBeNull()
    expect(workspace()).toBeNull()

    act(() => {
      branchNavigator()?.click()
    })

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBe('feature/a')
    expect(branchNavigator()).not.toBeNull()
    expect(workspace()?.dataset.mode).toBe('split')
    expect(workspace()?.dataset.branchNavigatorCollapsed).toBe('true')
    expect(repoWorkspace()).not.toBeNull()
    expect(repoWorkspace()?.dataset.trafficLightOffset).toBe('true')
    expect(zenModeSidebarTrigger()).not.toBeNull()
    const sidebarTops = [...(container?.querySelectorAll<HTMLElement>('[data-testid="repo-shell-sidebar-top"]') ?? [])]
    expect(sidebarTops.length).toBeGreaterThan(0)
    const closedRevealTop = zenModeSidebarReveal()?.querySelector<HTMLElement>('[data-testid="repo-shell-sidebar-top"]')
    expect(zenModeSidebarReveal()?.dataset.open).toBe('false')
    expect(zenModeSidebarReveal()?.dataset.interactive).toBe('false')
    expect(closedRevealTop?.dataset.titleBarChromeRegion).toBeUndefined()
    expect(closedRevealTop?.querySelector('[data-title-bar-chrome-region="no-drag"]')).toBeNull()
  })

  test('large-screen collapsed Zen Mode reveals the sidebar on left-edge hover', () => {
    useReposStore.getState().setZenMode(true)
    useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
    useReposStore.getState().setWorkspacePaneSize(55)
    render(<RepoView repoId={REPO_ID} />)

    const reveal = zenModeSidebarReveal()
    expect(reveal).not.toBeNull()
    expect(reveal?.dataset.open).toBe('false')
    expect(reveal?.dataset.state).toBe('closed')
    expect(zenModeSidebarLayer()?.className).toContain('right-0')
    expect(reveal?.className).not.toContain('border-r')
    expect(reveal?.getAttribute('aria-hidden')).toBe('true')
    expect(reveal?.hasAttribute('inert')).toBe(true)

    act(() => {
      zenModeSidebarHitArea()?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    expect(zenModeSidebarReveal()?.dataset.open).toBe('true')
    expect(zenModeSidebarReveal()?.dataset.interactive).toBe('true')
    expect(zenModeSidebarReveal()?.getAttribute('aria-hidden')).toBeNull()
    expect(zenModeSidebarReveal()?.hasAttribute('inert')).toBe(false)
    const floatingSidebarTop = zenModeSidebarReveal()?.querySelector<HTMLElement>(
      '[data-testid="repo-shell-sidebar-top"]',
    )
    expect(floatingSidebarTop?.hasAttribute('data-interactive')).toBe(false)
    expect(floatingSidebarTop?.dataset.titleBarChromeRegion).toBe('drag')
    expect(floatingSidebarTop?.querySelector('[data-title-bar-chrome-region="no-drag"]')).toBeNull()
    expect(zenModeSidebarTrigger()?.dataset.titleBarChromeRegion).toBe('interactive')
    expect(zenModeSidebarTrigger()?.tagName).toBe('BUTTON')
  })

  test('large-screen collapsed Zen Mode reveals the sidebar when the zen toggle is hovered', () => {
    useReposStore.getState().setZenMode(true)
    useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
    render(<RepoView repoId={REPO_ID} />)

    const revealLayer = zenModeSidebarLayer()
    const toggleOverlay = zenModeToggleOverlay()
    expect(zenModeToggleOverlay()?.hasAttribute('data-interactive')).toBe(false)
    expect(zenModeToggleOverlay()?.dataset.titleBarChromeRegion).toBeUndefined()
    expect(zenModeToggleOverlay()?.hasAttribute('data-zen-reveal-surface')).toBe(true)
    expect(zenModeToggleOverlay()?.className).toContain('goblin-zen-reveal-trigger-layer')
    expect(zenModeToggleOverlay()?.className).not.toContain('title-bar-chrome')
    expect(zenModeToggleOverlay()?.className).not.toContain('app-drag-region')
    expect(revealLayer).not.toBeNull()
    expect(toggleOverlay).not.toBeNull()
    expect(revealLayer!.compareDocumentPosition(toggleOverlay!) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(zenModeSidebarTrigger()?.hasAttribute('data-interactive')).toBe(true)
    expect(zenModeSidebarTrigger()?.dataset.titleBarChromeRegion).toBe('interactive')
    expect(zenModeSidebarReveal()?.dataset.open).toBe('false')

    act(() => {
      zenModeSidebarTrigger()?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    expect(zenModeSidebarReveal()?.dataset.open).toBe('true')
  })

  test('large-screen collapsed Zen Mode keeps the sidebar open across the title-bar-chrome reveal surface', () => {
    useReposStore.getState().setZenMode(true)
    useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
    render(<RepoView repoId={REPO_ID} />)

    act(() => {
      zenModeSidebarTrigger()?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(zenModeSidebarReveal()?.dataset.open).toBe('true')

    mockZenRevealLayout({
      panelLeft: -14,
      panelWidth: 360,
    })

    act(() => {
      zenModeSidebarReveal()?.dispatchEvent(
        new MouseEvent('mouseout', {
          bubbles: true,
          relatedTarget: zenModeToggleOverlay(),
          clientX: 355,
          clientY: 24,
        }),
      )
      zenModeToggleOverlay()?.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, clientX: 355, clientY: 24 }),
      )
    })

    expect(zenModeSidebarReveal()?.dataset.open).toBe('true')
  })

  test('large-screen collapsed Zen Mode does not close from the trigger mouseout alone', () => {
    useReposStore.getState().setZenMode(true)
    useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
    render(<RepoView repoId={REPO_ID} />)

    const toggle = zenModeSidebarTrigger()
    act(() => {
      toggle?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(zenModeSidebarReveal()?.dataset.open).toBe('true')

    act(() => {
      toggle?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
    })
    expect(zenModeSidebarReveal()?.dataset.open).toBe('true')

    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 800, clientY: 24 }))
    })
    expect(zenModeSidebarReveal()?.dataset.open).toBe('false')
  })

  test('large-screen collapsed Zen Mode stays open while the pointer remains on the zen trigger', () => {
    useReposStore.getState().setZenMode(true)
    useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
    render(<RepoView repoId={REPO_ID} />)

    const trigger = zenModeSidebarTrigger()
    expect(trigger?.hasAttribute('data-zen-reveal-surface')).toBe(true)

    act(() => {
      trigger?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      trigger?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
    })

    expect(zenModeSidebarReveal()?.dataset.open).toBe('true')
  })

  test('large-screen collapsed Zen Mode opens reveal on first trigger hover', () => {
    render(<RepoView repoId={REPO_ID} />)

    act(() => {
      useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
      useReposStore.getState().setZenMode(true)
    })

    expect(zenModeSidebarReveal()?.dataset.open).toBe('false')

    const trigger = zenModeSidebarTrigger()
    act(() => {
      trigger?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(zenModeSidebarReveal()?.dataset.open).toBe('true')
  })

  test('large-screen collapsed Zen Mode stays open while moving from trigger into the revealed sidebar', () => {
    useReposStore.getState().setZenMode(true)
    useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
    render(<RepoView repoId={REPO_ID} />)

    const toggle = zenModeSidebarTrigger()
    act(() => {
      toggle?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(zenModeSidebarReveal()?.dataset.open).toBe('true')

    const reveal = zenModeSidebarReveal()
    act(() => {
      toggle?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: reveal }))
      reveal?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    expect(zenModeSidebarReveal()?.dataset.open).toBe('true')

    act(() => {
      zenModeSidebarReveal()?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
    })

    expect(zenModeSidebarReveal()?.dataset.open).toBe('false')
  })

  test('large-screen collapsed Zen Mode stays open while pointer moves into a portal floating surface', () => {
    const floatingSurface = document.createElement('div')
    floatingSurface.setAttribute('data-floating-surface', '')
    document.body.appendChild(floatingSurface)

    try {
      useReposStore.getState().setZenMode(true)
      useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
      render(<RepoView repoId={REPO_ID} />)

      act(() => {
        zenModeSidebarHitArea()?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      })
      expect(zenModeSidebarReveal()?.dataset.open).toBe('true')

      act(() => {
        zenModeSidebarReveal()?.dispatchEvent(
          new MouseEvent('mouseout', { bubbles: true, relatedTarget: floatingSurface }),
        )
        floatingSurface.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
      })

      expect(zenModeSidebarReveal()?.dataset.open).toBe('true')

      act(() => {
        document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
      })

      expect(zenModeSidebarReveal()?.dataset.open).toBe('false')
    } finally {
      floatingSurface.remove()
    }
  })

  test('large-screen collapsed Zen Mode stays open when pointer coordinates remain inside the reveal', () => {
    useReposStore.getState().setZenMode(true)
    useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
    render(<RepoView repoId={REPO_ID} />)

    act(() => {
      zenModeSidebarHitArea()?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(zenModeSidebarReveal()?.dataset.open).toBe('true')

    mockZenRevealLayout({
      panelLeft: -14,
      panelWidth: 360,
    })

    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 355, clientY: 24 }))
    })

    expect(zenModeSidebarReveal()?.dataset.open).toBe('true')
  })

  test('large-screen collapsed Zen Mode resizes the same sidebar width state from the reveal edge', () => {
    useReposStore.getState().setZenMode(true)
    useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
    useReposStore.getState().setWorkspacePaneSize(70)
    render(<RepoView repoId={REPO_ID} />)

    Object.defineProperty(container!.firstElementChild!, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, width: 1000, top: 0, right: 1000, bottom: 800, height: 800 }),
    })

    act(() => {
      zenModeSidebarHitArea()?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    act(() => {
      zenModeSidebarResizeHandle()?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, clientX: 420, pointerId: 1 }),
      )
    })

    expect(zenModeSidebarResizeHandle()?.dataset.separator).toBe('active')

    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 420, pointerId: 1 }))
    })

    expect(useReposStore.getState().workspacePaneSize).toBe(58)
    expect(zenModeSidebarResizeHandle()?.dataset.separator).toBeUndefined()
  })

  test('large-screen collapsed Zen Mode cleans resize listeners if the reveal unmounts mid-drag', () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    useReposStore.getState().setZenMode(true)
    useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
    render(<RepoView repoId={REPO_ID} />)

    Object.defineProperty(container!.firstElementChild!, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, width: 1000, top: 0, right: 1000, bottom: 800, height: 800 }),
    })

    act(() => {
      zenModeSidebarHitArea()?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    act(() => {
      zenModeSidebarResizeHandle()?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, clientX: 420, pointerId: 1 }),
      )
    })

    expect(zenModeSidebarResizeHandle()?.dataset.separator).toBe('active')

    act(() => {
      root?.unmount()
    })
    root = null

    expect(removeEventListener).toHaveBeenCalledWith('pointermove', expect.any(Function))
    expect(removeEventListener).toHaveBeenCalledWith('pointerup', expect.any(Function))
    expect(removeEventListener).toHaveBeenCalledWith('pointercancel', expect.any(Function))
  })

  test('large-screen collapsed Zen Mode keeps the open reveal mounted while zen mode exits', () => {
    vi.useFakeTimers()
    try {
      useReposStore.getState().setZenMode(true)
      useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
      render(<RepoView repoId={REPO_ID} />)

      act(() => {
        zenModeSidebarHitArea()?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      })
      expect(zenModeSidebarReveal()?.dataset.open).toBe('true')

      act(() => {
        useReposStore.getState().setZenMode(false)
      })

      expect(workspace()?.dataset.branchNavigatorCollapsed).toBe('false')
      expect(zenModeSidebarReveal()?.dataset.open).toBe('true')
      expect(zenModeSidebarReveal()?.dataset.interactive).toBe('false')
      expect(zenModeSidebarReveal()?.getAttribute('aria-hidden')).toBe('true')
      expect(zenModeSidebarReveal()?.hasAttribute('inert')).toBe(true)
      const retainedSidebarTop = zenModeSidebarReveal()?.querySelector<HTMLElement>(
        '[data-testid="repo-shell-sidebar-top"]',
      )
      expect(retainedSidebarTop?.dataset.titleBarChromeRegion).toBeUndefined()
      expect(retainedSidebarTop?.querySelector('[data-title-bar-chrome-region="no-drag"]')).toBeNull()

      act(() => {
        document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
        vi.advanceTimersByTime(WORKSPACE_PANE_TRANSITION_MS - 1)
      })
      expect(zenModeSidebarReveal()?.dataset.open).toBe('true')

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(zenModeSidebarReveal()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  test('large-screen collapsed Zen Mode does not reopen the reveal while zen mode is exiting', () => {
    vi.useFakeTimers()
    try {
      useReposStore.getState().setZenMode(true)
      useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
      render(<RepoView repoId={REPO_ID} />)

      act(() => {
        zenModeSidebarHitArea()?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      })
      expect(zenModeSidebarReveal()?.dataset.open).toBe('true')

      mockZenRevealLayout({ panelLeft: 0, panelWidth: 360 })

      act(() => {
        useReposStore.getState().setZenMode(false)
      })

      expect(zenModeSidebarReveal()?.dataset.open).toBe('true')
      expect(zenModeSidebarReveal()?.dataset.interactive).toBe('false')
      expect(zenModeSidebarHitArea()?.className).toContain('pointer-events-none')

      act(() => {
        document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 120, clientY: 24 }))
        vi.advanceTimersByTime(WORKSPACE_PANE_TRANSITION_MS)
      })

      expect(zenModeSidebarReveal()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  test('compact branch activation slides Branch Workspace into the active pane', () => {
    responsiveMocks.mode = 'compact'
    render(<RepoView repoId={REPO_ID} />)

    expect(container?.querySelector('[data-testid="repo-shell-sidebar-top"]')).toBeNull()
    expect(zenModeSidebarTrigger()).toBeNull()
    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBeNull()
    expect(compactWorkspace()?.dataset.activePane).toBe('navigator')
    expect(compactPane('navigator')?.getAttribute('aria-hidden')).toBeNull()
    expect(compactPane('workspace')?.getAttribute('aria-hidden')).toBe('true')

    act(() => {
      branchNavigator()?.click()
    })

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBe('feature/a')
    expect(compactWorkspace()?.dataset.activePane).toBe('workspace')
    expect(compactPane('navigator')?.getAttribute('aria-hidden')).toBe('true')
    expect(compactPane('workspace')?.getAttribute('aria-hidden')).toBeNull()
    expect(repoWorkspace()).not.toBeNull()
  })

  test('compact mode derives Branch Workspace from an existing selected branch', () => {
    responsiveMocks.mode = 'compact'
    render(<RepoView repoId={REPO_ID} />)

    act(() => {
      useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
    })

    expect(compactWorkspace()?.dataset.activePane).toBe('workspace')
    expect(compactPane('navigator')?.getAttribute('aria-hidden')).toBe('true')
    expect(compactPane('workspace')?.getAttribute('aria-hidden')).toBeNull()
    expect(repoWorkspace()).not.toBeNull()
  })

  test('compact back transition keeps the outgoing Branch Workspace content during slide-out', () => {
    vi.useFakeTimers()
    try {
      responsiveMocks.mode = 'compact'
      render(<RepoView repoId={REPO_ID} />)

      act(() => {
        useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
      })

      expect(repoWorkspace()?.dataset.selectedBranchName).toBe('feature/a')
      expect(repoWorkspace()?.dataset.shortcutsEnabled).toBe('true')

      act(() => {
        useReposStore.getState().clearSelectedBranch(REPO_ID)
      })

      expect(compactWorkspace()?.dataset.activePane).toBe('navigator')
      expect(compactPane('workspace')?.getAttribute('aria-hidden')).toBe('true')
      expect(repoWorkspace()?.dataset.selectedBranchName).toBe('feature/a')
      expect(repoWorkspace()?.dataset.shortcutsEnabled).toBe('false')

      act(() => {
        vi.advanceTimersByTime(WORKSPACE_PANE_TRANSITION_MS)
      })

      expect(repoWorkspace()?.dataset.selectedBranchName).toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  test('large-screen initial loading keeps the workspace pane empty when no branch is selected', () => {
    setSnapshotLoading(REPO_ID)
    render(<RepoView repoId={REPO_ID} />)

    expect(workspace()?.dataset.mode).toBe('split')
    expect(container?.querySelector('[data-testid="repo-picker"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="create-worktree-row-action"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="branch-workspace-empty-skeleton"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="branch-workspace-skeleton"]')).toBeNull()
    expect(container?.querySelectorAll('[data-testid="branch-navigator-skeleton-action"]')).toHaveLength(6)
  })

  test('large-screen focused initial loading with selected branch keeps floating sidebar reveal available', () => {
    useReposStore.getState().setZenMode(true)
    useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
    setSnapshotLoading(REPO_ID)

    render(<RepoView repoId={REPO_ID} />)

    expect(workspace()?.dataset.branchNavigatorCollapsed).toBe('true')
    expect(zenModeSidebarReveal()).not.toBeNull()
    expect(zenModeSidebarReveal()?.dataset.open).toBe('false')
  })

  test('large-screen unavailable repo keeps the repo shell chrome available', () => {
    setRepoUnavailable(REPO_ID)
    render(<RepoView repoId={REPO_ID} />)

    expect(workspace()?.dataset.mode).toBe('split')
    expect(container?.querySelector('[data-testid="repo-picker"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="create-worktree-row-action"]')).not.toBeNull()
    expect(container?.querySelector('button[aria-label="app-chrome.settings"]')).not.toBeNull()
    expect(document.body.textContent).toContain('repo-unavailable.title')
  })

  test('large-screen focused unavailable repo with selected branch keeps floating sidebar reveal available', () => {
    useReposStore.getState().setZenMode(true)
    useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
    setRepoUnavailable(REPO_ID)

    render(<RepoView repoId={REPO_ID} />)

    expect(workspace()?.dataset.branchNavigatorCollapsed).toBe('true')
    expect(zenModeSidebarReveal()).not.toBeNull()
    expect(zenModeSidebarReveal()?.dataset.open).toBe('false')
  })

  test('compact initial loading shows the selected Branch Workspace skeleton as the single pane', () => {
    responsiveMocks.mode = 'compact'
    useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
    setSnapshotLoading(REPO_ID)

    render(<RepoView repoId={REPO_ID} />)

    expect(workspace()).toBeNull()
    expect(container?.querySelector('[data-testid="branch-workspace-skeleton"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="branch-workspace-empty-skeleton"]')).toBeNull()
    expect(container?.querySelectorAll('[data-testid="branch-navigator-skeleton-action"]')).toHaveLength(0)
  })

  test('resizing from split large-screen mode to compact shows Branch Workspace when a branch is selected', () => {
    render(<RepoView repoId={REPO_ID} />)

    act(() => {
      branchNavigator()?.click()
    })

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBe('feature/a')
    expect(branchNavigator()).not.toBeNull()
    expect(repoWorkspace()).not.toBeNull()

    act(() => {
      responsiveMocks.mode = 'compact'
      root!.render(<RepoView repoId={REPO_ID} />)
    })

    expect(compactWorkspace()?.dataset.activePane).toBe('workspace')
    expect(compactPane('navigator')?.getAttribute('aria-hidden')).toBe('true')
    expect(compactPane('workspace')?.getAttribute('aria-hidden')).toBeNull()
    expect(repoWorkspace()).not.toBeNull()
  })
})

function render(element: React.ReactNode) {
  act(() => {
    root!.render(element)
  })
}

function branchNavigator(): HTMLButtonElement | null {
  return container?.querySelector<HTMLButtonElement>('[data-testid="branch-navigator"]') ?? null
}

function repoWorkspace(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('[data-testid="branch-workspace"]') ?? null
}

function workspace(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('[data-testid="repo-workspace"]') ?? null
}

function compactWorkspace(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('[data-compact-workspace]') ?? null
}

function compactPane(pane: 'navigator' | 'workspace'): HTMLElement | null {
  return container?.querySelector<HTMLElement>(`[data-compact-workspace-pane="${pane}"]`) ?? null
}

function zenModeSidebarHitArea(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('[data-testid="zen-mode-sidebar-hit-area"]') ?? null
}

function zenModeSidebarReveal(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('[data-testid="zen-mode-sidebar-reveal"]') ?? null
}

function zenModeSidebarLayer(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('[data-testid="zen-mode-sidebar-layer"]') ?? null
}

function zenModeSidebarResizeHandle(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('[data-testid="zen-mode-sidebar-resize-handle"]') ?? null
}

function zenModeSidebarTrigger(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('[data-testid="zen-mode-sidebar-trigger"]') ?? null
}

function zenModeToggleOverlay(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('[data-testid="zen-mode-toggle-overlay"]') ?? null
}

function mockZenRevealLayout({
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
}) {
  const layer = zenModeSidebarLayer()
  const reveal = zenModeSidebarReveal()
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
        resources: {
          ...repo.resources,
          snapshot: {
            ...repo.resources.snapshot,
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
