// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import '#/web/test-utils/workspace-view.tsx'
import { useFakeTimers } from '#/test-utils/timers.ts'
import { WorkspaceView } from '#/web/components/WorkspaceView.tsx'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { WORKSPACE_PANE_TRANSITION_MS } from '#/web/components/workspace-motion.ts'
import {
  responsiveMocks,
  REPO_ID,
  branchWorkspaceView,
  render,
  branchNavigator,
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
  test('compact branch activation slides Repo Workspace into the active pane', () => {
    responsiveMocks.mode = 'compact'
    const { container, rerender } = render(<WorkspaceView workspaceId={REPO_ID} />)

    expect(container.querySelector('[data-testid="workspace-shell-sidebar-top"]')).toBeNull()
    expect(zenModeSidebarTrigger(container)).toBeNull()
    expect(compactWorkspace(container)?.dataset.activePane).toBe('navigator')
    expect(compactPane(container, 'navigator')?.getAttribute('aria-hidden')).toBeNull()
    expect(compactPane(container, 'workspace')?.getAttribute('aria-hidden')).toBe('true')

    act(() => {
      branchNavigator(container)?.click()
      rerender(branchWorkspaceView())
    })

    expect(compactWorkspace(container)?.dataset.activePane).toBe('workspace')
    expect(compactPane(container, 'navigator')?.getAttribute('aria-hidden')).toBe('true')
    expect(compactPane(container, 'workspace')?.getAttribute('aria-hidden')).toBeNull()
    expect(workspacePane(container)).not.toBeNull()
  })

  test('compact mode derives Repo Workspace from an existing current branch', () => {
    responsiveMocks.mode = 'compact'
    const { container } = render(branchWorkspaceView())

    act(() => {})

    expect(compactWorkspace(container)?.dataset.activePane).toBe('workspace')
    expect(compactPane(container, 'navigator')?.getAttribute('aria-hidden')).toBe('true')
    expect(compactPane(container, 'workspace')?.getAttribute('aria-hidden')).toBeNull()
    expect(workspacePane(container)).not.toBeNull()
  })

  test('compact back transition keeps the outgoing Repo Workspace content during slide-out', () => {
    useFakeTimers()
    responsiveMocks.mode = 'compact'
    const { container, rerender } = render(branchWorkspaceView())

    expect(workspacePane(container)?.dataset.currentBranchName).toBe('feature/a')
    expect(workspacePane(container)?.dataset.shortcutsEnabled).toBe('true')

    act(() => {
      rerender(<WorkspaceView workspaceId={REPO_ID} />)
    })

    expect(compactWorkspace(container)?.dataset.activePane).toBe('navigator')
    expect(compactPane(container, 'workspace')?.getAttribute('aria-hidden')).toBe('true')
    expect(workspacePane(container)?.dataset.currentBranchName).toBe('feature/a')
    expect(workspacePane(container)?.dataset.workspacePaneRouteKind).toBe('inactive')
    expect(workspacePane(container)?.dataset.shortcutsEnabled).toBe('false')

    act(() => {
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
    expect(container.querySelectorAll('[data-testid="branch-navigator-skeleton-action"]')).toHaveLength(0)
  })

  test('large-screen focused initial loading with current branch keeps floating sidebar reveal available', () => {
    useWorkspacesStore.getState().setZenMode(true)
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

  test('large-screen focused unavailable Workspace keeps floating sidebar reveal available', () => {
    useWorkspacesStore.getState().setZenMode(true)
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
    expect(container.querySelectorAll('[data-testid="branch-navigator-skeleton-action"]')).toHaveLength(0)
  })

  test('resizing from split large-screen mode to compact shows Repo Workspace when a branch is selected', () => {
    const { container, rerender } = render(branchWorkspaceView())

    act(() => {
      branchNavigator(container)?.click()
    })

    expect(branchNavigator(container)).not.toBeNull()
    expect(workspacePane(container)).not.toBeNull()

    responsiveMocks.mode = 'compact'
    rerender(branchWorkspaceView())

    expect(compactWorkspace(container)?.dataset.activePane).toBe('workspace')
    expect(compactPane(container, 'navigator')?.getAttribute('aria-hidden')).toBe('true')
    expect(compactPane(container, 'workspace')?.getAttribute('aria-hidden')).toBeNull()
    expect(workspacePane(container)).not.toBeNull()
  })
})
