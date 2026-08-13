// @vitest-environment jsdom

import {
  createBranchSnapshot,
  seedRepoQueryDataForTest,
  seedRepoWithReadModelForTest,
  createPullRequest,
  createRepoWorktreeSnapshotForTest,
} from '#/web/test-utils/repo-store.ts'
import { screen } from '@testing-library/vue'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { WorkspacePane } from '#/web/components/workspace-pane/WorkspacePane.tsx'
import {
  TerminalSessionCommandScope,
  TerminalSessionReadScope,
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
  useIsCompactUi: () => ({
    get value() {
      return responsiveMocks.compact
    },
  }),
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
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigation}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName="main"
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'status' } }}
              />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )

    const statusQuery = appQueryClient.getQueryCache().find({
      queryKey: repoWorktreeStatusQueryKey(REPO_ID, repo.workspaceRuntimeId),
      exact: true,
    })
    await appQueryClient.cancelQueries({
      queryKey: repoWorktreeStatusQueryKey(REPO_ID, repo.workspaceRuntimeId),
      exact: true,
    })
    await flushTestUpdates(() => {
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

  test('can render after the repo appears without changing hook order', async () => {
    const { container } = render(
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigation}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope value={terminalReadContext}>
              <WorkspacePane workspaceId={REPO_ID} workspacePaneRouteContext={{ kind: 'routed', route: null }} />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )

    await flushTestUpdates(() => {
      seedRepoWithReadModelForTest({ id: REPO_ID, branches: [] })
    })
    expect(screen.getByText('branches.empty')).toBeTruthy()
  })

  test('keeps the workspace tab strip mounted and restores scroll position by branch', async () => {
    const branchA = createBranchSnapshot('feature/a')
    const branchB = createBranchSnapshot('feature/b')
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [branchA, branchB],
      worktrees: [
        createRepoWorktreeSnapshotForTest(branchA.name, '/tmp/repo-workspace-container-repo-a'),
        createRepoWorktreeSnapshotForTest(branchB.name, '/tmp/repo-workspace-container-repo-b'),
      ],
      currentBranchName: 'feature/a',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/a': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
        'feature/b': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
      },
    })
    const { container, rerender } = render(
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigation}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName={null}
                workspacePaneRouteContext={{
                  kind: 'git-worktree',
                  worktreePath: '/tmp/repo-workspace-container-repo-a',
                  route: { kind: 'static', tab: 'status' },
                }}
              />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )
    const viewport = scrollViewport(container)
    await flushTestUpdates(() => {
      viewport.scrollLeft = 120
      viewport.dispatchEvent(new Event('scroll', { bubbles: true }))
    })

    await flushTestUpdates(async () => {
      await rerender(
        <VueQueryClientScope client={appQueryClient}>
          <AppNavigationProvider value={navigation}>
            <TerminalSessionCommandScope value={terminalCommandContext}>
              <TerminalSessionReadScope value={terminalReadContext}>
                <WorkspacePane
                  workspaceId={REPO_ID}
                  currentBranchName={null}
                  workspacePaneRouteContext={{
                    kind: 'git-worktree',
                    worktreePath: '/tmp/repo-workspace-container-repo-b',
                    route: { kind: 'static', tab: 'status' },
                  }}
                />
              </TerminalSessionReadScope>
            </TerminalSessionCommandScope>
          </AppNavigationProvider>
        </VueQueryClientScope>,
      )
    })

    expect(scrollViewport(container)).toBe(viewport)
    expect(viewport.scrollLeft).toBe(0)

    await flushTestUpdates(() => {
      viewport.scrollLeft = 40
      viewport.dispatchEvent(new Event('scroll', { bubbles: true }))
    })

    await flushTestUpdates(async () => {
      await rerender(
        <VueQueryClientScope client={appQueryClient}>
          <AppNavigationProvider value={navigation}>
            <TerminalSessionCommandScope value={terminalCommandContext}>
              <TerminalSessionReadScope value={terminalReadContext}>
                <WorkspacePane
                  workspaceId={REPO_ID}
                  currentBranchName={null}
                  workspacePaneRouteContext={{
                    kind: 'git-worktree',
                    worktreePath: '/tmp/repo-workspace-container-repo-a',
                    route: { kind: 'static', tab: 'status' },
                  }}
                />
              </TerminalSessionReadScope>
            </TerminalSessionCommandScope>
          </AppNavigationProvider>
        </VueQueryClientScope>,
      )
    })

    expect(scrollViewport(container)).toBe(viewport)
    expect(viewport.scrollLeft).toBe(120)
  })

  test('uses the TanStack Query status read model for workspace presentation when available', async () => {
    const worktreePath = '/tmp/repo-workspace-container-repo-a'
    const branch = createBranchSnapshot('feature/a')
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [branch],
      worktrees: [createRepoWorktreeSnapshotForTest(branch.name, worktreePath)],
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
      worktrees: [createRepoWorktreeSnapshotForTest(branch.name, worktreePath)],
      status: [
        { path: worktreePath, branch: 'feature/a', isMain: false, entries: [{ x: 'M', y: ' ', path: 'changed.ts' }] },
      ],
    })

    const { container } = render(
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigation}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName={null}
                workspacePaneRouteContext={{
                  kind: 'git-worktree',
                  worktreePath,
                  route: { kind: 'static', tab: 'status' },
                }}
              />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )

    expect(container.querySelector('button[aria-label="status.copy-patch-title"]')).not.toBeNull()
  })

  test('keeps the last accepted status visible with one notice when snapshot and status refreshes fail', async () => {
    const worktreePath = '/tmp/repo-workspace-container-repo-stale'
    const branch = createBranchSnapshot('feature/stale')
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [branch],
      worktrees: [createRepoWorktreeSnapshotForTest(branch.name, worktreePath)],
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
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigation}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName={null}
                workspacePaneRouteContext={{
                  kind: 'git-worktree',
                  worktreePath,
                  route: { kind: 'static', tab: 'changes' },
                }}
              />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
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
    await flushTestUpdates(() => {
      snapshotQuery.setState({ ...snapshotQuery.state, status: 'error', error: new Error('snapshot failed') })
      statusQuery.setState({ ...statusQuery.state, status: 'error', error: new Error('status failed') })
    })

    expect(screen.getByLabelText('changed.ts')).toBeTruthy()
    await vi.waitFor(() => expect(screen.getAllByText('status.stale-title')).toHaveLength(1))
    expect(screen.getByText(/error.failed-read-repo/)).toBeTruthy()
  })

  test('uses the TanStack Query snapshot for workspace branch presentation when available', async () => {
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
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigation}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName="feature/query"
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'status' } }}
              />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )

    expect(container.textContent).toContain('feature/query')
    expect(container.textContent).not.toContain('branches.empty')
  })

  test('uses the TanStack Query projection for the current branch pull request when available', async () => {
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
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigation}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName="feature/pr"
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'status' } }}
              />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )

    expect(container.querySelector('[data-pull-request-link=""]')).not.toBeNull()
  })

  test('does not create a pull-request observer without a branch identity', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('main')],
      currentBranchName: null,
      preferredWorkspacePaneTab: 'status',
    })

    render(
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigation}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName={null}
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'status' } }}
              />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )

    const activePullRequestObservers = appQueryClient
      .getQueryCache()
      .getAll()
      .filter((query) => query.queryKey[3] === 'pull-requests' && query.getObserversCount() > 0)
    expect(activePullRequestObservers).toHaveLength(0)
  })
})
