// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoDashboardPane } from '#/web/components/repo-pages/RepoDashboardPane.tsx'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  repoWorktreeStatusQueryKey,
  repoProjectionQueryKey,
  setRepoProjectionQueryData,
  workspaceDirectoryOverviewQueryKey,
} from '#/web/repo-data-query.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import {
  createPullRequest,
  createRepoBranch,
  resetWorkspacesStore,
  seedRepoWithReadModelForTest,
  setWorkspaceProbeForTest,
} from '#/web/test-utils/bridge.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'

const REPO_ID = 'goblin+file:///tmp/repo-dashboard-pane-test'

beforeEach(() => {
  primaryWindowQueryClient.clear()
  resetWorkspacesStore()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RepoDashboardPane', () => {
  test('does not admit Git or directory reads before workspace capability settles', () => {
    const repo = seedRepoWithReadModelForTest({ id: REPO_ID, name: 'probing' })
    setWorkspaceProbeForTest(REPO_ID, { status: 'probing' })
    primaryWindowQueryClient.removeQueries({
      queryKey: repoProjectionQueryKey(REPO_ID, repo.workspaceRuntimeId, null, 'summary'),
    })
    primaryWindowQueryClient.removeQueries({ queryKey: repoWorktreeStatusQueryKey(REPO_ID, repo.workspaceRuntimeId) })

    renderInJsdom(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <RepoDashboardPane repoId={REPO_ID} />
      </QueryClientProvider>,
    )

    const projectionState = primaryWindowQueryClient.getQueryState(
      repoProjectionQueryKey(REPO_ID, repo.workspaceRuntimeId, null, 'summary'),
    )
    const statusState = primaryWindowQueryClient.getQueryState(
      repoWorktreeStatusQueryKey(REPO_ID, repo.workspaceRuntimeId),
    )
    const overviewState = primaryWindowQueryClient.getQueryState(
      workspaceDirectoryOverviewQueryKey(REPO_ID, repo.workspaceRuntimeId),
    )
    for (const queryState of [projectionState, statusState, overviewState]) {
      expect(queryState?.fetchStatus).not.toBe('fetching')
      expect(queryState?.dataUpdateCount ?? 0).toBe(0)
    }
  })

  test('shows directory metrics without mounting Git reads for a non-Git workspace', () => {
    const repo = seedRepoWithReadModelForTest({ id: REPO_ID, name: 'notes' })
    setWorkspaceProbeForTest(REPO_ID, {
      status: 'ready',
      name: 'notes',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' },
      },
      diagnostics: [],
    })
    primaryWindowQueryClient.setQueryData(workspaceDirectoryOverviewQueryKey(REPO_ID, repo.workspaceRuntimeId), {
      topLevelFileCount: 4,
      topLevelDirectoryCount: 2,
      totalSizeBytes: 2048,
    })

    const { container } = renderInJsdom(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <RepoDashboardPane repoId={REPO_ID} />
      </QueryClientProvider>,
    )

    expect(container.textContent).toContain('dashboard.directory.files4')
    expect(container.textContent).toContain('dashboard.directory.folders2')
    expect(container.textContent).toContain('2.0 KB')
    expect(container.textContent).toContain('/tmp/repo-dashboard-pane-test')
    expect(container.textContent).not.toContain('goblin+file://')
    expect(
      primaryWindowQueryClient.getQueryState(repoWorktreeStatusQueryKey(REPO_ID, repo.workspaceRuntimeId))?.fetchStatus,
    ).not.toBe('fetching')
  })

  test('shows a retryable error when worktree status is unavailable', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('main')],
      currentBranchName: 'main',
    })
    setRepoProjectionQueryData(REPO_ID, repo.workspaceRuntimeId, null, 'summary', {
      snapshot: { current: 'main', branches: [createRepoBranch('main')] },
      pullRequests: null,
      operations: { operations: [], loadedAt: 123 },
      requested: { branch: null, pullRequestMode: 'summary' },
      loadedAt: 123,
    })
    const statusQueryKey = repoWorktreeStatusQueryKey(REPO_ID, repo.workspaceRuntimeId)
    primaryWindowQueryClient.removeQueries({ queryKey: statusQueryKey })
    primaryWindowQueryClient.setQueryDefaults(statusQueryKey, { refetchOnMount: false })
    await expect(
      primaryWindowQueryClient.fetchQuery({
        queryKey: statusQueryKey,
        queryFn: async () => {
          throw new Error('status failed')
        },
        retry: false,
      }),
    ).rejects.toThrow('status failed')

    const { container } = renderInJsdom(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <RepoDashboardPane repoId={REPO_ID} />
      </QueryClientProvider>,
    )

    await vi.waitFor(() => expect(container.textContent).toContain('error.failed-read-repo'))
    expect(container.textContent).toContain('error.try-again')
    expect(container.textContent).not.toContain('dashboard.loading')
    primaryWindowQueryClient.setQueryDefaults(statusQueryKey, {})
  })

  test('keeps accepted dashboard data visible with a stale warning after status refresh fails', async () => {
    const mainBranch = createRepoBranch('main')
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [mainBranch],
      currentBranchName: 'main',
    })
    setRepoProjectionQueryData(REPO_ID, repo.workspaceRuntimeId, null, 'summary', {
      snapshot: { current: 'main', branches: [mainBranch] },
      pullRequests: null,
      operations: { operations: [], loadedAt: 123 },
      requested: { branch: null, pullRequestMode: 'summary' },
      loadedAt: 123,
    })
    const statusQueryKey = repoWorktreeStatusQueryKey(REPO_ID, repo.workspaceRuntimeId)
    primaryWindowQueryClient.setQueryDefaults(statusQueryKey, { refetchOnMount: false })
    await expect(
      primaryWindowQueryClient.fetchQuery({
        queryKey: statusQueryKey,
        queryFn: async () => {
          throw new Error('status failed')
        },
        retry: false,
        staleTime: 0,
      }),
    ).rejects.toThrow('status failed')

    const { container } = renderInJsdom(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <RepoDashboardPane repoId={REPO_ID} />
      </QueryClientProvider>,
    )

    expect(container.textContent).toContain('status.stale-title')
    expect(container.textContent).toContain('error.try-again')
    expect(container.textContent).toContain('dashboard.metric.branches')
    primaryWindowQueryClient.setQueryDefaults(statusQueryKey, {})
  })

  test('hides the attention section when no branch needs attention', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('main')],
      currentBranchName: 'main',
    })

    const { container } = renderInJsdom(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <RepoDashboardPane repoId={REPO_ID} />
      </QueryClientProvider>,
    )

    expect(container.textContent).not.toContain('dashboard.attention.title')
    expect(container.textContent).not.toContain('dashboard.attention.empty')
  })

  test('uses projection pull request data for PR metrics and attention badges', () => {
    const featureBranch = createRepoBranch('feature/pr')
    const mainBranch = createRepoBranch('main')
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [featureBranch, mainBranch],
      currentBranchName: 'main',
    })
    setRepoProjectionQueryData(REPO_ID, repo.workspaceRuntimeId, null, 'summary', {
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
      operations: { operations: [], loadedAt: 123 },
      requested: { branch: null, pullRequestMode: 'summary' },
      loadedAt: 123,
    })

    const { container } = renderInJsdom(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <RepoDashboardPane repoId={REPO_ID} />
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
      id: REPO_ID,
      branches: [createRepoBranch('feature/open')],
      currentBranchName: 'feature/open',
    })

    const { getByTestId } = renderInJsdom(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <RepoDashboardPane repoId={REPO_ID} onSelectBranch={onSelectBranch} />
      </QueryClientProvider>,
    )

    getByTestId('dashboard-branch-link').click()

    expect(onSelectBranch).toHaveBeenCalledWith('feature/open')
  })
})
