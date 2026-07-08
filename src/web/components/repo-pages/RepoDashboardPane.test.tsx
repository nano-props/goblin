// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoDashboardPane } from '#/web/components/repo-pages/RepoDashboardPane.tsx'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { setRepoProjectionQueryData } from '#/web/repo-data-query.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import {
  createPullRequest,
  createRepoBranch,
  resetReposStore,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'

const REPO_ID = '/tmp/repo-dashboard-pane-test'

beforeEach(() => {
  resetReposStore()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RepoDashboardPane', () => {
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
    setRepoProjectionQueryData(REPO_ID, repo.repoRuntimeId, null, 'summary', {
      snapshot: { current: 'main', branches: [featureBranch, mainBranch] },
      status: [],
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
