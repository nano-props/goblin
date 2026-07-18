import { QueryClient } from '@tanstack/react-query'
import { describe, expect, test } from 'vitest'
import { workspaceRuntimesQueryKey, updateWorkspaceRuntimeCache } from '#/web/workspace-runtime-query.ts'
import type { WorkspaceRuntimesSnapshot } from '#/shared/api-types.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

describe('workspace runtime query cache', () => {
  test('preserves lifecycle projection during a partial membership cache update', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData<WorkspaceRuntimesSnapshot>(workspaceRuntimesQueryKey(), {
      runtimes: [
        {
          workspaceId: workspaceIdForTest('goblin+ssh://example/repo'),
          workspaceRuntimeId: 'repo-runtime-test-1',
          workspaceProbe: { status: 'probing' },
          remoteLifecycle: { kind: 'connecting', attemptId: 2 },
        },
      ],
    })

    await updateWorkspaceRuntimeCache(
      {
        workspaceId: workspaceIdForTest('goblin+ssh://example/repo'),
        workspaceRuntimeId: 'repo-runtime-test-1',
      },
      queryClient,
    )

    expect(queryClient.getQueryData<WorkspaceRuntimesSnapshot>(workspaceRuntimesQueryKey())?.runtimes).toEqual([
      {
        workspaceId: 'goblin+ssh://example/repo',
        workspaceRuntimeId: 'repo-runtime-test-1',
        workspaceProbe: { status: 'probing' },
        remoteLifecycle: { kind: 'connecting', attemptId: 2 },
      },
    ])
  })
})
