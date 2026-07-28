// @vitest-environment jsdom

import {
  GitWorkspacePaneContentHarness,
  REPO_ID,
  defaultBranchActionSurface,
  emptyTerminalReadContext,
  flushAsyncWork,
  getTestGitWorkspacePanePresentation,
  gitWorkspacePaneProjection,
  preferenceBackedWorkspacePaneTabModel,
  repoClientMocks,
  responsiveMocks,
  staticEntry,
} from '#/web/test-utils/git-workspace-pane-content.tsx'
import { seedRepoWithReadModelForTest, createBranchSnapshot } from '#/web/test-utils/repo-store.ts'
import { screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { BranchActionSurfaceContext } from '#/web/components/repo-workspace/branch-action-surface-context.ts'
import { GitWorkspacePaneContent } from '#/web/components/repo-workspace/GitWorkspacePaneContent.tsx'
import { TerminalSessionReadContext } from '#/web/components/terminal/terminal-session-context.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
describe('GitWorkspacePaneContent routes', () => {
  test('offers a compact return to the branch list when the last routed branch no longer exists', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [],
      currentBranchName: null,
    })
    const existingPresentationRepo = gitWorkspacePaneProjection(repo)
    const presentationRepo = {
      ...existingPresentationRepo,
      ui: { ...existingPresentationRepo.ui, currentBranchName: 'feature/removed' },
    }
    const detail = getTestGitWorkspacePanePresentation(presentationRepo)
    const onBackToBranchNavigator = vi.fn()

    const renderMissingBranch = () =>
      renderInJsdom(
        <TerminalSessionReadContext value={emptyTerminalReadContext}>
          <GitWorkspacePaneContentHarness
            repo={presentationRepo}
            detail={detail}
            workspacePaneId="workspace"
            onBackToBranchNavigator={onBackToBranchNavigator}
          />
        </TerminalSessionReadContext>,
      )

    const desktop = renderMissingBranch()
    expect(screen.queryByRole('button', { name: 'branches.back-to-list' })).toBeNull()
    desktop.unmount()

    responsiveMocks.compact = true
    renderMissingBranch()

    expect(document.body.textContent).toContain('branches.missing')
    expect(document.body.textContent).not.toContain('branches.filter-empty')
    screen.getByRole('button', { name: 'branches.back-to-list' }).click()
    expect(onBackToBranchNavigator).toHaveBeenCalledOnce()
  })

  test('renders an empty pane on an explicit bare branch route without a saved preference', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/first-open', {
          worktree: { path: '/tmp/goblin-first-open' },
        }),
      ],
      currentBranchName: 'feature/first-open',
      workspacePaneTabsByBranch: { 'feature/first-open': [staticEntry('status')] },
    })
    const presentationRepo = gitWorkspacePaneProjection(repo)
    const detail = getTestGitWorkspacePanePresentation(presentationRepo)

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
          <GitWorkspacePaneContentHarness
            repo={presentationRepo}
            detail={detail}
            workspacePaneId="workspace"
            workspacePaneRouteMode="bare-branch"
          />
        </BranchActionSurfaceContext>
      </TerminalSessionReadContext>,
    )

    expect(container.querySelector('#workspace-status-panel')).toBeNull()
    expect(container.textContent).toContain('workspace-pane-tabs.empty')
  })

  test('shows the workspace empty state when the status tab is closed', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/no-worktree', {
          tracking: 'origin/feature/no-worktree',
          lastCommitHash: 'abc1234000000000000000000000000000000000',
          lastCommitShortHash: 'abc1234',
          lastCommitMessage: 'Update placeholder branch',
          lastCommitAuthor: 'Example Author',
          lastCommitDate: '2026-01-01T00:00:00.000Z',
        }),
      ],
      currentBranchName: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: { 'feature/no-worktree': [] },
    })
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <GitWorkspacePaneContentHarness
          repo={gitWorkspacePaneProjection(repo)}
          detail={detail}
          workspacePaneId="workspace"
        />
      </TerminalSessionReadContext>,
    )

    expect(container.querySelector('#workspace-status-panel')).toBeNull()
    expect(container.textContent).toContain('workspace-pane-tabs.empty')
  })

  test('falls back to status when a worktree-scoped preference is unrenderable on a branch without a worktree', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/no-worktree')],
      currentBranchName: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/no-worktree': [staticEntry('status')] },
    })
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
          <GitWorkspacePaneContent
            repo={gitWorkspacePaneProjection(repo)}
            detail={detail}
            workspacePaneId="workspace"
            workspacePaneTabModel={preferenceBackedWorkspacePaneTabModel(REPO_ID, 'feature/no-worktree')}
          />
        </BranchActionSurfaceContext>
      </TerminalSessionReadContext>,
    )

    // The user's preferred tab (terminal) is unrenderable without a
    // worktree. The model falls back to the first materialized tab (status)
    // so the user lands on a real tab instead of the empty pane.
    expect(container.querySelector('#workspace-status-panel')).not.toBeNull()
    expect(container.querySelector('#workspace-terminal-panel')).toBeNull()
    expect(container.textContent).not.toContain('workspace-pane-tabs.empty')
  })

  test('does not apply a stale preference to an explicit bare branch route', () => {
    const worktreePath = '/tmp/hook-terminal-empty-worktree'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/hook-terminal-empty', { worktree: { path: worktreePath } })],
      currentBranchName: 'feature/hook-terminal-empty',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/hook-terminal-empty': [staticEntry('status')] },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
          <GitWorkspacePaneContentHarness
            repo={gitWorkspacePaneProjection(repo)}
            detail={detail}
            workspacePaneId="workspace"
            workspacePaneRouteMode="bare-branch"
          />
        </BranchActionSurfaceContext>
      </TerminalSessionReadContext>,
    )

    expect(container.querySelector('#workspace-status-panel')).toBeNull()
    expect(container.querySelector('#workspace-terminal-panel')).toBeNull()
    expect(container.textContent).toContain('workspace-pane-tabs.empty')
  })

  test('falls back to status when terminal is preferred but sync confirms no terminal tabs', () => {
    const worktreePath = '/tmp/terminal-empty-worktree'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/terminal-empty', { worktree: { path: worktreePath } })],
      currentBranchName: 'feature/terminal-empty',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/terminal-empty': [staticEntry('status')] },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
          <GitWorkspacePaneContent
            repo={gitWorkspacePaneProjection(repo)}
            detail={detail}
            workspacePaneId="workspace"
            workspacePaneTabModel={preferenceBackedWorkspacePaneTabModel(REPO_ID, 'feature/terminal-empty')}
          />
        </BranchActionSurfaceContext>
      </TerminalSessionReadContext>,
    )

    // Sync is ready, the worktree has no terminal sessions, and the user
    // preferred terminal — the preferred tab is unrenderable. The model
    // falls back to the first materialized tab (status) at read time so
    // the user does not land on the empty pane.
    expect(container.querySelector('#workspace-status-panel')).not.toBeNull()
    expect(container.querySelector('#workspace-terminal-panel')).toBeNull()
    expect(container.textContent).not.toContain('workspace-pane-tabs.empty')
  })

  test('falls back to status when a branch preference names a closed tab', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/a'), createBranchSnapshot('feature/b')],
      currentBranchName: 'feature/b',
      preferredWorkspacePaneTab: 'history',
      workspacePaneTabsByBranch: {
        'feature/a': [staticEntry('status'), staticEntry('history')],
        'feature/b': [staticEntry('status')],
      },
    })
    const presentationRepo = gitWorkspacePaneProjection(repo)
    const detail = getTestGitWorkspacePanePresentation(presentationRepo)
    const workspacePaneTabModel = preferenceBackedWorkspacePaneTabModel(REPO_ID, 'feature/b')

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
          <GitWorkspacePaneContent
            repo={presentationRepo}
            detail={detail}
            workspacePaneId="workspace"
            workspacePaneTabModel={workspacePaneTabModel}
          />
        </BranchActionSurfaceContext>
      </TerminalSessionReadContext>,
    )
    await flushAsyncWork()

    // The selected branch (feature/b) has no explicit mixed tab list, so it
    // falls back to the default [status]. The user's preferred tab
    // (history) is not in the materialized tab list. The model falls
    // back to the first materialized tab (status) so the user does not
    // land on the empty pane. The store keeps the original preferred
    // tab (history) so opening history later returns to it.
    expect(container.querySelector('#workspace-status-panel')).not.toBeNull()
    expect(container.querySelector('#workspace-history-panel')).toBeNull()
    expect(container.textContent).not.toContain('workspace-pane-tabs.empty')
    expect(repoClientMocks.getRepoLog).not.toHaveBeenCalled()
  })
})
