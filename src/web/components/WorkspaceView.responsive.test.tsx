// @vitest-environment jsdom

import { flushTestUpdates } from '#/test-utils/render.tsx'
import { describe, expect, test, vi } from 'vitest'
import '#/web/test-utils/workspace-view.tsx'
import { useFakeTimers } from '#/test-utils/timers.ts'
import { WorkspaceView } from '#/web/components/WorkspaceView.tsx'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'
import {
  responsiveMocks,
  REPO_ID,
  branchWorkspaceView,
  render,
  gitWorkspaceNavigator,
  workspacePane,
  workspaceLayout,
  compactWorkspace,
  compactPane,
  zenModeSidebarReveal,
  zenModeSidebarTrigger,
  setReadModelLoading,
  setRepoUnavailable,
} from '#/web/test-utils/workspace-view.tsx'

describe('WorkspaceView responsive layout', () => {
  test('compact branch activation slides Repo Workspace into the active pane', async () => {
    responsiveMocks.mode = 'compact'
    const { container, rerender } = render(<WorkspaceView workspaceId={REPO_ID} />)

    expect(container.querySelector('[data-testid="workspace-shell-sidebar-top"]')).toBeNull()
    expect(zenModeSidebarTrigger(container)).toBeNull()
    expect(compactWorkspace(container)?.dataset.activePane).toBe('navigator')
    expect(compactPane(container, 'navigator')?.getAttribute('aria-hidden')).toBeNull()
    expect(compactPane(container, 'workspace')?.getAttribute('aria-hidden')).toBe('true')

    await flushTestUpdates(async () => {
      gitWorkspaceNavigator(container)?.click()
      await rerender(branchWorkspaceView())
    })

    expect(compactWorkspace(container)?.dataset.activePane).toBe('workspace')
    expect(compactPane(container, 'navigator')?.getAttribute('aria-hidden')).toBe('true')
    expect(compactPane(container, 'workspace')?.getAttribute('aria-hidden')).toBeNull()
    expect(workspacePane(container)).not.toBeNull()
  })

  test('compact mode derives Repo Workspace from an existing current branch', async () => {
    responsiveMocks.mode = 'compact'
    const { container } = render(branchWorkspaceView())

    await flushTestUpdates(() => {})

    expect(compactWorkspace(container)?.dataset.activePane).toBe('workspace')
    expect(compactPane(container, 'navigator')?.getAttribute('aria-hidden')).toBe('true')
    expect(compactPane(container, 'workspace')?.getAttribute('aria-hidden')).toBeNull()
    expect(workspacePane(container)).not.toBeNull()
  })

  test('compact back transition keeps the outgoing Repo Workspace content during slide-out', async () => {
    useFakeTimers()
    responsiveMocks.mode = 'compact'
    const { container, rerender } = render(branchWorkspaceView())

    expect(workspacePane(container)?.dataset.currentBranchName).toBe('feature/a')
    expect(workspacePane(container)?.dataset.shortcutsEnabled).toBe('true')

    await flushTestUpdates(async () => {
      await rerender(<WorkspaceView workspaceId={REPO_ID} />)
    })

    expect(compactWorkspace(container)?.dataset.activePane).toBe('navigator')
    expect(compactPane(container, 'workspace')?.getAttribute('aria-hidden')).toBe('true')
    expect(workspacePane(container)?.dataset.currentBranchName).toBe('feature/a')
    expect(workspacePane(container)?.dataset.workspacePaneRouteKind).toBe('inactive')
    expect(workspacePane(container)?.dataset.shortcutsEnabled).toBe('false')

    await flushTestUpdates(() => {
      vi.advanceTimersByTime(WORKSPACE_PANE_TRANSITION_MS)
    })

    expect(workspacePane(container)?.dataset.currentBranchName).toBe('')
  })

  test('large-screen missing snapshot data keeps stable shell chrome without a synthetic skeleton', () => {
    setReadModelLoading(REPO_ID)
    const { container } = render(<WorkspaceView workspaceId={REPO_ID} />)

    expect(workspaceLayout(container)?.dataset.mode).toBe('split')
    expect(container.querySelector('[data-testid="workspace-picker"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="create-worktree-row-action"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="empty-workspace-pane-skeleton"]')).toBeNull()
    expect(container.querySelector('[data-testid="workspace-pane-skeleton"]')).toBeNull()
    expect(container.querySelectorAll('[data-testid="git-workspace-navigator-skeleton-action"]')).toHaveLength(0)
  })

  test('large-screen focused initial loading with current branch keeps floating sidebar reveal available', async () => {
    workspacesStore.getState().setZenMode(true)
    setReadModelLoading(REPO_ID)

    const { container } = render(branchWorkspaceView())

    expect(workspaceLayout(container)?.dataset.sidebarCollapsed).toBe('true')
    expect(zenModeSidebarReveal(container)).not.toBeNull()
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('false')
  })

  test('large-screen unavailable Workspace keeps capability-neutral shell chrome available', () => {
    setRepoUnavailable(REPO_ID)
    const { container } = render(branchWorkspaceView())

    expect(workspaceLayout(container)?.dataset.mode).toBe('split')
    expect(container.querySelector('[data-testid="workspace-picker"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="create-worktree-row-action"]')).toBeNull()
    expect(container.querySelector('button[aria-label="app-chrome.settings"]')).not.toBeNull()
    expect(document.body.textContent).toContain('workspace-unavailable.title')
  })

  test('large-screen focused unavailable Workspace keeps floating sidebar reveal available', async () => {
    workspacesStore.getState().setZenMode(true)
    setRepoUnavailable(REPO_ID)

    const { container } = render(branchWorkspaceView())

    expect(workspaceLayout(container)?.dataset.sidebarCollapsed).toBe('true')
    expect(zenModeSidebarReveal(container)).not.toBeNull()
    expect(zenModeSidebarReveal(container)?.dataset.open).toBe('false')
  })

  test('compact missing snapshot data keeps the selected Repo Workspace shell as the single pane', () => {
    responsiveMocks.mode = 'compact'
    setReadModelLoading(REPO_ID)

    const { container } = render(branchWorkspaceView())

    expect(workspaceLayout(container)).toBeNull()
    expect(container.querySelector('[data-testid="workspace-pane-skeleton"]')).toBeNull()
    expect(workspacePane(container)).not.toBeNull()
    expect(container.querySelector('[data-testid="empty-workspace-pane-skeleton"]')).toBeNull()
    expect(container.querySelectorAll('[data-testid="git-workspace-navigator-skeleton-action"]')).toHaveLength(0)
  })

  test('compact restore stub keeps a worktree route in the workspace pane', () => {
    responsiveMocks.mode = 'compact'
    workspacesStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [REPO_ID]: {
          ...state.workspaces[REPO_ID]!,
          session: { ...state.workspaces[REPO_ID]!.session, projectionState: 'stub' },
        },
      },
    }))

    const { container } = render(
      <WorkspaceView
        workspaceId={REPO_ID}
        routeView={{
          kind: 'worktree',
          workspaceId: REPO_ID,
          worktreePath: '/tmp/repo-view-feature-a',
          workspacePaneRoute: { kind: 'static', tab: 'status' },
        }}
      />,
    )

    expect(compactWorkspace(container)?.dataset.activePane).toBe('workspace')
    expect(compactPane(container, 'navigator')?.getAttribute('aria-hidden')).toBe('true')
    expect(compactPane(container, 'workspace')?.getAttribute('aria-hidden')).toBeNull()
    expect(container.querySelector('[data-testid="workspace-pane-skeleton"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="empty-workspace-pane-skeleton"]')).toBeNull()
  })

  test('resizing from split large-screen mode to compact shows Repo Workspace when a branch is selected', async () => {
    const { container, rerender } = render(branchWorkspaceView())

    await flushTestUpdates(() => {
      gitWorkspaceNavigator(container)?.click()
    })

    expect(gitWorkspaceNavigator(container)).not.toBeNull()
    expect(workspacePane(container)).not.toBeNull()

    responsiveMocks.mode = 'compact'
    await flushTestUpdates(() => rerender(branchWorkspaceView()))

    expect(compactWorkspace(container)?.dataset.activePane).toBe('workspace')
    expect(compactPane(container, 'navigator')?.getAttribute('aria-hidden')).toBe('true')
    expect(compactPane(container, 'workspace')?.getAttribute('aria-hidden')).toBeNull()
    expect(workspacePane(container)).not.toBeNull()
  })
})
