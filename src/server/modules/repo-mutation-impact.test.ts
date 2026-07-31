import { describe, expect, test } from 'vitest'
import type { RemoteWorkspaceTarget } from '#/shared/remote-workspace.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  localWorktreeRepoIds,
  remoteWorktreeRepoIds,
  withAffectedRepoIds,
  withAffectedRepoIdsIfChanged,
  workspaceIdForLocalWorktreePath,
} from '#/server/modules/repo-mutation-impact.ts'

describe('repo mutation impact', () => {
  test('deduplicates affected repos while preserving the mutation result', () => {
    const workspaceId = workspaceIdForTest('goblin+file:///workspace/main')
    const result = { ok: false, message: 'partial failure', repositoryStateChanged: true }

    expect(withAffectedRepoIds(result, [workspaceId, workspaceId])).toEqual({
      ...result,
      affectedRepoIds: [workspaceId],
    })
    expect(withAffectedRepoIds(result, [])).toBe(result)
  })

  test('only attaches affected repos when the mutation changed repository state', () => {
    const workspaceId = workspaceIdForTest('goblin+file:///workspace/main')
    const unchangedFailure = { ok: false, message: 'rejected' }

    expect(withAffectedRepoIdsIfChanged({ ok: true, message: 'updated' }, [workspaceId])).toEqual({
      ok: true,
      message: 'updated',
      affectedRepoIds: [workspaceId],
    })
    expect(
      withAffectedRepoIdsIfChanged({ ok: false, message: 'partial failure', repositoryStateChanged: true }, [
        workspaceId,
      ]),
    ).toEqual({
      ok: false,
      message: 'partial failure',
      repositoryStateChanged: true,
      affectedRepoIds: [workspaceId],
    })
    expect(withAffectedRepoIdsIfChanged(unchangedFailure, [workspaceId])).toBe(unchangedFailure)
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
})
