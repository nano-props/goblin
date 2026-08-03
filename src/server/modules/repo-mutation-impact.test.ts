import { describe, expect, test } from 'vitest'
import type { RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  appendRepoMutationRecoveryMessageKey,
  localWorktreeRepoIds,
  remoteWorktreeRepoIds,
  uniqueRepoMutationRecoveryMessageKeys,
  withRepoIdsToInvalidate,
  workspaceIdForLocalWorktreePath,
} from '#/server/modules/repo-mutation-impact.ts'

describe('repo mutation impact', () => {
  test('deduplicates affected repos while preserving the mutation result', () => {
    const workspaceId = workspaceIdForTest('goblin+file:///workspace/main')
    const result = { ok: false, message: 'partial failure' }

    expect(withRepoIdsToInvalidate(result, [workspaceId, workspaceId])).toEqual({
      ...result,
      repoIdsToInvalidate: [workspaceId],
    })
    expect(withRepoIdsToInvalidate(result, [])).toBe(result)
  })

  test('projects non-bare local worktrees to canonical workspace ids', () => {
    const workspaceId = workspaceIdForLocalWorktreePath('/workspace/main')
    if (!workspaceId) throw new Error('expected local workspace id')

    expect(
      localWorktreeRepoIds([
        { path: '/workspace/main', branch: 'main', isBare: false, isPrimary: true },
        { path: '/workspace/bare.git', isBare: true, isPrimary: false },
      ]),
    ).toEqual([workspaceId])
  })

  test('projects remote worktree paths through the captured workspace alias', () => {
    const target: RemoteWorkspaceTarget = {
      id: workspaceIdForTest('goblin+ssh://example/workspace/main'),
      alias: 'example',
      host: 'example.test',
      user: 'developer',
      port: 22,
      remotePath: '/workspace/main',
      displayName: 'example:main',
    }

    expect(remoteWorktreeRepoIds(target, ['/workspace/main', '/workspace/feature'])).toEqual([
      workspaceIdForTest('goblin+ssh://example/workspace/main'),
      workspaceIdForTest('goblin+ssh://example/workspace/feature'),
    ])
    expect(remoteWorktreeRepoIds(target, undefined)).toEqual([])
  })

  test('appends a new recovery notice after established notices', () => {
    expect(
      appendRepoMutationRecoveryMessageKey(
        ['error.worktree-created-followup-failed'],
        'error.workspace-runtime-settlement-failed',
      ),
    ).toEqual(['error.worktree-created-followup-failed', 'error.workspace-runtime-settlement-failed'])
  })

  test('preserves the authoritative list when the notice is already present', () => {
    const recoveryMessageKeys = ['error.workspace-runtime-settlement-failed'] as const

    expect(appendRepoMutationRecoveryMessageKey(recoveryMessageKeys, 'error.workspace-runtime-settlement-failed')).toBe(
      recoveryMessageKeys,
    )
  })

  test('keeps the first recovery notice occurrence when normalizing a combined result', () => {
    expect(
      uniqueRepoMutationRecoveryMessageKeys([
        'error.worktree-removed-followup-failed',
        'error.local-branch-deleted-followup-failed',
        'error.worktree-removed-followup-failed',
      ]),
    ).toEqual(['error.worktree-removed-followup-failed', 'error.local-branch-deleted-followup-failed'])
  })
})
