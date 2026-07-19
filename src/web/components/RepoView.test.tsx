// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { RepoView } from '#/web/components/RepoView.tsx'
import {
  resetWorkspacesStore,
  seedRepoShellForTest,
  seedRepoWithReadModelForTest,
  createRepoBranch,
  setWorkspaceProbeForTest,
} from '#/web/test-utils/bridge.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const responsiveMocks = vi.hoisted(() => ({
  mode: 'default' as 'default' | 'compact',
}))
const branchNavigatorMocks = vi.hoisted(() => ({
  activate: vi.fn<(repoId: string) => void>(),
}))
const createWorktreePageMocks = vi.hoisted(() => ({
  cancel: vi.fn<() => void>(),
  created: vi.fn<(branchName: string) => void>(),
}))
const restoreWorkspaceTabsMocks = vi.hoisted(() => ({
  useRestoreWorkspaceTabsOnView: vi.fn(),
  useRepoToasts: vi.fn(),
}))

vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useResponsiveUiMode: () => responsiveMocks.mode,
  useIsCompactUi: () => responsiveMocks.mode === 'compact',
}))

vi.mock('#/web/hooks/useRepoToasts.tsx', () => ({
  useRepoToasts: restoreWorkspaceTabsMocks.useRepoToasts,
}))

vi.mock('#/web/hooks/useRestoreWorkspaceTabsOnView.ts', () => ({
  useRestoreWorkspaceTabsOnView: restoreWorkspaceTabsMocks.useRestoreWorkspaceTabsOnView,
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
    workspacePaneRouteContext,
    shortcutsEnabled = true,
    toolbarTrafficLightOffset = false,
  }: {
    currentBranchName?: string | null
    workspacePaneRouteContext?:
      { kind: 'workspace-root' } | { kind: 'routed'; route: { kind: string } | null } | { kind: 'inactive' }
    shortcutsEnabled?: boolean
    toolbarTrafficLightOffset?: boolean
  }) => (
    <div
      data-testid="repo-workspace"
      data-current-branch-name={currentBranchName ?? ''}
      data-workspace-pane-route-kind={
        workspacePaneRouteContext?.kind === 'routed'
          ? (workspacePaneRouteContext.route?.kind ?? 'bare')
          : (workspacePaneRouteContext?.kind ?? 'inactive')
      }
      data-shortcuts-enabled={shortcutsEnabled ? 'true' : 'false'}
      data-traffic-light-offset={toolbarTrafficLightOffset ? 'true' : 'false'}
    />
  ),
}))

vi.mock('#/web/components/repo-pages/CreateWorktreePagePane.tsx', () => ({
  CreateWorktreePagePane: ({
    compact,
    onCancel,
    onCreated,
  }: {
    compact?: boolean
    onCancel: () => void
    onCreated: (branchName: string) => void
  }) => (
    <div data-testid="create-worktree-page" data-compact={compact ? 'true' : 'false'}>
      <button
        type="button"
        data-testid="create-worktree-cancel"
        onClick={() => {
          createWorktreePageMocks.cancel()
          onCancel()
        }}
      />
      <button
        type="button"
        data-testid="create-worktree-created"
        onClick={() => {
          createWorktreePageMocks.created('feature/new-worktree')
          onCreated('feature/new-worktree')
        }}
      />
    </div>
  ),
}))

vi.mock('#/web/components/repo-pages/RepoDashboardPane.tsx', () => ({
  RepoDashboardPane: ({ compact, onBack }: { compact?: boolean; onBack?: () => void }) => (
    <div data-testid="repo-dashboard-page" data-compact={compact ? 'true' : 'false'}>
      <button
        type="button"
        data-testid="repo-dashboard-back"
        aria-label="workspace.back-to-branch-navigator"
        onClick={onBack}
      />
    </div>
  ),
}))

vi.mock('#/web/components/WorkspacePickerHost.tsx', () => ({
  WorkspacePickerHost: () => <div data-testid="workspace-picker" />,
}))

vi.mock('#/web/components/repo-toolbar/RepoToolbarActions.tsx', () => ({
  BranchFilterAction: () => <div data-testid="branch-filter-action" />,
  CreateWorktreeRowAction: () => <button data-testid="create-worktree-row-action" type="button" />,
  DashboardRowAction: ({ onOpenDashboard, selected = false }: { onOpenDashboard?: () => void; selected?: boolean }) => (
    <button
      data-testid="dashboard-row-action"
      data-selected={selected ? 'true' : 'false'}
      type="button"
      onClick={onOpenDashboard}
    />
  ),
  RepoSyncAction: () => <div data-testid="repo-sync-action" />,
}))

vi.mock('#/web/components/WorkspaceZenModeToggle.tsx', () => ({
  WorkspaceZenModeToggle: (props: React.ComponentProps<'button'>) => (
    <button type="button" {...props}>
      zen
    </button>
  ),
}))

vi.mock('#/web/components/WorkspaceNavigationControls.tsx', () => ({
  WorkspaceNavigationControls: ({
    repoId,
    zenRevealTriggerEnabled,
    onZenRevealTriggerEnter,
  }: {
    repoId?: string
    zenRevealTriggerEnabled?: boolean
    onZenRevealTriggerEnter?: () => void
  }) => (
    <div data-testid="workspace-navigation-controls" data-repo-id={repoId} className="pointer-events-auto">
      <span
        data-testid="zen-mode-sidebar-trigger-surface"
        data-zen-reveal-surface={zenRevealTriggerEnabled ? '' : undefined}
      >
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

vi.mock('#/web/components/Layout.tsx', () => ({
  RepoWorkspace: ({
    mode,
    sidebarCollapsed,
    sidebarPane,
    repoWorkspacePane,
  }: {
    mode?: 'split' | 'single-pane'
    sidebarCollapsed?: boolean
    sidebarPane: React.ReactNode
    repoWorkspacePane: React.ReactNode
  }) => (
    <div
      data-testid="repo-workspace-layout"
      data-mode={mode ?? 'split'}
      data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'}
    >
      {mode === 'single-pane' ? (
        repoWorkspacePane
      ) : (
        <>
          {sidebarPane}
          {repoWorkspacePane}
        </>
      )}
    </div>
  ),
  RepoWorkspacePane: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CompactRepoWorkspace: ({
    activePane,
    sidebarPane,
    repoWorkspacePane,
  }: {
    activePane: 'navigator' | 'workspace'
    sidebarPane: React.ReactNode
    repoWorkspacePane: React.ReactNode
  }) => (
    <div data-compact-workspace="" data-active-pane={activePane}>
      <div data-compact-workspace-pane="navigator" aria-hidden={activePane === 'workspace' ? 'true' : undefined}>
        {sidebarPane}
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

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/repo-view-test')

function filesystemWorkspaceProbe() {
  return {
    status: 'ready' as const,
    name: 'workspace',
    capabilities: {
      files: { read: true as const, write: true },
      terminal: { available: true as const },
      git: { status: 'unavailable' as const },
    },
    diagnostics: [],
  }
}

function branchRepoView(branchName = 'feature/a') {
  return (
    <RepoView
      workspaceId={REPO_ID}
      routeView={{ kind: 'branch', workspaceId: REPO_ID, branchName, workspacePaneRoute: null }}
    />
  )
}

beforeEach(() => {
  responsiveMocks.mode = 'default'
  resetWorkspacesStore()
  seedRepoWithReadModelForTest({
    id: REPO_ID,
    branches: [createRepoBranch('main'), createRepoBranch('feature/a')],
    currentBranchName: null,
  })
  branchNavigatorMocks.activate.mockImplementation(() => {})
  restoreWorkspaceTabsMocks.useRestoreWorkspaceTabsOnView.mockClear()
  restoreWorkspaceTabsMocks.useRepoToasts.mockClear()
  restoreWorkspaceTabsMocks.useRestoreWorkspaceTabsOnView.mockReturnValue({ state: { phase: 'idle' }, retry: vi.fn() })
})

afterEach(() => {
  branchNavigatorMocks.activate.mockReset()
  createWorktreePageMocks.cancel.mockReset()
  createWorktreePageMocks.created.mockReset()
  vi.restoreAllMocks()
})

describe('RepoView workspace navigation', () => {
  test('does not mount an existing repo before its runtime membership is restored', () => {
    useWorkspacesStore.setState({ workspaceMembershipReady: false })

    const { container } = render(<RepoView workspaceId={REPO_ID} routeView={{ kind: 'dashboard', workspaceId: REPO_ID }} />)

    expect(repoWorkspace(container)).toBeNull()
    expect(branchNavigator(container)).toBeNull()
    expect(container.querySelector('[data-testid="repo-dashboard-page"]')).toBeNull()
  })

  test('renders a non-Git workspace in the shared shell without mounting Git-only actions', () => {
    setWorkspaceProbeForTest(REPO_ID, filesystemWorkspaceProbe())

    const { container } = render(
      <RepoView workspaceId={REPO_ID} routeView={{ kind: 'workspace-root', workspaceId: REPO_ID }} />,
    )

    expect(repoWorkspace(container)?.dataset.currentBranchName).toBe('')
    expect(repoWorkspace(container)?.dataset.workspacePaneRouteKind).toBe('workspace-root')
    expect(branchNavigator(container)).toBeNull()
    expect(container.querySelector('[data-testid="dashboard-row-action"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="workspace-root-row"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="create-worktree-row-action"]')).toBeNull()
    expect(container.querySelector('[data-testid="branch-filter-action"]')).toBeNull()
    expect(container.querySelector('[data-testid="repo-sync-action"]')).toBeNull()
    expect(restoreWorkspaceTabsMocks.useRestoreWorkspaceTabsOnView).not.toHaveBeenCalled()
    expect(restoreWorkspaceTabsMocks.useRepoToasts).not.toHaveBeenCalled()
  })

  test('renders the directory Dashboard for a non-Git dashboard route without Git navigation', () => {
    setWorkspaceProbeForTest(REPO_ID, filesystemWorkspaceProbe())

    const { container } = render(<RepoView workspaceId={REPO_ID} routeView={{ kind: 'dashboard', workspaceId: REPO_ID }} />)

    expect(container.querySelector('[data-testid="repo-dashboard-page"]')).not.toBeNull()
    expect(repoWorkspace(container)).toBeNull()
    expect(branchNavigator(container)).toBeNull()
  })

  test('renders the shared directory Dashboard for a remote non-Git workspace', () => {
    const workspaceId = workspaceIdForTest('goblin+ssh://example/srv/workspace')
    seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: {
        status: 'ready',
        name: 'remote-workspace',
        capabilities: {
          files: { read: true, write: true },
          terminal: { available: true },
          git: { status: 'unavailable' },
        },
        diagnostics: [],
      },
    })

    const { container } = render(
      <RepoView workspaceId={workspaceId} routeView={{ kind: 'dashboard', workspaceId }} />,
    )

    expect(container.querySelector('[data-testid="repo-dashboard-page"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="workspace-root-row"]')).not.toBeNull()
    expect(branchNavigator(container)).toBeNull()
    expect(container.querySelector('[data-testid="repo-sync-action"]')).toBeNull()
  })

  test('keeps a routed repo on the restore skeleton until workspace membership is ready', () => {
    resetWorkspacesStore()

    const { container } = render(
      <RepoView
        workspaceId={REPO_ID}
        routeView={{ kind: 'branch', workspaceId: REPO_ID, branchName: 'feature/a', workspacePaneRoute: null }}
      />,
    )

    expect(container.querySelector('[data-testid="repo-workspace-skeleton"]')).not.toBeNull()
    expect(container.textContent).not.toContain('repo-route.not-found-title')
  })

  test('shows an explicit not-found state after membership restore settles without the routed repo', () => {
    resetWorkspacesStore()
    useWorkspacesStore.setState({ workspaceMembershipReady: true })

    const { container } = render(<RepoView workspaceId={REPO_ID} routeView={{ kind: 'dashboard', workspaceId: REPO_ID }} />)

    expect(container.textContent).toContain('repo-route.not-found-title')
    expect(container.textContent).toContain('/tmp/repo-view-test')
    expect(container.textContent).not.toContain('goblin+file://')
  })

  test('moves a missing routed repo from restore skeleton to not-found when membership settles', () => {
    resetWorkspacesStore()

    const result = render(<RepoView workspaceId={REPO_ID} routeView={{ kind: 'dashboard', workspaceId: REPO_ID }} />)

    expect(result.container.querySelector('[data-testid="repo-workspace-empty-skeleton"]')).not.toBeNull()
    expect(result.container.textContent).not.toContain('repo-route.not-found-title')

    act(() => {
      useWorkspacesStore.setState({ workspaceMembershipReady: true })
    })

    expect(result.container.querySelector('[data-testid="repo-workspace-empty-skeleton"]')).toBeNull()
    expect(result.container.textContent).toContain('repo-route.not-found-title')
  })

  test('keeps a restore stub on the skeleton without mounting repo data surfaces', () => {
    useWorkspacesStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [REPO_ID]: {
          ...state.workspaces[REPO_ID]!,
          session: { ...state.workspaces[REPO_ID]!.session, projectionState: 'stub' },
        },
      },
    }))

    const { container } = render(branchRepoView())

    expect(container.querySelector('[data-testid="repo-workspace-skeleton"]')).not.toBeNull()
    expect(branchNavigator(container)).toBeNull()
    expect(repoWorkspace(container)).toBeNull()
    expect(restoreWorkspaceTabsMocks.useRestoreWorkspaceTabsOnView).toHaveBeenCalledWith({ workspaceId: REPO_ID })
  })

  test('replaces the stub skeleton with a stable promotion failure view', () => {
    restoreWorkspaceTabsMocks.useRestoreWorkspaceTabsOnView.mockReturnValue({
      state: { phase: 'failed', message: 'server request failed' },
      retry: vi.fn(),
    })
    useWorkspacesStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [REPO_ID]: {
          ...state.workspaces[REPO_ID]!,
          session: { ...state.workspaces[REPO_ID]!.session, projectionState: 'stub' },
        },
      },
    }))

    const { container } = render(branchRepoView())

    expect(container.querySelector('[data-testid="repo-workspace-skeleton"]')).toBeNull()
    expect(container.textContent).toContain('server request failed')
    expect(container.textContent).toContain('lazy-restore.failed')
  })

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
    resetWorkspacesStore()
    seedRepoShellForTest({ id: REPO_ID, currentBranchName: null })

    expect(() =>
      render(
        <RepoView
          workspaceId={REPO_ID}
        routeView={{ kind: 'branch', workspaceId: REPO_ID, branchName: 'feature/a', workspacePaneRoute: null }}
        />,
      ),
    ).not.toThrow()
  })

  test('route branch view uses the URL branch as the displayed workspace branch', () => {
    const { container } = render(
      <RepoView
        workspaceId={REPO_ID}
        routeView={{ kind: 'branch', workspaceId: REPO_ID, branchName: 'feature/a', workspacePaneRoute: null }}
      />,
    )

    expect(repoWorkspace(container)?.dataset.currentBranchName).toBe('feature/a')
  })

  test('route branch view leaves store selection unchanged when read model is ready', () => {
    render(
      <RepoView
        workspaceId={REPO_ID}
        routeView={{ kind: 'branch', workspaceId: REPO_ID, branchName: 'feature/a', workspacePaneRoute: null }}
      />,
    )
  })

  test('new worktree page cancel returns to the stored source route', () => {
    const onCancelRepoNewWorktree = vi.fn()
    const onOpenWorkspaceDashboard = vi.fn()
    const { container } = render(
      <RepoView
        workspaceId={REPO_ID}
        routeView={{ kind: 'newWorktree', workspaceId: REPO_ID }}
        onCancelRepoNewWorktree={onCancelRepoNewWorktree}
        onOpenWorkspaceDashboard={onOpenWorkspaceDashboard}
      />,
    )

    buttonByTestId(container, 'create-worktree-cancel')?.click()

    expect(onCancelRepoNewWorktree).toHaveBeenCalledWith(REPO_ID)
    expect(onOpenWorkspaceDashboard).not.toHaveBeenCalled()
  })

  test('new worktree page cancel falls back to repo root when route cancel is unavailable', () => {
    const onOpenWorkspaceNavigator = vi.fn()
    const onOpenWorkspaceDashboard = vi.fn()
    const { container } = render(
      <RepoView
        workspaceId={REPO_ID}
        routeView={{ kind: 'newWorktree', workspaceId: REPO_ID }}
        onOpenWorkspaceNavigator={onOpenWorkspaceNavigator}
        onOpenWorkspaceDashboard={onOpenWorkspaceDashboard}
      />,
    )

    buttonByTestId(container, 'create-worktree-cancel')?.click()

    expect(onOpenWorkspaceNavigator).toHaveBeenCalledWith(REPO_ID)
    expect(onOpenWorkspaceDashboard).not.toHaveBeenCalled()
  })

  test('new worktree page creation replaces the form route with the created branch route', () => {
    const onCancelRepoNewWorktree = vi.fn()
    const onReplaceRepoBranch = vi.fn()
    const { container } = render(
      <RepoView
        workspaceId={REPO_ID}
        routeView={{ kind: 'newWorktree', workspaceId: REPO_ID }}
        onCancelRepoNewWorktree={onCancelRepoNewWorktree}
        onReplaceRepoBranch={onReplaceRepoBranch}
      />,
    )

    buttonByTestId(container, 'create-worktree-created')?.click()

    expect(onReplaceRepoBranch).toHaveBeenCalledWith(REPO_ID, 'feature/new-worktree')
    expect(onCancelRepoNewWorktree).not.toHaveBeenCalled()
  })

  test('compact repo root keeps the navigator visible with an empty workspace pane hidden', () => {
    responsiveMocks.mode = 'compact'

    const { container } = render(<RepoView workspaceId={REPO_ID} routeView={{ kind: 'empty', workspaceId: REPO_ID }} />)

    expect(compactWorkspace(container)?.dataset.activePane).toBe('navigator')
    expect(compactPane(container, 'navigator')?.getAttribute('aria-hidden')).toBeNull()
    expect(compactPane(container, 'workspace')?.getAttribute('aria-hidden')).toBe('true')
    expect(branchNavigator(container)).not.toBeNull()
    expect(container.querySelector('[data-testid="repo-empty-workspace-pane"]')).not.toBeNull()
    expect(repoWorkspace(container)).toBeNull()
  })

  test('large-screen Zen Mode repo root keeps the sidebar as the active single pane', () => {
    useWorkspacesStore.getState().setZenMode(true)

    const { container } = render(<RepoView workspaceId={REPO_ID} routeView={{ kind: 'empty', workspaceId: REPO_ID }} />)

    expect(workspace(container)).toBeNull()
    expect(branchNavigator(container)).not.toBeNull()
    expect(container.querySelector('[data-testid="repo-empty-workspace-pane"]')).toBeNull()
  })

  test('compact dashboard page shows the workspace pane and returns to repo root', () => {
    responsiveMocks.mode = 'compact'
    const onOpenWorkspaceNavigator = vi.fn()

    const { container } = render(
      <RepoView
        workspaceId={REPO_ID}
        routeView={{ kind: 'dashboard', workspaceId: REPO_ID }}
        onOpenWorkspaceNavigator={onOpenWorkspaceNavigator}
      />,
    )

    expect(compactWorkspace(container)?.dataset.activePane).toBe('workspace')
    expect(compactPane(container, 'navigator')?.getAttribute('aria-hidden')).toBe('true')
    expect(compactPane(container, 'workspace')?.getAttribute('aria-hidden')).toBeNull()

    buttonByLabel(container, 'workspace.back-to-branch-navigator')?.click()

    expect(onOpenWorkspaceNavigator).toHaveBeenCalledWith(REPO_ID)
  })

  test('compact new worktree page shows the workspace pane with compact page chrome', () => {
    responsiveMocks.mode = 'compact'

    const { container } = render(
      <RepoView workspaceId={REPO_ID} routeView={{ kind: 'newWorktree', workspaceId: REPO_ID }} />,
    )

    expect(compactWorkspace(container)?.dataset.activePane).toBe('workspace')
    expect(container.querySelector<HTMLElement>('[data-testid="create-worktree-page"]')?.dataset.compact).toBe('true')
  })

  test('large-screen Zen Mode uses Branch Navigator until a branch opens a collapsed split workspace', () => {
    useWorkspacesStore.getState().setZenMode(true)
    const { container, rerender } = render(<RepoView workspaceId={REPO_ID} />)

    expect(branchNavigator(container)).not.toBeNull()
    expect(repoWorkspace(container)).toBeNull()
    expect(workspace(container)).toBeNull()

    act(() => {
      branchNavigator(container)?.click()
      rerender(branchRepoView())
    })

    expect(branchNavigator(container)).not.toBeNull()
    expect(workspace(container)?.dataset.mode).toBe('split')
    expect(workspace(container)?.dataset.sidebarCollapsed).toBe('true')
    expect(repoWorkspace(container)).not.toBeNull()
    expect(repoWorkspace(container)?.dataset.trafficLightOffset).toBe('true')
    expect(zenModeSidebarTrigger(container)).not.toBeNull()
    const sidebarTops = [...container.querySelectorAll<HTMLElement>('[data-testid="repo-shell-sidebar-top"]')]
    expect(sidebarTops.length).toBeGreaterThan(0)
    const closedRevealTop = zenModeSidebarReveal(container)?.querySelector<HTMLElement>(
      '[data-testid="repo-shell-sidebar-top"]',
    )
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('false')
    expect(zenModeSidebarReveal(container)?.dataset.panelInteractive).toBe('false')
    expect(zenModeSidebarReveal(container)?.hasAttribute('data-interactive')).toBe(false)
    expect(zenModeSidebarDragPlate(container)).toBeNull()
    expect(closedRevealTop?.dataset.titleBarChromeRegion).toBeUndefined()
    expect(closedRevealTop?.querySelector('[data-title-bar-chrome-region="no-drag"]')).toBeNull()
  })

  test('large-screen collapsed Zen Mode reveals the sidebar on left-edge hover below the titlebar', () => {
    useWorkspacesStore.getState().setZenMode(true)
    useWorkspacesStore.getState().setWorkspacePaneSize(55)
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
    const { container } = render(branchRepoView())

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
      '[data-testid="repo-shell-sidebar-top"]',
    )
    expect(floatingSidebarTop?.hasAttribute('data-interactive')).toBe(false)
    expect(floatingSidebarTop?.dataset.titleBarChromeRegion).toBeUndefined()
    expect(floatingSidebarTop?.querySelector('[data-title-bar-chrome-region="no-drag"]')).toBeNull()
  })

  test('large-screen collapsed Zen Mode opens the dashboard from the revealed sidebar', () => {
    const onOpenWorkspaceDashboard = vi.fn()
    useWorkspacesStore.getState().setZenMode(true)
    const { container } = render(
      <RepoView
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
    useWorkspacesStore.getState().setZenMode(true)
    const { container } = render(branchRepoView())

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
    const { container } = render(branchRepoView())

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
      useWorkspacesStore.getState().setZenMode(true)
      const { container } = render(branchRepoView())

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
      document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 355, clientY: 24 }))
    })

    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')
  })

  test('large-screen collapsed Zen Mode resizes the same sidebar width state from the reveal edge', () => {
    useWorkspacesStore.getState().setZenMode(true)
    useWorkspacesStore.getState().setWorkspacePaneSize(70)
    const { container } = render(branchRepoView())

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
    const result = render(branchRepoView())

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
    vi.useFakeTimers()
    try {
      useWorkspacesStore.getState().setZenMode(true)
      const { container } = render(branchRepoView())

      act(() => {
        zenModeSidebarTrigger(container)?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      })
      expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')

      act(() => {
        useWorkspacesStore.getState().setZenMode(false)
      })

      expect(workspace(container)?.dataset.sidebarCollapsed).toBe('false')
      expect(zenModeSidebarReveal(container)?.dataset.open).toBe('true')
      expect(zenModeSidebarReveal(container)?.dataset.panelInteractive).toBe('false')
      expect(zenModeSidebarReveal(container)?.hasAttribute('data-interactive')).toBe(false)
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
      useWorkspacesStore.getState().setZenMode(true)
      const { container } = render(branchRepoView())

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
    } finally {
      vi.useRealTimers()
    }
  })

  test('compact branch activation slides Repo Workspace into the active pane', () => {
    responsiveMocks.mode = 'compact'
    const { container, rerender } = render(<RepoView workspaceId={REPO_ID} />)

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

    act(() => {})

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
        rerender(<RepoView workspaceId={REPO_ID} />)
      })

      expect(compactWorkspace(container)?.dataset.activePane).toBe('navigator')
      expect(compactPane(container, 'workspace')?.getAttribute('aria-hidden')).toBe('true')
      expect(repoWorkspace(container)?.dataset.currentBranchName).toBe('feature/a')
      expect(repoWorkspace(container)?.dataset.workspacePaneRouteKind).toBe('inactive')
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
    setReadModelLoading(REPO_ID)
    const { container } = render(<RepoView workspaceId={REPO_ID} />)

    expect(workspace(container)?.dataset.mode).toBe('split')
    expect(container.querySelector('[data-testid="workspace-picker"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="create-worktree-row-action"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="repo-workspace-empty-skeleton"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="repo-workspace-skeleton"]')).toBeNull()
    expect(container.querySelectorAll('[data-testid="branch-navigator-skeleton-action"]')).toHaveLength(6)
  })

  test('large-screen focused initial loading with current branch keeps floating sidebar reveal available', () => {
    useWorkspacesStore.getState().setZenMode(true)
    setReadModelLoading(REPO_ID)

    const { container } = render(branchRepoView())

    expect(workspace(container)?.dataset.sidebarCollapsed).toBe('true')
    expect(zenModeSidebarReveal(container)).not.toBeNull()
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('false')
  })

  test('large-screen unavailable repo keeps the repo shell chrome available', () => {
    setRepoUnavailable(REPO_ID)
    const { container } = render(branchRepoView())

    expect(workspace(container)?.dataset.mode).toBe('split')
    expect(container.querySelector('[data-testid="workspace-picker"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="create-worktree-row-action"]')).not.toBeNull()
    expect(container.querySelector('button[aria-label="app-chrome.settings"]')).not.toBeNull()
    expect(document.body.textContent).toContain('repo-unavailable.title')
  })

  test('large-screen focused unavailable repo with current branch keeps floating sidebar reveal available', () => {
    useWorkspacesStore.getState().setZenMode(true)
    setRepoUnavailable(REPO_ID)

    const { container } = render(branchRepoView())

    expect(workspace(container)?.dataset.sidebarCollapsed).toBe('true')
    expect(zenModeSidebarReveal(container)).not.toBeNull()
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('false')
  })

  test('compact initial loading shows the selected Repo Workspace skeleton as the single pane', () => {
    responsiveMocks.mode = 'compact'
    setReadModelLoading(REPO_ID)

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

function buttonByTestId(container: HTMLElement, testId: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)
}

function buttonByLabel(container: HTMLElement, label: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
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

function zenModeSidebarDragPlate(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="zen-mode-sidebar-drag-plate"]')
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

function zenModeSidebarTriggerSurface(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="zen-mode-sidebar-trigger-surface"]')
}

function workspaceNavigationControls(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="workspace-navigation-controls"]')
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

function setReadModelLoading(repoId: string) {
  const repo = useWorkspacesStore.getState().workspaces[repoId]
  if (!repo) throw new Error(`missing repo ${repoId}`)
  if (repo.capability.kind !== 'git') throw new Error(`expected Git repo ${repoId}`)
  const dataLoads = {
    ...repo.capability.git.dataLoads,
    repoReadModel: {
      ...repo.capability.git.dataLoads.repoReadModel,
      phase: 'loading' as const,
      loadedAt: null,
      error: null,
      stale: false,
    },
  }
  useWorkspacesStore.setState({
    workspaces: {
      [repoId]: {
        ...repo,
        capability: {
          ...repo.capability,
          git: { ...repo.capability.git, dataLoads },
        },
      },
    },
  })
}

function setRepoUnavailable(repoId: string) {
  const repo = useWorkspacesStore.getState().workspaces[repoId]
  if (!repo) throw new Error(`missing repo ${repoId}`)
  useWorkspacesStore.setState({
    workspaces: {
      [repoId]: {
        ...repo,
        availability: { phase: 'unavailable' as const, reason: 'error.failed-read-repo', checkedAt: 0 },
      },
    },
  })
}
