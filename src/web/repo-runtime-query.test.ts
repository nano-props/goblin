import { QueryClient } from '@tanstack/react-query'
import { describe, expect, test } from 'vitest'
import { repoRuntimesQueryKey, updateRepoRuntimeCache } from '#/web/repo-runtime-query.ts'
import type { RepoRuntimesSnapshot } from '#/shared/api-types.ts'

describe('repo runtime query cache', () => {
  test('preserves lifecycle projection during a partial membership cache update', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData<RepoRuntimesSnapshot>(repoRuntimesQueryKey(), {
      runtimes: [{
        repoRoot: 'ssh-config://example/repo',
        repoRuntimeId: 'repo-runtime-test-1',
        remoteLifecycle: { kind: 'connecting', attemptId: 2 },
      }],
    })

    await updateRepoRuntimeCache({
      repoRoot: 'ssh-config://example/repo', repoRuntimeId: 'repo-runtime-test-1',
    }, queryClient)

    expect(queryClient.getQueryData<RepoRuntimesSnapshot>(repoRuntimesQueryKey())?.runtimes).toEqual([{
      repoRoot: 'ssh-config://example/repo',
      repoRuntimeId: 'repo-runtime-test-1',
      remoteLifecycle: { kind: 'connecting', attemptId: 2 },
    }])
  })
})
