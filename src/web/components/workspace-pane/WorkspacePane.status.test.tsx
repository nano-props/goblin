// @vitest-environment jsdom

import {
  createBranchSnapshot,
  seedRepoQueryDataForTest,
  seedRepoWithReadModelForTest,
  createPullRequest,
} from '#/web/test-utils/repo-store.ts'
import { act, screen } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { WorkspacePane } from '#/web/components/workspace-pane/WorkspacePane.tsx'
import {
  TerminalSessionContext,
  TerminalSessionReadContext,
} from '#/web/components/terminal/terminal-session-context.ts'
import { AppNavigationProvider } from '#/web/app-navigation.tsx'
import { appQueryClient } from '#/web/app-query-client.ts'
import { repoPullRequestsQueryKey, repoSnapshotQueryKey, repoWorktreeStatusQueryKey } from '#/web/repo-query-keys.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import {
  REPO_ID,
  navigation,
  render,
  scrollViewport,
  terminalCommandContext,
  terminalReadContext,
} from '#/web/test-utils/workspace-pane.tsx'

const responsiveMocks = vi.hoisted(() => ({ compact: false }))
vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useIsCompactUi: () => responsiveMocks.compact,
}))

beforeEach(() => {
  responsiveMocks.compact = false
})

describe('WorkspacePane status presentation', () => {
  test('keeps the workspace shell mounted when the initial worktree status read fails', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('main')],
      currentBranchName: 'main',
    })
    appQueryClient.removeQueries({ queryKey: repoWorktreeStatusQueryKey(REPO_ID, repo.workspaceRuntimeId) })

    render(
      <QueryClientProvider client={appQueryClient}>
        <AppNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName="main"
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'status' } }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </AppNavigationProvider>
      </QueryClientProvider>,
    )

    const statusQuery = appQueryClient.getQueryCache().find({
      queryKey: repoWorktreeStatusQueryKey(REPO_ID, repo.workspaceRuntimeId),
      exact: true,
    })
    await appQueryClient.cancelQueries({
      queryKey: repoWorktreeStatusQueryKey(REPO_ID, repo.workspaceRuntimeId),
      exact: true,
    })
    act(() => {
      statusQuery?.setState({
        ...statusQuery.state,
        data: undefined,
        status: 'error',
        error: new Error('status failed'),
      })
    })

    await vi.waitFor(() => expect(screen.getByText('status failed')).toBeTruthy())
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getAllByText('error.try-again').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('repo-workspace-skeleton')).toBeNull()
    expect(screen.getByRole('tab', { name: 'tab.status' })).toBeTruthy()
  })

  test('can render after the repo appears without changing hook order', () => {
    const { container } = render(
      <QueryClientProvider client={appQueryClient}>
        <AppNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane workspaceId={REPO_ID} workspacePaneRouteContext={{ kind: 'routed', route: null }} />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </AppNavigationProvider>
      </QueryClientProvider>,
    )

    expect(() => {
      act(() => {
        seedRepoWithReadModelForTest({ id: REPO_ID, branches: [] })
      })
    }).not.toThrow()
    expect(screen.getByText('branches.empty')).toBeTruthy()
  })

  test('keeps the workspace tab strip mounted and restores scroll position by branch', () => {
    const branchA = createBranchSnapshot('feature/a', {
      worktree: { path: '/tmp/repo-workspace-container-repo-a', isPrimary: false, isLocked: false },
    })
    const branchB = createBranchSnapshot('feature/b', {
      worktree: { path: '/tmp/repo-workspace-container-repo-b', isPrimary: false, isLocked: false },
    })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [branchA, branchB],
      currentBranchName: 'feature/a',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/a': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
        'feature/b': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
      },
    })
    const { container, rerender } = render(
      <QueryClientProvider client={appQueryClient}>
        <AppNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName="feature/a"
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'status' } }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </AppNavigationProvider>
      </QueryClientProvider>,
    )
    const viewport = scrollViewport(container)
    act(() => {
      viewport.scrollLeft = 120
      viewport.dispatchEvent(new Event('scroll', { bubbles: true }))
    })

    act(() => {
      rerender(
        <QueryClientProvider client={appQueryClient}>
          <AppNavigationProvider value={navigation}>
            <TerminalSessionContext value={terminalCommandContext}>
              <TerminalSessionReadContext value={terminalReadContext}>
                <WorkspacePane
                  workspaceId={REPO_ID}
                  currentBranchName="feature/b"
                  workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'status' } }}
                />
              </TerminalSessionReadContext>
            </TerminalSessionContext>
          </AppNavigationProvider>
        </QueryClientProvider>,
      )
    })

    expect(scrollViewport(container)).toBe(viewport)
    expect(viewport.scrollLeft).toBe(0)

    act(() => {
      viewport.scrollLeft = 40
      viewport.dispatchEvent(new Event('scroll', { bubbles: true }))
    })

    act(() => {
      rerender(
        <QueryClientProvider client={appQueryClient}>
          <AppNavigationProvider value={navigation}>
            <TerminalSessionContext value={terminalCommandContext}>
              <TerminalSessionReadContext value={terminalReadContext}>
                <WorkspacePane
                  workspaceId={REPO_ID}
                  currentBranchName="feature/a"
                  workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'status' } }}
                />
              </TerminalSessionReadContext>
            </TerminalSessionContext>
          </AppNavigationProvider>
        </QueryClientProvider>,
      )
    })

    expect(scrollViewport(container)).toBe(viewport)
    expect(viewport.scrollLeft).toBe(120)
  })

  test('uses the React Query status read model for workspace presentation when available', () => {
    const worktreePath = '/tmp/repo-workspace-container-repo-a'
    const branch = createBranchSnapshot('feature/a', {
      worktree: { path: worktreePath, isPrimary: false, isLocked: false },
    })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [branch],
      currentBranchName: 'feature/a',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/a': [workspacePaneStaticTabEntry('status')],
      },
      status: [{ path: worktreePath, branch: 'feature/a', isMain: false, entries: [] }],
    })
    seedRepoQueryDataForTest(repo, {
      branches: [branch],
      currentBranch: 'feature/a',
      status: [
        { path: worktreePath, branch: 'feature/a', isMain: false, entries: [{ x: 'M', y: ' ', path: 'changed.ts' }] },
      ],
    })

    const { container } = render(
      <QueryClientProvider client={appQueryClient}>
        <AppNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName="feature/a"
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'status' } }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </AppNavigationProvider>
      </QueryClientProvider>,
    )

    expect(container.querySelector('button[aria-label="status.copy-patch-title"]')).not.toBeNull()
  })

  test('keeps the last accepted status visible with one notice when snapshot and status refreshes fail', async () => {
    const worktreePath = '/tmp/repo-workspace-container-repo-stale'
    const branch = createBranchSnapshot('feature/stale', {
      worktree: { path: worktreePath, isPrimary: false, isLocked: false },
    })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [branch],
      currentBranchName: 'feature/stale',
      preferredWorkspacePaneTab: 'changes',
      workspacePaneTabsByBranch: {
        'feature/stale': [workspacePaneStaticTabEntry('changes')],
      },
      status: [
        {
          path: worktreePath,
          branch: 'feature/stale',
          isMain: false,
          entries: [{ x: 'M', y: ' ', path: 'changed.ts' }],
        },
      ],
    })
    const statusQuery = appQueryClient.getQueryCache().find({
      queryKey: repoWorktreeStatusQueryKey(REPO_ID, repo.workspaceRuntimeId),
      exact: true,
    })!
    const snapshotQuery = appQueryClient.getQueryCache().find({
      queryKey: repoSnapshotQueryKey(REPO_ID, repo.workspaceRuntimeId),
      exact: true,
    })!

    render(
      <QueryClientProvider client={appQueryClient}>
        <AppNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName="feature/stale"
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'changes' } }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </AppNavigationProvider>
      </QueryClientProvider>,
    )

    await Promise.all([
      appQueryClient.cancelQueries({
        queryKey: repoSnapshotQueryKey(REPO_ID, repo.workspaceRuntimeId),
        exact: true,
      }),
      appQueryClient.cancelQueries({
        queryKey: repoWorktreeStatusQueryKey(REPO_ID, repo.workspaceRuntimeId),
        exact: true,
      }),
    ])
    act(() => {
      snapshotQuery.setState({ ...snapshotQuery.state, status: 'error', error: new Error('snapshot failed') })
      statusQuery.setState({ ...statusQuery.state, status: 'error', error: new Error('status failed') })
    })

    expect(screen.getByLabelText('changed.ts')).toBeTruthy()
    await vi.waitFor(() => expect(screen.getAllByText('status.stale-title')).toHaveLength(1))
    expect(screen.getByText(/error.failed-read-repo/)).toBeTruthy()
  })

  test('uses the React Query snapshot for workspace branch presentation when available', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [],
      currentBranchName: 'feature/query',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/query': [workspacePaneStaticTabEntry('status')],
      },
    })
    seedRepoQueryDataForTest(repo, {
      branches: [createBranchSnapshot('feature/query')],
      currentBranch: 'feature/query',
    })

    const { container } = render(
      <QueryClientProvider client={appQueryClient}>
        <AppNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName="feature/query"
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'status' } }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </AppNavigationProvider>
      </QueryClientProvider>,
    )

    expect(container.textContent).toContain('feature/query')
    expect(container.textContent).not.toContain('branches.empty')
  })

  test('uses the React Query projection for the current branch pull request when available', () => {
    const branch = createBranchSnapshot('feature/pr')
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [branch],
      currentBranchName: 'feature/pr',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/pr': [workspacePaneStaticTabEntry('status')],
      },
    })
    const pullRequest = createPullRequest(42, { headRefName: 'feature/pr' })
    appQueryClient.setQueryData(
      repoPullRequestsQueryKey(REPO_ID, repo.workspaceRuntimeId, { kind: 'branch-detail', branch: 'feature/pr' }),
      {
        pullRequests: [{ branch: 'feature/pr', pullRequest }],
      },
    )

    const { container } = render(
      <QueryClientProvider client={appQueryClient}>
        <AppNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName="feature/pr"
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'status' } }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </AppNavigationProvider>
      </QueryClientProvider>,
    )

    expect(container.querySelector('[data-pull-request-link=""]')).not.toBeNull()
  })
})
