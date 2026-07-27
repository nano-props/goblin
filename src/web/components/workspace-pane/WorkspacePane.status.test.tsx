// @vitest-environment jsdom

import { act, screen } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { WorkspacePane } from '#/web/components/workspace-pane/WorkspacePane.tsx'
import {
  TerminalSessionContext,
  TerminalSessionReadContext,
} from '#/web/components/terminal/terminal-session-context.ts'
import { PrimaryWindowNavigationProvider } from '#/web/primary-window-navigation.tsx'
import {
  createPullRequest,
  createBranchSnapshot,
  seedRepoReadModelQueryData,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { repoWorktreeStatusQueryKey } from '#/web/repo-query-keys.ts'
import { setRepoProjectionQueryData } from '#/web/repo-query-cache.ts'
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
  test('shows a retryable error when the initial worktree status read fails', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('main')],
      currentBranchName: 'main',
    })
    primaryWindowQueryClient.removeQueries({ queryKey: repoWorktreeStatusQueryKey(REPO_ID, repo.workspaceRuntimeId) })
    await expect(
      primaryWindowQueryClient.fetchQuery({
        queryKey: repoWorktreeStatusQueryKey(REPO_ID, repo.workspaceRuntimeId),
        queryFn: async () => {
          throw new Error('status failed')
        },
        retry: false,
      }),
    ).rejects.toThrow('status failed')

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName="main"
                workspacePaneRouteContext={{ kind: 'routed', route: null }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('error.failed-read-repo')).toBeTruthy()
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'error.try-again' })).toBeTruthy()
    expect(screen.queryByTestId('repo-workspace-skeleton')).toBeNull()
  })

  test('can render after the repo appears without changing hook order', () => {
    const { container } = render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane workspaceId={REPO_ID} workspacePaneRouteContext={{ kind: 'routed', route: null }} />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
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
    const branchA = createBranchSnapshot('feature/a', { worktree: { path: '/tmp/repo-workspace-container-repo-a' } })
    const branchB = createBranchSnapshot('feature/b', { worktree: { path: '/tmp/repo-workspace-container-repo-b' } })
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
    setRepoProjectionQueryData(REPO_ID, repo.workspaceRuntimeId, 'feature/b', 'full', {
      snapshot: { branches: [branchA, branchB], current: 'feature/a' },
      pullRequests: null,
      requested: { branch: 'feature/b', pullRequestMode: 'full' },
      loadedAt: Date.now(),
    })
    const { container, rerender } = render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName="feature/a"
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'status' } }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )
    const viewport = scrollViewport(container)
    act(() => {
      viewport.scrollLeft = 120
      viewport.dispatchEvent(new Event('scroll', { bubbles: true }))
    })

    act(() => {
      rerender(
        <QueryClientProvider client={primaryWindowQueryClient}>
          <PrimaryWindowNavigationProvider value={navigation}>
            <TerminalSessionContext value={terminalCommandContext}>
              <TerminalSessionReadContext value={terminalReadContext}>
                <WorkspacePane
                  workspaceId={REPO_ID}
                  currentBranchName="feature/b"
                  workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'status' } }}
                />
              </TerminalSessionReadContext>
            </TerminalSessionContext>
          </PrimaryWindowNavigationProvider>
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
        <QueryClientProvider client={primaryWindowQueryClient}>
          <PrimaryWindowNavigationProvider value={navigation}>
            <TerminalSessionContext value={terminalCommandContext}>
              <TerminalSessionReadContext value={terminalReadContext}>
                <WorkspacePane
                  workspaceId={REPO_ID}
                  currentBranchName="feature/a"
                  workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'status' } }}
                />
              </TerminalSessionReadContext>
            </TerminalSessionContext>
          </PrimaryWindowNavigationProvider>
        </QueryClientProvider>,
      )
    })

    expect(scrollViewport(container)).toBe(viewport)
    expect(viewport.scrollLeft).toBe(120)
  })

  test('uses the React Query status read model for workspace presentation when available', () => {
    const worktreePath = '/tmp/repo-workspace-container-repo-a'
    const branch = createBranchSnapshot('feature/a', { worktree: { path: worktreePath } })
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
    seedRepoReadModelQueryData(repo, {
      branches: [branch],
      currentBranch: 'feature/a',
      status: [
        { path: worktreePath, branch: 'feature/a', isMain: false, entries: [{ x: 'M', y: ' ', path: 'changed.ts' }] },
      ],
    })

    const { container } = render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName="feature/a"
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'status' } }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    expect(container.querySelector('button[aria-label="status.copy-patch-title"]')).not.toBeNull()
  })

  test('keeps the last accepted status visible after a background refresh fails', () => {
    const worktreePath = '/tmp/repo-workspace-container-repo-stale'
    const branch = createBranchSnapshot('feature/stale', { worktree: { path: worktreePath } })
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
    const statusQuery = primaryWindowQueryClient.getQueryCache().find({
      queryKey: repoWorktreeStatusQueryKey(REPO_ID, repo.workspaceRuntimeId),
      exact: true,
    })!
    statusQuery.setState({ ...statusQuery.state, status: 'error', error: new Error('status failed') })

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName="feature/stale"
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'changes' } }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    expect(screen.getByLabelText('changed.ts')).toBeTruthy()
    expect(screen.getByText('status.stale-title')).toBeTruthy()
    expect(screen.getByText(/status failed/)).toBeTruthy()
  })

  test('uses the React Query projection read model for workspace branch presentation when available', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [],
      currentBranchName: 'feature/query',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/query': [workspacePaneStaticTabEntry('status')],
      },
    })
    seedRepoReadModelQueryData(repo, {
      branches: [createBranchSnapshot('feature/query')],
      currentBranch: 'feature/query',
    })

    const { container } = render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName="feature/query"
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'status' } }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
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
    setRepoProjectionQueryData(REPO_ID, repo.workspaceRuntimeId, 'feature/pr', 'full', {
      snapshot: { current: 'feature/pr', branches: [branch] },
      pullRequests: [{ branch: 'feature/pr', pullRequest }],
      requested: { branch: 'feature/pr', pullRequestMode: 'full' },
      loadedAt: 123,
    })

    const { container } = render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName="feature/pr"
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'status' } }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    expect(container.querySelector('[data-pull-request-link=""]')).not.toBeNull()
  })
})
