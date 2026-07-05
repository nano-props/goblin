// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { BranchFilterAction } from '#/web/components/repo-toolbar/RepoToolbarActions.tsx'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { setRepoSnapshotQueryData } from '#/web/repo-data-query.ts'
import { createBranchSnapshot, resetReposStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'

const REPO_ID = '/tmp/gbl-repo-toolbar-actions-test-repo'

beforeEach(() => {
  primaryWindowQueryClient.clear()
  resetReposStore()
  vi.clearAllMocks()
})

describe('RepoToolbarActions', () => {
  test('enables the branch filter from the React Query snapshot branch count', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [],
      currentBranchName: 'feature/query',
    })
    setRepoSnapshotQueryData(REPO_ID, repo.instanceId, {
      current: 'feature/query',
      branches: [createBranchSnapshot('feature/query', { isCurrent: true })],
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
