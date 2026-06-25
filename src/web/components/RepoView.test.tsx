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

vi.mock('#/web/components/BranchWorkspace.tsx', () => ({
  BranchWorkspace: ({
    selectedBranchName,
    shortcutsEnabled = true,
    toolbarLeading,
    toolbarTrafficLightOffset = false,
  }: {
    selectedBranchName?: string | null
    shortcutsEnabled?: boolean
    toolbarLeading?: React.ReactNode
    toolbarTrafficLightOffset?: boolean
  }) => (
    <div
      data-testid="branch-workspace"
      data-selected-branch-name={selectedBranchName ?? ''}
      data-shortcuts-enabled={shortcutsEnabled ? 'true' : 'false'}
      data-has-toolbar-leading={toolbarLeading ? 'true' : 'false'}
      data-traffic-light-offset={toolbarTrafficLightOffset ? 'true' : 'false'}
    >
      {toolbarLeading ? <div data-testid="branch-workspace-toolbar-leading">{toolbarLeading}</div> : null}
    </div>
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

vi.mock('#/web/components/WorkspaceFocusToggle.tsx', () => ({
  WorkspaceFocusToggle: () => (
    <button type="button" data-testid="workspace-focus-toggle">
      focus
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
  Toolbar: ({ children }: { children: React.ReactNode }) => <div data-testid="mock-toolbar">{children}</div>,
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
    expect(branchWorkspace()).not.toBeNull()
  })

  test('large-screen Focus Mode uses Branch Navigator until a branch opens a collapsed split workspace', () => {
    useReposStore.getState().setWorkspaceFocused(true)
    render(<RepoView repoId={REPO_ID} />)

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBeNull()
    expect(branchNavigator()).not.toBeNull()
    expect(branchWorkspace()).toBeNull()
    expect(workspace()).toBeNull()

    act(() => {
      branchNavigator()?.click()
    })

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBe('feature/a')
    expect(branchNavigator()).not.toBeNull()
    expect(workspace()?.dataset.mode).toBe('split')
    expect(workspace()?.dataset.branchNavigatorCollapsed).toBe('true')
    expect(branchWorkspace()).not.toBeNull()
    expect(branchWorkspace()?.dataset.hasToolbarLeading).toBe('false')
    expect(branchWorkspace()?.dataset.trafficLightOffset).toBe('true')
    expect(focusModeSidebarTrigger()).not.toBeNull()
  })

  test('large-screen collapsed Focus Mode reveals the sidebar on left-edge hover', () => {
    useReposStore.getState().setWorkspaceFocused(true)
    useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
    useReposStore.getState().setWorkspacePaneSize(55)
    render(<RepoView repoId={REPO_ID} />)

    const reveal = focusModeSidebarReveal()
    expect(reveal).not.toBeNull()
    expect(reveal?.dataset.open).toBe('false')
    expect(reveal?.dataset.state).toBe('closed')
    expect(focusModeSidebarLayer()?.className).toContain('right-0')
    expect(reveal?.className).not.toContain('border-r')
    expect(reveal?.getAttribute('aria-hidden')).toBe('true')
    expect(reveal?.hasAttribute('inert')).toBe(true)

    act(() => {
      focusModeSidebarHitArea()?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    expect(focusModeSidebarReveal()?.dataset.open).toBe('true')
    expect(focusModeSidebarReveal()?.getAttribute('aria-hidden')).toBeNull()
    expect(focusModeSidebarReveal()?.hasAttribute('inert')).toBe(false)
    expect(focusModeSidebarReveal()?.querySelector('[data-testid="repo-shell-sidebar-top"]')?.hasAttribute('data-interactive')).toBe(
      true,
    )
  })

  test('large-screen collapsed Focus Mode reveals the sidebar when the focus toggle is hovered', () => {
    useReposStore.getState().setWorkspaceFocused(true)
    useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
    render(<RepoView repoId={REPO_ID} />)

    expect(focusModeToggleOverlay()?.hasAttribute('data-interactive')).toBe(true)
    expect(focusModeToggleOverlay()?.hasAttribute('data-focus-reveal-surface')).toBe(true)
    expect(focusModeToggleOverlay()?.className).toContain('goblin-focus-reveal-trigger-layer')
    expect(focusModeToggleOverlay()?.className).not.toContain('topbar')
    expect(focusModeSidebarReveal()?.dataset.open).toBe('false')

    act(() => {
      focusModeSidebarTrigger()
        ?.querySelector('[data-testid="workspace-focus-toggle"]')
        ?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    expect(focusModeSidebarReveal()?.dataset.open).toBe('true')
  })

  test('large-screen collapsed Focus Mode keeps the sidebar open across the topbar reveal surface', () => {
    useReposStore.getState().setWorkspaceFocused(true)
    useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
    render(<RepoView repoId={REPO_ID} />)

    act(() => {
      focusModeSidebarTrigger()
        ?.querySelector('[data-testid="workspace-focus-toggle"]')
        ?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(focusModeSidebarReveal()?.dataset.open).toBe('true')

    mockFocusRevealLayout({
      panelLeft: -14,
      panelWidth: 360,
    })

    act(() => {
      focusModeSidebarReveal()?.dispatchEvent(
        new MouseEvent('mouseout', {
          bubbles: true,
          relatedTarget: focusModeToggleOverlay(),
          clientX: 355,
          clientY: 24,
        }),
      )
      focusModeToggleOverlay()?.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, clientX: 355, clientY: 24 }),
      )
    })

    expect(focusModeSidebarReveal()?.dataset.open).toBe('true')
  })

  test('large-screen collapsed Focus Mode does not close from the trigger mouseout alone', () => {
    useReposStore.getState().setWorkspaceFocused(true)
    useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
    render(<RepoView repoId={REPO_ID} />)

    const toggle = focusModeSidebarTrigger()?.querySelector('[data-testid="workspace-focus-toggle"]')
    act(() => {
      toggle?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(focusModeSidebarReveal()?.dataset.open).toBe('true')

    act(() => {
      toggle?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
    })
    expect(focusModeSidebarReveal()?.dataset.open).toBe('true')

    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 800, clientY: 24 }))
    })
    expect(focusModeSidebarReveal()?.dataset.open).toBe('false')
  })

  test('large-screen collapsed Focus Mode stays open while the pointer remains on the focus trigger', () => {
    useReposStore.getState().setWorkspaceFocused(true)
    useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
    render(<RepoView repoId={REPO_ID} />)

    const trigger = focusModeSidebarTrigger()
    expect(trigger?.hasAttribute('data-focus-reveal-surface')).toBe(true)

    act(() => {
      trigger?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      trigger?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
    })

    expect(focusModeSidebarReveal()?.dataset.open).toBe('true')
  })

  test('large-screen collapsed Focus Mode arms trigger hover only after the pointer leaves once', () => {
    render(<RepoView repoId={REPO_ID} />)

    act(() => {
      useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
      useReposStore.getState().setWorkspaceFocused(true)
    })

    expect(focusModeSidebarReveal()?.dataset.open).toBe('false')

    const trigger = focusModeSidebarTrigger()
    act(() => {
      trigger?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(focusModeSidebarReveal()?.dataset.open).toBe('false')

    act(() => {
      trigger?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
    })

    act(() => {
      trigger?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(focusModeSidebarReveal()?.dataset.open).toBe('true')
  })

  test('large-screen collapsed Focus Mode stays open while moving from trigger into the revealed sidebar', () => {
    useReposStore.getState().setWorkspaceFocused(true)
    useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
    render(<RepoView repoId={REPO_ID} />)

    const toggle = focusModeSidebarTrigger()?.querySelector('[data-testid="workspace-focus-toggle"]')
    act(() => {
      toggle?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(focusModeSidebarReveal()?.dataset.open).toBe('true')

    const reveal = focusModeSidebarReveal()
    act(() => {
      toggle?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: reveal }))
      reveal?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    expect(focusModeSidebarReveal()?.dataset.open).toBe('true')

    act(() => {
      focusModeSidebarReveal()?.dispatchEvent(
        new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }),
      )
    })

    expect(focusModeSidebarReveal()?.dataset.open).toBe('false')
  })

  test('large-screen collapsed Focus Mode stays open while pointer moves into a portal floating surface', () => {
    const floatingSurface = document.createElement('div')
    floatingSurface.setAttribute('data-floating-surface', '')
    document.body.appendChild(floatingSurface)

    try {
      useReposStore.getState().setWorkspaceFocused(true)
      useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
      render(<RepoView repoId={REPO_ID} />)

      act(() => {
        focusModeSidebarHitArea()?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      })
      expect(focusModeSidebarReveal()?.dataset.open).toBe('true')

      act(() => {
        focusModeSidebarReveal()?.dispatchEvent(
          new MouseEvent('mouseout', { bubbles: true, relatedTarget: floatingSurface }),
        )
        floatingSurface.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
      })

      expect(focusModeSidebarReveal()?.dataset.open).toBe('true')

      act(() => {
        document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
      })

      expect(focusModeSidebarReveal()?.dataset.open).toBe('false')
    } finally {
      floatingSurface.remove()
    }
  })

  test('large-screen collapsed Focus Mode stays open when pointer coordinates remain inside the reveal', () => {
    useReposStore.getState().setWorkspaceFocused(true)
    useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
    render(<RepoView repoId={REPO_ID} />)

    act(() => {
      focusModeSidebarHitArea()?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(focusModeSidebarReveal()?.dataset.open).toBe('true')

    mockFocusRevealLayout({
      panelLeft: -14,
      panelWidth: 360,
    })

    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 355, clientY: 24 }))
    })

    expect(focusModeSidebarReveal()?.dataset.open).toBe('true')
  })

  test('large-screen collapsed Focus Mode resizes the same sidebar width state from the reveal edge', () => {
    useReposStore.getState().setWorkspaceFocused(true)
    useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
    useReposStore.getState().setWorkspacePaneSize(70)
    render(<RepoView repoId={REPO_ID} />)

    Object.defineProperty(container!.firstElementChild!, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, width: 1000, top: 0, right: 1000, bottom: 800, height: 800 }),
    })

    act(() => {
      focusModeSidebarHitArea()?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })

    act(() => {
      focusModeSidebarResizeHandle()?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, clientX: 420, pointerId: 1 }),
      )
    })

    expect(focusModeSidebarResizeHandle()?.dataset.separator).toBe('active')

    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 420, pointerId: 1 }))
    })

    expect(useReposStore.getState().workspacePaneSize).toBe(58)
    expect(focusModeSidebarResizeHandle()?.dataset.separator).toBeUndefined()
  })

  test('large-screen collapsed Focus Mode cleans resize listeners if the reveal unmounts mid-drag', () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    useReposStore.getState().setWorkspaceFocused(true)
    useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
    render(<RepoView repoId={REPO_ID} />)

    Object.defineProperty(container!.firstElementChild!, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, width: 1000, top: 0, right: 1000, bottom: 800, height: 800 }),
    })

    act(() => {
      focusModeSidebarHitArea()?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      focusModeSidebarResizeHandle()?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, clientX: 420, pointerId: 1 }),
      )
    })

    expect(focusModeSidebarResizeHandle()?.dataset.separator).toBe('active')

    act(() => {
      root?.unmount()
    })
    root = null

    expect(removeEventListener).toHaveBeenCalledWith('pointermove', expect.any(Function))
    expect(removeEventListener).toHaveBeenCalledWith('pointerup', expect.any(Function))
    expect(removeEventListener).toHaveBeenCalledWith('pointercancel', expect.any(Function))
  })

  test('large-screen collapsed Focus Mode keeps the open reveal mounted while focus mode exits', () => {
    vi.useFakeTimers()
    try {
      useReposStore.getState().setWorkspaceFocused(true)
      useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
      render(<RepoView repoId={REPO_ID} />)

      act(() => {
        focusModeSidebarHitArea()?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      })
      expect(focusModeSidebarReveal()?.dataset.open).toBe('true')

      act(() => {
        useReposStore.getState().setWorkspaceFocused(false)
      })

      expect(workspace()?.dataset.branchNavigatorCollapsed).toBe('false')
      expect(focusModeSidebarReveal()?.dataset.open).toBe('true')

      act(() => {
        document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
        vi.advanceTimersByTime(WORKSPACE_PANE_TRANSITION_MS - 1)
      })
      expect(focusModeSidebarReveal()?.dataset.open).toBe('true')

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(focusModeSidebarReveal()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  test('compact branch activation slides Branch Workspace into the active pane', () => {
    responsiveMocks.mode = 'compact'
    render(<RepoView repoId={REPO_ID} />)

    expect(container?.querySelector('[data-testid="repo-shell-sidebar-top"]')).toBeNull()
    expect(workspaceFocusToggle()).toBeNull()
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
    expect(branchWorkspace()).not.toBeNull()
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
    expect(branchWorkspace()).not.toBeNull()
  })

  test('compact back transition keeps the outgoing Branch Workspace content during slide-out', () => {
    vi.useFakeTimers()
    try {
      responsiveMocks.mode = 'compact'
      render(<RepoView repoId={REPO_ID} />)

      act(() => {
        useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
      })

      expect(branchWorkspace()?.dataset.selectedBranchName).toBe('feature/a')
      expect(branchWorkspace()?.dataset.shortcutsEnabled).toBe('true')

      act(() => {
        useReposStore.getState().clearSelectedBranch(REPO_ID)
      })

      expect(compactWorkspace()?.dataset.activePane).toBe('navigator')
      expect(compactPane('workspace')?.getAttribute('aria-hidden')).toBe('true')
      expect(branchWorkspace()?.dataset.selectedBranchName).toBe('feature/a')
      expect(branchWorkspace()?.dataset.shortcutsEnabled).toBe('false')

      act(() => {
        vi.advanceTimersByTime(WORKSPACE_PANE_TRANSITION_MS)
      })

      expect(branchWorkspace()?.dataset.selectedBranchName).toBe('')
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
    useReposStore.getState().setWorkspaceFocused(true)
    useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
    setSnapshotLoading(REPO_ID)

    render(<RepoView repoId={REPO_ID} />)

    expect(workspace()?.dataset.branchNavigatorCollapsed).toBe('true')
    expect(focusModeSidebarReveal()).not.toBeNull()
    expect(focusModeSidebarReveal()?.dataset.open).toBe('false')
  })

  test('large-screen unavailable repo keeps the repo shell chrome available', () => {
    setRepoUnavailable(REPO_ID)
    render(<RepoView repoId={REPO_ID} />)

    expect(workspace()?.dataset.mode).toBe('split')
    expect(container?.querySelector('[data-testid="repo-picker"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="create-worktree-row-action"]')).not.toBeNull()
    expect(container?.querySelector('button[aria-label="topbar.settings"]')).not.toBeNull()
    expect(document.body.textContent).toContain('repo-unavailable.title')
  })

  test('large-screen focused unavailable repo with selected branch keeps floating sidebar reveal available', () => {
    useReposStore.getState().setWorkspaceFocused(true)
    useReposStore.getState().selectBranch(REPO_ID, 'feature/a')
    setRepoUnavailable(REPO_ID)

    render(<RepoView repoId={REPO_ID} />)

    expect(workspace()?.dataset.branchNavigatorCollapsed).toBe('true')
    expect(focusModeSidebarReveal()).not.toBeNull()
    expect(focusModeSidebarReveal()?.dataset.open).toBe('false')
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
    expect(branchWorkspace()).not.toBeNull()

    act(() => {
      responsiveMocks.mode = 'compact'
      root!.render(<RepoView repoId={REPO_ID} />)
    })

    expect(compactWorkspace()?.dataset.activePane).toBe('workspace')
    expect(compactPane('navigator')?.getAttribute('aria-hidden')).toBe('true')
    expect(compactPane('workspace')?.getAttribute('aria-hidden')).toBeNull()
    expect(branchWorkspace()).not.toBeNull()
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

function branchWorkspace(): HTMLElement | null {
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

function workspaceFocusToggle(): HTMLButtonElement | null {
  return container?.querySelector<HTMLButtonElement>('[data-testid="workspace-focus-toggle"]') ?? null
}

function focusModeSidebarHitArea(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('[data-testid="focus-mode-sidebar-hit-area"]') ?? null
}

function focusModeSidebarReveal(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('[data-testid="focus-mode-sidebar-reveal"]') ?? null
}

function focusModeSidebarLayer(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('[data-testid="focus-mode-sidebar-layer"]') ?? null
}

function focusModeSidebarResizeHandle(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('[data-testid="focus-mode-sidebar-resize-handle"]') ?? null
}

function focusModeSidebarTrigger(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('[data-testid="focus-mode-sidebar-trigger"]') ?? null
}

function focusModeToggleOverlay(): HTMLElement | null {
  return container?.querySelector<HTMLElement>('[data-testid="focus-mode-toggle-overlay"]') ?? null
}

function mockFocusRevealLayout({
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
  const layer = focusModeSidebarLayer()
  const reveal = focusModeSidebarReveal()
  if (!layer || !reveal) throw new Error('missing focus reveal')

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
