// @vitest-environment jsdom

import { seedRepoShellForTest, resetWorkspacesStore } from '#/web/test-utils/repo-store.ts'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { describe, expect, test, vi } from 'vitest'
import '#/web/test-utils/workspace-view.tsx'
import { WorkspaceView } from '#/web/components/WorkspaceView.tsx'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import {
  responsiveMocks,
  REPO_ID,
  branchWorkspaceView,
  render,
  gitWorkspaceNavigator,
  buttonByTestId,
  buttonByLabel,
  workspacePane,
  workspaceLayout,
  compactWorkspace,
  compactPane,
  zenModeSidebarDragPlate,
  zenModeSidebarReveal,
  zenModeSidebarTrigger,
} from '#/web/test-utils/workspace-view.tsx'

describe('WorkspaceView branch and page routes', () => {
  test('large-screen branch activation keeps the Git workspace navigator visible', async () => {
    const { container } = render(branchWorkspaceView())

    expect(workspaceLayout(container)?.dataset.mode).toBe('split')

    await flushTestUpdates(() => {
      gitWorkspaceNavigator(container)?.click()
    })

    expect(gitWorkspaceNavigator(container)).not.toBeNull()
    expect(workspaceLayout(container)?.dataset.mode).toBe('split')
    expect(workspacePane(container)).not.toBeNull()
  })

  test('route branch view does not write current branch into the store before read model is ready', () => {
    resetWorkspacesStore()
    seedRepoShellForTest({ id: REPO_ID })

    expect(() =>
      render(
        <WorkspaceView
          workspaceId={REPO_ID}
          routeView={{ kind: 'branch', workspaceId: REPO_ID, branchName: 'feature/a', workspacePaneRoute: null }}
        />,
      ),
    ).not.toThrow()
  })

  test('route branch view uses the URL branch as the displayed workspace branch', () => {
    const { container } = render(
      <WorkspaceView
        workspaceId={REPO_ID}
        routeView={{ kind: 'branch', workspaceId: REPO_ID, branchName: 'feature/a', workspacePaneRoute: null }}
      />,
    )

    expect(workspacePane(container)?.dataset.currentBranchName).toBe('feature/a')
  })

  test('route branch view leaves store selection unchanged when read model is ready', () => {
    render(
      <WorkspaceView
        workspaceId={REPO_ID}
        routeView={{ kind: 'branch', workspaceId: REPO_ID, branchName: 'feature/a', workspacePaneRoute: null }}
      />,
    )
  })

  test('new worktree page cancel returns to the stored source route', () => {
    const onCancelRepoNewWorktree = vi.fn()
    const onOpenWorkspaceDashboard = vi.fn()
    const { container } = render(
      <WorkspaceView
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
      <WorkspaceView
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

  test('new worktree page creation replaces the form route with the created worktree route', () => {
    const onCancelRepoNewWorktree = vi.fn()
    const onReplaceRepoWorktree = vi.fn()
    const { container } = render(
      <WorkspaceView
        workspaceId={REPO_ID}
        routeView={{ kind: 'newWorktree', workspaceId: REPO_ID }}
        onCancelRepoNewWorktree={onCancelRepoNewWorktree}
        onReplaceRepoWorktree={onReplaceRepoWorktree}
      />,
    )

    buttonByTestId(container, 'create-worktree-created')?.click()

    expect(onReplaceRepoWorktree).toHaveBeenCalledWith(REPO_ID, '/tmp/new-worktree', 1)
    expect(onCancelRepoNewWorktree).not.toHaveBeenCalled()
  })

  test('compact repo root keeps the navigator visible with an empty workspace pane hidden', () => {
    responsiveMocks.mode = 'compact'

    const { container } = render(
      <WorkspaceView workspaceId={REPO_ID} routeView={{ kind: 'empty', workspaceId: REPO_ID }} />,
    )

    expect(compactWorkspace(container)?.dataset.activePane).toBe('navigator')
    expect(compactPane(container, 'navigator')?.getAttribute('aria-hidden')).toBeNull()
    expect(compactPane(container, 'workspace')?.getAttribute('aria-hidden')).toBe('true')
    expect(gitWorkspaceNavigator(container)).not.toBeNull()
    expect(container.querySelector('[data-testid="empty-workspace-pane"]')).not.toBeNull()
    expect(workspacePane(container)).toBeNull()
  })

  test('large-screen Zen Mode repo root keeps the sidebar as the active single pane', async () => {
    workspacesStore.getState().setZenMode(true)

    const { container } = render(
      <WorkspaceView workspaceId={REPO_ID} routeView={{ kind: 'empty', workspaceId: REPO_ID }} />,
    )

    expect(workspaceLayout(container)).toBeNull()
    expect(gitWorkspaceNavigator(container)).not.toBeNull()
    expect(container.querySelector('[data-testid="empty-workspace-pane"]')).toBeNull()
  })

  test('compact dashboard page shows the workspace pane and returns to repo root', () => {
    responsiveMocks.mode = 'compact'
    const onOpenWorkspaceNavigator = vi.fn()

    const { container } = render(
      <WorkspaceView
        workspaceId={REPO_ID}
        routeView={{ kind: 'dashboard', workspaceId: REPO_ID }}
        onOpenWorkspaceNavigator={onOpenWorkspaceNavigator}
      />,
    )

    expect(compactWorkspace(container)?.dataset.activePane).toBe('workspace')
    expect(compactPane(container, 'navigator')?.getAttribute('aria-hidden')).toBe('true')
    expect(compactPane(container, 'workspace')?.getAttribute('aria-hidden')).toBeNull()

    buttonByLabel(container, 'workspace.back-to-workspace-navigator')?.click()

    expect(onOpenWorkspaceNavigator).toHaveBeenCalledWith(REPO_ID)
  })

  test('compact new worktree page shows the workspace pane with compact page chrome', () => {
    responsiveMocks.mode = 'compact'

    const { container } = render(
      <WorkspaceView workspaceId={REPO_ID} routeView={{ kind: 'newWorktree', workspaceId: REPO_ID }} />,
    )

    expect(compactWorkspace(container)?.dataset.activePane).toBe('workspace')
    expect(container.querySelector<HTMLElement>('[data-testid="create-worktree-page"]')?.dataset.compact).toBe('true')
  })

  test('large-screen Zen Mode uses the Git workspace navigator until a branch opens a collapsed split workspace', async () => {
    workspacesStore.getState().setZenMode(true)
    const { container, rerender } = render(<WorkspaceView workspaceId={REPO_ID} />)

    expect(gitWorkspaceNavigator(container)).not.toBeNull()
    expect(workspacePane(container)).toBeNull()
    expect(workspaceLayout(container)).toBeNull()

    await flushTestUpdates(async () => {
      gitWorkspaceNavigator(container)?.click()
      await rerender(branchWorkspaceView())
    })

    expect(gitWorkspaceNavigator(container)).not.toBeNull()
    expect(workspaceLayout(container)?.dataset.mode).toBe('split')
    expect(workspaceLayout(container)?.dataset.sidebarCollapsed).toBe('true')
    expect(workspacePane(container)).not.toBeNull()
    expect(workspacePane(container)?.dataset.trafficLightOffset).toBe('true')
    expect(zenModeSidebarTrigger(container)).not.toBeNull()
    const sidebarTops = [...container.querySelectorAll<HTMLElement>('[data-testid="workspace-shell-sidebar-top"]')]
    expect(sidebarTops.length).toBeGreaterThan(0)
    const closedRevealTop = zenModeSidebarReveal(container)?.querySelector<HTMLElement>(
      '[data-testid="workspace-shell-sidebar-top"]',
    )
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('false')
    expect(zenModeSidebarReveal(container)?.dataset.panelInteractive).toBe('false')
    expect(zenModeSidebarReveal(container)?.hasAttribute('data-interactive')).toBe(false)
    expect(zenModeSidebarDragPlate(container)).toBeNull()
    expect(closedRevealTop?.dataset.titleBarChromeRegion).toBeUndefined()
    expect(closedRevealTop?.querySelector('[data-title-bar-chrome-region="no-drag"]')).toBeNull()
  })
})
