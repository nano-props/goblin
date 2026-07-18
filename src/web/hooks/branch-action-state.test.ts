import { describe, expect, test } from 'vitest'
import {
  branchActionOperationFromServer,
  isActiveServerBranchAction,
  projectBranchActionOperation,
  projectBranchActionRepo,
  serverBranchActionReason,
} from '#/web/hooks/branch-action-state.ts'
import { idleOperation } from '#/web/stores/repos/operations.ts'
import type { RepoServerOperationState } from '#/shared/api-types.ts'

const REPO_ID = 'goblin+file:///tmp/goblin-branch-action-state'

describe('branch action state projection', () => {
  test('maps active server branch operations onto the branch action operation shape', () => {
    const operation = serverOperation({ kind: 'push', phase: 'running', branch: 'feature/a' })

    expect(isActiveServerBranchAction(operation)).toBe(true)
    expect(serverBranchActionReason(operation)).toBe('branch:push')
    expect(branchActionOperationFromServer(idleOperation(), [operation], 'feature/a')).toMatchObject({
      phase: 'running',
      reason: 'branch:push',
      target: 'feature/a',
      startedAt: 101,
    })
  })

  test('maps queued operations without a start time', () => {
    expect(
      branchActionOperationFromServer(idleOperation(), [
        serverOperation({ kind: 'delete-branch', phase: 'queued', branch: 'feature/a' }),
      ]),
    ).toMatchObject({
      phase: 'queued',
      reason: 'branch:deleteBranch',
      target: 'feature/a',
      startedAt: null,
    })
  })

  test('falls back when the server operation targets another branch', () => {
    const fallback = idleOperation()

    expect(
      branchActionOperationFromServer(
        fallback,
        [serverOperation({ kind: 'remove-worktree', phase: 'running', branch: 'feature/other' })],
        'feature/a',
      ),
    ).toBe(fallback)
  })

  test('projects from a repo-shaped fallback without leaking the fallback read to callers', () => {
    const repo = {
      operations: {
        branchAction: {
          ...idleOperation(),
          phase: 'running' as const,
          reason: 'branch:pull' as const,
          target: 'feature/a',
        },
      },
    }

    expect(projectBranchActionOperation(repo.operations.branchAction, undefined)).toMatchObject({
      phase: 'running',
      reason: 'branch:pull',
      target: 'feature/a',
    })
    expect(
      projectBranchActionOperation(repo.operations.branchAction, [
        serverOperation({ kind: 'push', phase: 'queued', branch: 'feature/b' }),
      ]),
    ).toMatchObject({
      phase: 'queued',
      reason: 'branch:push',
      target: 'feature/b',
    })
  })

  test('projects a branch action repo without exposing the local operations wrapper', () => {
    const repo = {
      id: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-1',
      operations: {
        branchAction: idleOperation(),
      },
      remote: { hasRemotes: true },
    }

    const projected = projectBranchActionRepo(repo, [
      serverOperation({ kind: 'remove-worktree', phase: 'running', branch: 'feature/a' }),
    ])

    expect('operations' in projected).toBe(false)
    expect(projected).toMatchObject({
      id: REPO_ID,
      workspaceRuntimeId: 'repo-runtime-1',
      remote: { hasRemotes: true },
      branchAction: {
        phase: 'running',
        reason: 'branch:removeWorktree',
        target: 'feature/a',
      },
    })
  })

  test('ignores inactive and non-branch server operations', () => {
    const fallback = idleOperation()

    expect(branchActionOperationFromServer(fallback, [serverOperation({ kind: 'fetch', phase: 'running' })])).toBe(
      fallback,
    )
    expect(
      branchActionOperationFromServer(fallback, [
        serverOperation({ kind: 'create-worktree', phase: 'done', branch: 'feature/a' }),
      ]),
    ).toBe(fallback)
  })
})

function serverOperation(
  overrides: Pick<RepoServerOperationState, 'kind' | 'phase'> & { branch?: string },
): RepoServerOperationState {
  return {
    id: `repo-op-${overrides.kind}-${overrides.phase}`,
    repoId: REPO_ID,
    workspaceRuntimeId: 'repo-runtime-1',
    kind: overrides.kind,
    phase: overrides.phase,
    source: 'user',
    target: overrides.branch ? { branch: overrides.branch } : null,
    queuedAt: 100,
    startedAt: overrides.phase === 'queued' ? null : 101,
    deadlineAt: null,
    settledAt: overrides.phase === 'done' || overrides.phase === 'failed' ? 102 : null,
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
