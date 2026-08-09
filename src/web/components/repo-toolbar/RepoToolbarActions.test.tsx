// @vitest-environment jsdom

import {
  resetWorkspacesStore,
  seedRepoQueryDataForTest,
  seedRepoShellForTest,
  seedRepoWithReadModelForTest,
  createBranchSnapshot,
} from '#/web/test-utils/repo-store.ts'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { screen } from '@testing-library/vue'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { BranchFilterAction, CreateWorktreeRowAction } from '#/web/components/repo-toolbar/RepoToolbarActions.tsx'
import { appQueryClient } from '#/web/app-query-client.ts'
import { setRepoOperationsQueryData } from '#/web/repo-query-cache.ts'
import type { RepoServerOperationState } from '#/shared/api-types.ts'

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/goblin-repo-toolbar-actions-test-repo')

beforeEach(() => {
  appQueryClient.clear()
  resetWorkspacesStore()
  vi.clearAllMocks()
})

describe('RepoToolbarActions', () => {
  test('enables the branch filter from the TanStack Query projection branch count', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [],
      currentBranchName: 'feature/query',
    })
    seedRepoQueryDataForTest(repo, {
      branches: [createBranchSnapshot('feature/query', { isCurrent: true })],
      currentBranch: 'feature/query',
    })

    renderInJsdom(
      <VueQueryClientScope client={appQueryClient}>
        <BranchFilterAction repoId={REPO_ID} />
      </VueQueryClientScope>,
    )

    expect(screen.getByLabelText('branches.filter-label').hasAttribute('disabled')).toBe(false)
  })

  test('keeps the branch filter disabled when neither store nor query has branches', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [],
      currentBranchName: '',
    })

    renderInJsdom(
      <VueQueryClientScope client={appQueryClient}>
        <BranchFilterAction repoId={REPO_ID} />
      </VueQueryClientScope>,
    )

    expect(screen.getByLabelText('branches.filter-label').hasAttribute('disabled')).toBe(true)
  })

  test('disables create worktree entry from server branch operation projection', async () => {
    const repo = seedRepoShellForTest({ id: REPO_ID })
    setRepoOperationsQueryData(REPO_ID, repo.workspaceRuntimeId, false, {
      operations: [serverOperation(repo.workspaceRuntimeId, { kind: 'create-worktree', phase: 'running' })],
      lastFetchAt: null,
      loadedAt: 123,
    })

    renderInJsdom(
      <VueQueryClientScope client={appQueryClient}>
        <CreateWorktreeRowAction repoId={REPO_ID} />
      </VueQueryClientScope>,
    )

    expect(screen.getByTestId('create-worktree-button').hasAttribute('disabled')).toBe(true)
  })
})

function serverOperation(
  workspaceRuntimeId: string,
  overrides: Pick<RepoServerOperationState, 'kind' | 'phase'>,
): RepoServerOperationState {
  return {
    id: `repo-op-${overrides.kind}-${overrides.phase}`,
    repoId: REPO_ID,
    workspaceRuntimeId,
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
