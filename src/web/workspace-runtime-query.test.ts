import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  invalidateWorkspaceRuntimes,
  refreshWorkspaceRuntimes,
  removeWorkspaceRuntimeFromCache,
  workspaceRuntimesQueryKey,
  updateWorkspaceRuntimeCache,
} from '#/web/workspace-runtime-query.ts'
import type { WorkspaceRuntimesSnapshot } from '#/shared/api-types.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { listWorkspaceRuntimes } from '#/web/workspace-client.ts'

vi.mock('#/web/workspace-client.ts', () => ({ listWorkspaceRuntimes: vi.fn() }))

describe('workspace runtime query cache', () => {
  beforeEach(() => vi.clearAllMocks())

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

  test('coalesces command refresh with invalidation and performs one trailing authoritative read', async () => {
    const queryClient = new QueryClient()
    const first = Promise.withResolvers<WorkspaceRuntimesSnapshot>()
    const connecting: WorkspaceRuntimesSnapshot = { runtimes: [] }
    const settled: WorkspaceRuntimesSnapshot = { runtimes: [] }
    vi.mocked(listWorkspaceRuntimes)
      .mockImplementationOnce(async () => await first.promise)
      .mockResolvedValueOnce(settled)

    const commandRefresh = refreshWorkspaceRuntimes(queryClient)
    const invalidationRefresh = invalidateWorkspaceRuntimes(queryClient)
    const duplicateCommandRefresh = refreshWorkspaceRuntimes(queryClient)
    await vi.waitFor(() => expect(listWorkspaceRuntimes).toHaveBeenCalledOnce())

    first.resolve(connecting)

    await expect(Promise.all([commandRefresh, invalidationRefresh, duplicateCommandRefresh])).resolves.toEqual([
      settled,
      settled,
      settled,
    ])
    expect(listWorkspaceRuntimes).toHaveBeenCalledTimes(2)
  })

  test('orders membership cache mutations after an older authoritative read', async () => {
    const queryClient = new QueryClient()
    const read = Promise.withResolvers<WorkspaceRuntimesSnapshot>()
    vi.mocked(listWorkspaceRuntimes).mockImplementationOnce(async () => await read.promise)
    const refresh = refreshWorkspaceRuntimes(queryClient)
    await vi.waitFor(() => expect(listWorkspaceRuntimes).toHaveBeenCalledOnce())
    const workspaceId = workspaceIdForTest('goblin+file:///workspace')
    const update = updateWorkspaceRuntimeCache({ workspaceId, workspaceRuntimeId: 'runtime-current' }, queryClient)

    read.resolve({ runtimes: [] })
    await refresh
    await update

    expect(queryClient.getQueryData<WorkspaceRuntimesSnapshot>(workspaceRuntimesQueryKey())).toEqual({
      runtimes: [{ workspaceId, workspaceRuntimeId: 'runtime-current', workspaceProbe: { status: 'probing' } }],
    })
  })

  test('orders removal after an older read', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///workspace')
    const queryClient = new QueryClient()
    queryClient.setQueryData<WorkspaceRuntimesSnapshot>(workspaceRuntimesQueryKey(), {
      runtimes: [{ workspaceId, workspaceRuntimeId: 'runtime-old', workspaceProbe: { status: 'probing' } }],
    })
    const read = Promise.withResolvers<WorkspaceRuntimesSnapshot>()
    vi.mocked(listWorkspaceRuntimes).mockImplementationOnce(async () => await read.promise)
    const refresh = refreshWorkspaceRuntimes(queryClient)
    await vi.waitFor(() => expect(listWorkspaceRuntimes).toHaveBeenCalledOnce())
    const removal = removeWorkspaceRuntimeFromCache({ workspaceId, workspaceRuntimeId: 'runtime-old' }, queryClient)
    read.resolve({
      runtimes: [{ workspaceId, workspaceRuntimeId: 'runtime-old', workspaceProbe: { status: 'probing' } }],
    })
    await refresh
    await removal
    expect(queryClient.getQueryData<WorkspaceRuntimesSnapshot>(workspaceRuntimesQueryKey())?.runtimes).toEqual([])
  })

  test('drains a trailing invalidation after the preceding read fails', async () => {
    const queryClient = new QueryClient()
    const first = Promise.withResolvers<WorkspaceRuntimesSnapshot>()
    const settled: WorkspaceRuntimesSnapshot = { runtimes: [] }
    vi.mocked(listWorkspaceRuntimes)
      .mockImplementationOnce(async () => await first.promise)
      .mockResolvedValueOnce(settled)
    const connectingRead = refreshWorkspaceRuntimes(queryClient)
    await vi.waitFor(() => expect(listWorkspaceRuntimes).toHaveBeenCalledOnce())
    const terminalInvalidation = invalidateWorkspaceRuntimes(queryClient)

    first.reject(new Error('connection interrupted'))

    await expect(Promise.all([connectingRead, terminalInvalidation])).resolves.toEqual([settled, settled])
    expect(listWorkspaceRuntimes).toHaveBeenCalledTimes(2)
  })
})
