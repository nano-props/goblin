// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { BranchFilterAction, CreateWorktreeRowAction } from '#/web/components/repo-toolbar/RepoToolbarActions.tsx'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  createBranchSnapshot,
  resetReposStore,
  seedRepoReadModelQueryData,
  seedRepoShellForTest,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { setRepoOperationsQueryData } from '#/web/repo-data-query.ts'
import type { RepoServerOperationState } from '#/shared/api-types.ts'

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

  test('disables create worktree entry from server branch operation projection', () => {
    const repo = seedRepoShellForTest({ id: REPO_ID })
    setRepoOperationsQueryData(REPO_ID, repo.repoRuntimeId, false, {
      operations: [serverOperation(repo.repoRuntimeId, { kind: 'create-worktree', phase: 'running' })],
      loadedAt: 123,
    })

    renderInJsdom(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <CreateWorktreeRowAction repoId={REPO_ID} />
      </QueryClientProvider>,
    )

    expect(screen.getByTestId('create-worktree-button').hasAttribute('disabled')).toBe(true)
  })
})

function serverOperation(
  repoRuntimeId: string,
  overrides: Pick<RepoServerOperationState, 'kind' | 'phase'>,
): RepoServerOperationState {
  return {
    id: `repo-op-${overrides.kind}-${overrides.phase}`,
    repoId: REPO_ID,
    repoRuntimeId,
    kind: overrides.kind,
    phase: overrides.phase,
    source: 'user',
    target: null,
    queuedAt: 100,
    startedAt: overrides.phase === 'queued' ? null : 101,
    deadlineAt: null,
    settledAt: null,
    error: null,
    cancellation: {
      underlyingRequested: false,
      reason: null,
      requestedAt: null,
      waitCancelledCount: 0,
      lastWaitCancelledAt: null,
      lastWaitCancellationReason: null,
    },
    canCancelUnderlying: true,
  }
}
