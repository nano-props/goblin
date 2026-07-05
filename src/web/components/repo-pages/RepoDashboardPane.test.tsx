// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoDashboardPane } from '#/web/components/repo-pages/RepoDashboardPane.tsx'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { setRepoPullRequestsQueryData } from '#/web/repo-data-query.ts'
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
  test('uses pull request query data for PR metrics and attention badges', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/pr'), createRepoBranch('main')],
      currentBranchName: 'main',
    })
    setRepoPullRequestsQueryData(REPO_ID, repo.instanceId, undefined, undefined, [
      {
        branch: 'feature/pr',
        pullRequest: createPullRequest(42, {
          headRefName: 'feature/pr',
          checks: { total: 2, passing: 1, failing: 1, pending: 0 },
        }),
      },
    ])

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
})
