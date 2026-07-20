// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { WorkspaceDashboardPane } from '#/web/components/workspace-pages/WorkspaceDashboardPane.tsx'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  repoWorktreeStatusQueryKey,
  repoProjectionQueryKey,
  setRepoProjectionQueryData,
} from '#/web/repo-data-query.ts'
import { workspaceDirectoryOverviewQueryKey } from '#/web/workspace-directory-overview-query.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  createPullRequest,
  createRepoBranch,
  resetWorkspacesStore,
  seedRepoWithReadModelForTest,
  setWorkspaceProbeForTest,
} from '#/web/test-utils/bridge.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type * as RepoClient from '#/web/repo-client.ts'

const repoClientMocks = vi.hoisted(() => ({
  getRepoWorktreeStatus: vi.fn(),
}))

vi.mock('#/web/repo-client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof RepoClient>()
  return { ...actual, getRepoWorktreeStatus: repoClientMocks.getRepoWorktreeStatus }
})

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace')

beforeEach(() => {
  primaryWindowQueryClient.clear()
  resetWorkspacesStore()
  repoClientMocks.getRepoWorktreeStatus.mockReset()
  repoClientMocks.getRepoWorktreeStatus.mockImplementation(async (_workspaceId, workspaceRuntimeId) => ({
    workspaceRuntimeId,
    status: [],
    loadedAt: 1,
  }))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('WorkspaceDashboardPane', () => {
  test('does not admit Git or directory reads before workspace capability settles', () => {
    const workspace = seedRepoWithReadModelForTest({ id: WORKSPACE_ID, name: 'probing' })
    setWorkspaceProbeForTest(WORKSPACE_ID, { status: 'probing' })
    primaryWindowQueryClient.removeQueries({
      queryKey: repoProjectionQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId, null, 'summary'),
    })
    primaryWindowQueryClient.removeQueries({
      queryKey: repoWorktreeStatusQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId),
    })

    renderInJsdom(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <WorkspaceDashboardPane workspaceId={WORKSPACE_ID} />
      </QueryClientProvider>,
    )

    const projectionState = primaryWindowQueryClient.getQueryState(
      repoProjectionQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId, null, 'summary'),
    )
    const statusState = primaryWindowQueryClient.getQueryState(
      repoWorktreeStatusQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId),
    )
    const overviewState = primaryWindowQueryClient.getQueryState(
      workspaceDirectoryOverviewQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId),
    )
    for (const queryState of [projectionState, statusState, overviewState]) {
      expect(queryState?.fetchStatus).not.toBe('fetching')
      expect(queryState?.dataUpdateCount ?? 0).toBe(0)
    }
  })

  test('shows directory metrics without mounting Git reads for a non-Git workspace', () => {
    const workspace = seedRepoWithReadModelForTest({ id: WORKSPACE_ID, name: 'notes' })
    setWorkspaceProbeForTest(WORKSPACE_ID, {
      status: 'ready',
      name: 'notes',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' },
      },
      diagnostics: [],
    })
    primaryWindowQueryClient.setQueryData(
      workspaceDirectoryOverviewQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId),
      {
        topLevelFileCount: 4,
        topLevelDirectoryCount: 2,
        totalSizeBytes: 2048,
      },
    )

    const { container } = renderInJsdom(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <WorkspaceDashboardPane workspaceId={WORKSPACE_ID} />
      </QueryClientProvider>,
    )

    expect(container.textContent).toContain('dashboard.directory.files4')
    expect(container.textContent).toContain('dashboard.directory.folders2')
    expect(container.textContent).toContain('2.0 KB')
    expect(container.textContent).toContain('/workspace')
    expect(container.textContent).not.toContain('goblin+file://')
    expect(
      primaryWindowQueryClient.getQueryState(repoWorktreeStatusQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId))
        ?.fetchStatus,
    ).not.toBe('fetching')
  })

  test('shows a retryable error when worktree status is unavailable', async () => {
    const workspace = seedRepoWithReadModelForTest({
      id: WORKSPACE_ID,
      branches: [createRepoBranch('main')],
      currentBranchName: 'main',
    })
    setRepoProjectionQueryData(WORKSPACE_ID, workspace.workspaceRuntimeId, null, 'summary', {
      snapshot: { current: 'main', branches: [createRepoBranch('main')] },
      pullRequests: null,
      requested: { branch: null, pullRequestMode: 'summary' },
      loadedAt: 123,
    })
    const statusQueryKey = repoWorktreeStatusQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId)
    primaryWindowQueryClient.removeQueries({ queryKey: statusQueryKey })
    repoClientMocks.getRepoWorktreeStatus.mockImplementation(async () => {
      throw new Error('status failed')
    })

    const { container } = renderInJsdom(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <WorkspaceDashboardPane workspaceId={WORKSPACE_ID} />
      </QueryClientProvider>,
    )

    await vi.waitFor(() => expect(repoClientMocks.getRepoWorktreeStatus).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(container.textContent).toContain('error.failed-read-repo'))
    expect(container.textContent).toContain('error.try-again')
    expect(container.textContent).not.toContain('dashboard.loading')
  })

  test('keeps accepted dashboard data visible with a stale warning after status refresh fails', async () => {
    const mainBranch = createRepoBranch('main')
    const workspace = seedRepoWithReadModelForTest({
      id: WORKSPACE_ID,
      branches: [mainBranch],
      currentBranchName: 'main',
    })
    setRepoProjectionQueryData(WORKSPACE_ID, workspace.workspaceRuntimeId, null, 'summary', {
      snapshot: { current: 'main', branches: [mainBranch] },
      pullRequests: null,
      requested: { branch: null, pullRequestMode: 'summary' },
      loadedAt: 123,
    })
    repoClientMocks.getRepoWorktreeStatus.mockImplementation(async () => {
      throw new Error('status failed')
    })

    const { container } = renderInJsdom(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <WorkspaceDashboardPane workspaceId={WORKSPACE_ID} />
      </QueryClientProvider>,
    )

    const statusQueryKey = repoWorktreeStatusQueryKey(WORKSPACE_ID, workspace.workspaceRuntimeId)
    await vi.waitFor(() =>
      expect(primaryWindowQueryClient.getQueryCache().find({ queryKey: statusQueryKey, exact: true })?.getObserversCount()).toBe(
        1,
      ),
    )
    await primaryWindowQueryClient.invalidateQueries({
      queryKey: statusQueryKey,
      exact: true,
      refetchType: 'active',
    })

    await vi.waitFor(() => expect(repoClientMocks.getRepoWorktreeStatus).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(container.textContent).toContain('status.stale-title'))
    expect(container.textContent).toContain('error.try-again')
    expect(container.textContent).toContain('dashboard.metric.branches')
  })

  test('hides the attention section when no branch needs attention', () => {
    seedRepoWithReadModelForTest({
      id: WORKSPACE_ID,
      branches: [createRepoBranch('main')],
      currentBranchName: 'main',
    })

    const { container } = renderInJsdom(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <WorkspaceDashboardPane workspaceId={WORKSPACE_ID} />
      </QueryClientProvider>,
    )

    expect(container.textContent).not.toContain('dashboard.attention.title')
    expect(container.textContent).not.toContain('dashboard.attention.empty')
  })

  test('uses projection pull request data for PR metrics and attention badges', () => {
    const featureBranch = createRepoBranch('feature/pr')
    const mainBranch = createRepoBranch('main')
    const workspace = seedRepoWithReadModelForTest({
      id: WORKSPACE_ID,
      branches: [featureBranch, mainBranch],
      currentBranchName: 'main',
    })
    setRepoProjectionQueryData(WORKSPACE_ID, workspace.workspaceRuntimeId, null, 'summary', {
      snapshot: { current: 'main', branches: [featureBranch, mainBranch] },
      pullRequests: [
        {
          branch: 'feature/pr',
          pullRequest: createPullRequest(42, {
            headRefName: 'feature/pr',
            checks: { total: 2, passing: 1, failing: 1, pending: 0 },
          }),
        },
      ],
      requested: { branch: null, pullRequestMode: 'summary' },
      loadedAt: 123,
    })

    const { container } = renderInJsdom(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <WorkspaceDashboardPane workspaceId={WORKSPACE_ID} />
      </QueryClientProvider>,
    )

    expect(container.textContent).toContain('dashboard.metric.prs')
    expect(container.textContent).toContain('1')
    expect(container.textContent).toContain('dashboard.checks-failing')
    expect(container.textContent).toContain('feature/pr')
  })

  test('opens a branch from dashboard branch rows', () => {
    const onSelectBranch = vi.fn()
    seedRepoWithReadModelForTest({
      id: WORKSPACE_ID,
      branches: [createRepoBranch('feature/open')],
      currentBranchName: 'feature/open',
    })

    const { getByTestId } = renderInJsdom(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <WorkspaceDashboardPane workspaceId={WORKSPACE_ID} onSelectBranch={onSelectBranch} />
      </QueryClientProvider>,
    )

    getByTestId('dashboard-branch-link').click()

    expect(onSelectBranch).toHaveBeenCalledWith('feature/open')
  })
})
