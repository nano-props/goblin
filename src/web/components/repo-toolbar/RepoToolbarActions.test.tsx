// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { BranchFilterAction } from '#/web/components/repo-toolbar/RepoToolbarActions.tsx'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  createBranchSnapshot,
  resetReposStore,
  seedRepoReadModelQueryData,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'

const REPO_ID = '/tmp/gbl-repo-toolbar-actions-test-repo'

beforeEach(() => {
  primaryWindowQueryClient.clear()
  resetReposStore()
  vi.clearAllMocks()
})

describe('RepoToolbarActions', () => {
  test('enables the branch filter from the React Query projection branch count', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [],
      currentBranchName: 'feature/query',
    })
    seedRepoReadModelQueryData(repo, {
      branches: [createBranchSnapshot('feature/query', { isCurrent: true })],
      currentBranch: 'feature/query',
    })

    renderInJsdom(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <BranchFilterAction repoId={REPO_ID} />
      </QueryClientProvider>,
    )

    expect(screen.getByLabelText('branches.filter-label').hasAttribute('disabled')).toBe(false)
  })

  test('keeps the branch filter disabled when neither store nor query has branches', () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [],
      currentBranchName: '',
    })

    renderInJsdom(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <BranchFilterAction repoId={REPO_ID} />
      </QueryClientProvider>,
    )

    expect(screen.getByLabelText('branches.filter-label').hasAttribute('disabled')).toBe(true)
  })
})
