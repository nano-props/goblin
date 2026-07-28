import { describe, expect, test } from 'vitest'
import { WORKSPACE_ID } from '#/web/test-utils/repo-query-runtime.ts'
import { repoOperationsQueryKey, repoProjectionQueryKey } from '#/web/repo-query-keys.ts'

describe('repo query keys', () => {
  test('separates projection branch and fetch mode', () => {
    expect(repoProjectionQueryKey(WORKSPACE_ID, 'repo-runtime-1', 'feature/a', 'summary')).not.toEqual(
      repoProjectionQueryKey(WORKSPACE_ID, 'repo-runtime-1', 'feature/a', 'full'),
    )
    expect(repoProjectionQueryKey(WORKSPACE_ID, 'repo-runtime-1', 'feature/a', 'full')).not.toEqual(
      repoProjectionQueryKey(WORKSPACE_ID, 'repo-runtime-1', 'feature/b', 'full'),
    )
  })

  test('separates operation snapshots by settled inclusion', () => {
    expect(repoOperationsQueryKey(WORKSPACE_ID, 'repo-runtime-1', false)).not.toEqual(
      repoOperationsQueryKey(WORKSPACE_ID, 'repo-runtime-1', true),
    )
  })
})
