// @vitest-environment jsdom

import {
  createRepoBranch,
  resetWorkspacesStore,
  seedRepoWithReadModelForTest,
  setWorkspaceProbeForTest,
  createPullRequest,
} from '#/web/test-utils/repo-store.ts'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'
import { cleanup, screen } from '@testing-library/vue'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { WorkspaceDashboardPane } from '#/web/components/workspace-pages/WorkspaceDashboardPane.tsx'
import { appQueryClient } from '#/web/app-query-client.ts'
import { repoPullRequestsQueryKey, repoSnapshotQueryKey, repoWorktreeStatusQueryKey } from '#/web/repo-query-keys.ts'
import { workspaceDirectoryOverviewQueryKey } from '#/web/workspace-directory-overview-query.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const repoClientMocks = vi.hoisted(() => ({
  getRepoSnapshot: vi.fn(),
  getRepoWorktreeStatus: vi.fn(),
  getRepoPullRequests: vi.fn(),
}))

vi.mock('#/web/repo-client.ts', () => ({
  getRepoSnapshot: repoClientMocks.getRepoSnapshot,
  getRepoWorktreeStatus: repoClientMocks.getRepoWorktreeStatus,
  getRepoPullRequests: repoClientMocks.getRepoPullRequests,
}))

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace')

function queryObserverCount(queryKey: readonly unknown[]): number {
  return appQueryClient.getQueryCache().find({ queryKey, exact: true })?.getObserversCount() ?? 0
}

beforeEach(() => {
  appQueryClient.clear()
  resetWorkspacesStore()
  repoClientMocks.getRepoWorktreeStatus.mockReset()
  repoClientMocks.getRepoSnapshot.mockReset()
  repoClientMocks.getRepoPullRequests.mockReset()
  repoClientMocks.getRepoWorktreeStatus.mockImplementation(async (_workspaceId, workspaceRuntimeId) => ({
    workspaceRuntimeId,
    status: [],
    loadedAt: 1,
  }))
  repoClientMocks.getRepoPullRequests.mockResolvedValue({ pullRequests: [] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('WorkspaceDashboardPane', () => {
  test('does not admit Git or directory reads before workspace capability settles', async () => {
    const workspace = seedRepoWithReadModelForTest({ id: WORKSPACE_ID })
    setWorkspaceProbeForTest(WORKSPACE_ID, { status: 'probing' })
    appQueryClient.removeQueries({
      queryKey: repoSnapshotQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId),
    })
    appQueryClient.removeQueries({
      queryKey: repoWorktreeStatusQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId),
    })

    renderInJsdom(
      <VueQueryClientScope client={appQueryClient}>
        <WorkspaceDashboardPane workspaceId={WORKSPACE_ID} />
      </VueQueryClientScope>,
    )

    const projectionState = appQueryClient.getQueryState(
      repoSnapshotQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId),
    )
    const statusState = appQueryClient.getQueryState(
      repoWorktreeStatusQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId),
    )
    const overviewState = appQueryClient.getQueryState(
      workspaceDirectoryOverviewQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId),
    )
    for (const queryState of [projectionState, statusState, overviewState]) {
      expect(queryState?.fetchStatus).not.toBe('fetching')
      expect(queryState?.dataUpdateCount ?? 0).toBe(0)
    }
    expect(queryObserverCount(repoSnapshotQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId))).toBe(0)
    expect(queryObserverCount(repoWorktreeStatusQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId))).toBe(0)
    expect(queryObserverCount(workspaceDirectoryOverviewQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId))).toBe(0)
  })

  test('shows directory metrics without mounting Git reads for a non-Git workspace', async () => {
    const workspace = seedRepoWithReadModelForTest({ id: WORKSPACE_ID })
    setWorkspaceProbeForTest(WORKSPACE_ID, {
      status: 'ready',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' },
      },
      diagnostics: [],
    })
    appQueryClient.setQueryData(workspaceDirectoryOverviewQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId), {
      topLevelFileCount: 4,
      topLevelDirectoryCount: 2,
      lastModifiedAt: '2023-11-14T22:13:20.000Z',
    })

    const { container } = renderInJsdom(
      <VueQueryClientScope client={appQueryClient}>
        <WorkspaceDashboardPane workspaceId={WORKSPACE_ID} />
      </VueQueryClientScope>,
    )

    expect(container.textContent).toContain('dashboard.directory.files4')
    expect(container.textContent).toContain('dashboard.directory.folders2')
    expect(container.textContent).toContain('dashboard.directory.last-modified')
    const lastModifiedValue = screen
      .getByText('dashboard.directory.last-modified')
      .parentElement?.querySelector<HTMLElement>('[title]')
    expect(lastModifiedValue?.textContent).toBe(lastModifiedValue?.title)
    expect(lastModifiedValue?.textContent).toMatch(/ ago$/u)
    expect(lastModifiedValue?.className).toContain('truncate')
    expect(container.textContent).toContain('/workspace')
    expect(container.textContent).not.toContain('goblin+file://')
    expect(
      appQueryClient.getQueryState(repoWorktreeStatusQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId))?.fetchStatus,
    ).not.toBe('fetching')
    expect(queryObserverCount(workspaceDirectoryOverviewQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId))).toBe(1)
    expect(queryObserverCount(repoSnapshotQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId))).toBe(0)
    expect(queryObserverCount(repoWorktreeStatusQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId))).toBe(0)
  })

  test('keeps dashboard snapshot content visible with unknown dirty state when status is unavailable', async () => {
    const workspace = seedRepoWithReadModelForTest({
      id: WORKSPACE_ID,
      branches: [createRepoBranch('main')],
      currentBranchName: 'main',
    })
    const statusQueryKey = repoWorktreeStatusQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId)
    appQueryClient.removeQueries({ queryKey: statusQueryKey })
    repoClientMocks.getRepoWorktreeStatus.mockImplementation(async () => {
      throw new Error('status failed')
    })

    const { container } = renderInJsdom(
      <VueQueryClientScope client={appQueryClient}>
        <WorkspaceDashboardPane workspaceId={WORKSPACE_ID} />
      </VueQueryClientScope>,
    )

    await vi.waitFor(() => expect(container.textContent).toContain('status failed'))
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1)
    expect(container.textContent).not.toContain('status.stale-title')
    expect(container.textContent).toContain('error.try-again')
    expect(container.textContent).not.toContain('dashboard.loading')
    expect(container.textContent).toContain('dashboard.metric.branches')
  })

  test('shows a retryable failure instead of loading forever when the initial snapshot fails', async () => {
    const workspace = seedRepoWithReadModelForTest({ id: WORKSPACE_ID })
    appQueryClient.removeQueries({
      queryKey: repoSnapshotQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId),
    })
    repoClientMocks.getRepoSnapshot.mockRejectedValue(new Error('snapshot failed'))

    const { container } = renderInJsdom(
      <VueQueryClientScope client={appQueryClient}>
        <WorkspaceDashboardPane workspaceId={WORKSPACE_ID} />
      </VueQueryClientScope>,
    )

    await vi.waitFor(() => expect(container.textContent).toContain('snapshot failed'))
    expect(container.textContent).toContain('error.try-again')
    expect(container.textContent).not.toContain('dashboard.loading')
  })

  test('does not describe an initial pull request failure as stale snapshot data', async () => {
    const workspace = seedRepoWithReadModelForTest({
      id: WORKSPACE_ID,
      branches: [createRepoBranch('main')],
      currentBranchName: 'main',
    })
    appQueryClient.removeQueries({
      queryKey: repoPullRequestsQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId, { kind: 'repository-summary' }),
    })
    repoClientMocks.getRepoPullRequests.mockRejectedValue(new Error('pull requests failed'))

    const { container } = renderInJsdom(
      <VueQueryClientScope client={appQueryClient}>
        <WorkspaceDashboardPane workspaceId={WORKSPACE_ID} />
      </VueQueryClientScope>,
    )

    await vi.waitFor(() => expect(container.textContent).toContain('pull requests failed'))
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1)
    expect(container.textContent).not.toContain('status.stale-title')
    expect(container.textContent).toContain('dashboard.metric.branches')
  })

  test('keeps accepted dashboard data visible with a stale warning after status refresh fails', async () => {
    const mainBranch = createRepoBranch('main')
    const workspace = seedRepoWithReadModelForTest({
      id: WORKSPACE_ID,
      branches: [mainBranch],
      currentBranchName: 'main',
    })
    repoClientMocks.getRepoWorktreeStatus.mockImplementation(async () => {
      throw new Error('status failed')
    })

    const { container } = renderInJsdom(
      <VueQueryClientScope client={appQueryClient}>
        <WorkspaceDashboardPane workspaceId={WORKSPACE_ID} />
      </VueQueryClientScope>,
    )

    await vi.waitFor(() => expect(repoClientMocks.getRepoWorktreeStatus).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(container.textContent).toContain('status.stale-title'))
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(container.textContent).toContain('error.try-again')
    expect(container.textContent).toContain('dashboard.metric.branches')
  })

  test('combines simultaneous stale reads and retries each idle query once', async () => {
    const workspace = seedRepoWithReadModelForTest({
      id: WORKSPACE_ID,
      branches: [createRepoBranch('main')],
      currentBranchName: 'main',
    })
    const pullRequestsQueryKey = repoPullRequestsQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId, {
      kind: 'repository-summary',
    })
    appQueryClient.setQueryData(pullRequestsQueryKey, { pullRequests: [] })
    repoClientMocks.getRepoSnapshot.mockRejectedValue(new Error('snapshot failed'))
    repoClientMocks.getRepoWorktreeStatus.mockRejectedValue(new Error('status failed'))
    repoClientMocks.getRepoPullRequests.mockRejectedValue(new Error('pull requests failed'))
    await Promise.all([
      appQueryClient.invalidateQueries({
        queryKey: repoSnapshotQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId),
        exact: true,
        refetchType: 'none',
      }),
      appQueryClient.invalidateQueries({
        queryKey: repoWorktreeStatusQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId),
        exact: true,
        refetchType: 'none',
      }),
      appQueryClient.invalidateQueries({ queryKey: pullRequestsQueryKey, exact: true, refetchType: 'none' }),
    ])

    const { container } = renderInJsdom(
      <VueQueryClientScope client={appQueryClient}>
        <WorkspaceDashboardPane workspaceId={WORKSPACE_ID} />
      </VueQueryClientScope>,
    )

    await vi.waitFor(() => {
      expect(repoClientMocks.getRepoSnapshot).toHaveBeenCalledOnce()
      expect(repoClientMocks.getRepoWorktreeStatus).toHaveBeenCalledOnce()
      expect(repoClientMocks.getRepoPullRequests).toHaveBeenCalledOnce()
    })
    await vi.waitFor(() => expect(container.querySelectorAll('[role="status"]')).toHaveLength(1))

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'error.try-again' }))
    await vi.waitFor(() => {
      expect(repoClientMocks.getRepoSnapshot).toHaveBeenCalledTimes(2)
      expect(repoClientMocks.getRepoWorktreeStatus).toHaveBeenCalledTimes(2)
      expect(repoClientMocks.getRepoPullRequests).toHaveBeenCalledTimes(2)
    })
  })

  test('hides the attention section when no branch needs attention', async () => {
    const workspace = seedRepoWithReadModelForTest({
      id: WORKSPACE_ID,
      branches: [createRepoBranch('main')],
      currentBranchName: 'main',
    })

    const { container } = renderInJsdom(
      <VueQueryClientScope client={appQueryClient}>
        <WorkspaceDashboardPane workspaceId={WORKSPACE_ID} />
      </VueQueryClientScope>,
    )

    expect(container.textContent).not.toContain('dashboard.attention.title')
    expect(container.textContent).not.toContain('dashboard.attention.empty')
    expect(queryObserverCount(repoSnapshotQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId))).toBe(1)
    expect(queryObserverCount(repoWorktreeStatusQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId))).toBe(1)
    expect(
      queryObserverCount(
        repoPullRequestsQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId, { kind: 'repository-summary' }),
      ),
    ).toBe(1)
    expect(queryObserverCount(workspaceDirectoryOverviewQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId))).toBe(0)
  })

  test('uses projection pull request data for PR metrics and attention badges', async () => {
    const featureBranch = createRepoBranch('feature/pr')
    const mainBranch = createRepoBranch('main')
    const workspace = seedRepoWithReadModelForTest({
      id: WORKSPACE_ID,
      branches: [featureBranch, mainBranch],
      currentBranchName: 'main',
    })
    appQueryClient.setQueryData(
      repoPullRequestsQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId, { kind: 'repository-summary' }),
      {
        pullRequests: [
          {
            branch: 'feature/pr',
            pullRequest: createPullRequest(42, {
              headRefName: 'feature/pr',
              checks: { total: 2, passing: 1, failing: 1, pending: 0 },
            }),
          },
        ],
      },
    )

    const { container } = renderInJsdom(
      <VueQueryClientScope client={appQueryClient}>
        <WorkspaceDashboardPane workspaceId={WORKSPACE_ID} />
      </VueQueryClientScope>,
    )

    expect(container.textContent).toContain('dashboard.metric.prs')
    expect(container.textContent).toContain('1')
    expect(container.textContent).toContain('dashboard.checks-failing')
    expect(container.textContent).toContain('feature/pr')
  })

  test('opens a branch from dashboard branch rows', async () => {
    const onSelectBranch = vi.fn()
    const workspace = seedRepoWithReadModelForTest({
      id: WORKSPACE_ID,
      branches: [createRepoBranch('feature/open')],
      currentBranchName: 'feature/open',
    })

    const { getByTestId } = renderInJsdom(
      <VueQueryClientScope client={appQueryClient}>
        <WorkspaceDashboardPane workspaceId={WORKSPACE_ID} onSelectBranch={onSelectBranch} />
      </VueQueryClientScope>,
    )

    getByTestId('dashboard-branch-link').click()

    expect(onSelectBranch).toHaveBeenCalledWith('feature/open')
  })
})
