import { describe, expect, test } from 'vitest'
import type { RepoServerOperationState } from '#/shared/api-types.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  isSettledRepoWriteOperation,
  projectRepoWriteOperations,
  repoWriteOperationFailureReason,
  repoWriteOperationTimestamp,
} from '#/server/modules/repo-write-operation-state.ts'

const REPO_ID = workspaceIdForTest('goblin+file:///workspace')

function operation(
  id: string,
  phase: RepoServerOperationState['phase'],
  times: { queuedAt: number; startedAt?: number | null; settledAt?: number | null },
): RepoServerOperationState {
  return {
    id,
    repoId: REPO_ID,
    workspaceRuntimeId: 'runtime-a',
    kind: 'fetch',
    phase,
    source: 'user',
    target: null,
    queuedAt: times.queuedAt,
    startedAt: times.startedAt ?? null,
    deadlineAt: null,
    settledAt: times.settledAt ?? null,
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

describe('repo write operation state policy', () => {
  test('classifies settled phases and resolves their effective timestamp', () => {
    expect(isSettledRepoWriteOperation(operation('done', 'done', { queuedAt: 1, settledAt: 3 }))).toBe(true)
    expect(isSettledRepoWriteOperation(operation('running', 'running', { queuedAt: 1, startedAt: 2 }))).toBe(false)
    expect(repoWriteOperationTimestamp(operation('settled', 'done', { queuedAt: 1, startedAt: 2, settledAt: 3 }))).toBe(
      3,
    )
  })

  test('projects visible operations newest first and returns defensive nested copies', () => {
    const older = operation('older', 'running', { queuedAt: 1, startedAt: 2 })
    const newer = operation('newer', 'queued', { queuedAt: 3 })
    const settled = operation('settled', 'done', { queuedAt: 4, settledAt: 5 })

    const projected = projectRepoWriteOperations([older, settled, newer], {})

    expect(projected.map(({ id }) => id)).toEqual(['newer', 'older'])
    expect(projected[0]).not.toBe(newer)
    expect(projected[0]?.cancellation).not.toBe(newer.cancellation)
  })

  test('retains repo-scoped operations while filtering another runtime', () => {
    const repoScoped = { ...operation('repo', 'queued', { queuedAt: 1 }), workspaceRuntimeId: null }
    const otherRuntime = { ...operation('other', 'queued', { queuedAt: 2 }), workspaceRuntimeId: 'runtime-b' }

    expect(
      projectRepoWriteOperations([repoScoped, otherRuntime], { workspaceRuntimeId: 'runtime-a' }).map(({ id }) => id),
    ).toEqual(['repo'])
  })

  test('prefers explicit cancellation and recognizes legacy cancelled results', () => {
    expect(repoWriteOperationFailureReason('failure', 'git-timeout')).toBe('git-timeout')
    expect(repoWriteOperationFailureReason('cancelled', null)).toBe('caller-abort')
    expect(repoWriteOperationFailureReason('failure', null)).toBeNull()
  })
})
