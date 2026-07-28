import { describe, expect, test } from 'vitest'
import { WORKSPACE_ID } from '#/web/test-utils/repo-query-runtime.ts'
import { repoOperationsQueryKey, repoPullRequestsQueryKey, repoSnapshotQueryKey } from '#/web/repo-query-keys.ts'

describe('repo query keys', () => {
  test('keeps snapshots branch-independent and separates pull-request scopes', () => {
    expect(repoSnapshotQueryKey(WORKSPACE_ID, 'repo-runtime-1')).toEqual(
      repoSnapshotQueryKey(WORKSPACE_ID, 'repo-runtime-1'),
    )
    expect(
      repoPullRequestsQueryKey(WORKSPACE_ID, 'repo-runtime-1', { kind: 'branch-detail', branch: 'feature/a' }),
    ).not.toEqual(
      repoPullRequestsQueryKey(WORKSPACE_ID, 'repo-runtime-1', { kind: 'branch-detail', branch: 'feature/b' }),
    )
  })

  test('separates operation snapshots by settled inclusion', () => {
    expect(repoOperationsQueryKey(WORKSPACE_ID, 'repo-runtime-1', false)).not.toEqual(
      repoOperationsQueryKey(WORKSPACE_ID, 'repo-runtime-1', true),
    )
  })
})
