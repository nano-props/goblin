import { createElement } from 'react'
import { focusManager, QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { RepoWorktreeStatusSnapshot } from '#/shared/api-types.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { getRepoWorktreeStatusQueryData, setRepoWorktreeStatusQueryData } from '#/web/repo-query-cache.ts'
import { repoWorktreeStatusQueryOptions } from '#/web/repo-query-options.ts'
import { useRepoWorktreeStatusReadModel } from '#/web/repo-queries.ts'
import {
  invalidateRepoMetadataQueries,
  invalidateRepoWorktreeStatusQueries,
  refreshRepoWorktreeStatusReadModel,
} from '#/web/repo-query-runtime.ts'
import { WORKSPACE_ID } from '#/web/test-utils/repo-query-runtime.ts'

const repoClientMocks = vi.hoisted(() => ({
  getRepoWorktreeStatus: vi.fn(),
}))

vi.mock('#/web/repo-client.ts', () => repoClientMocks)

beforeEach(() => {
  repoClientMocks.getRepoWorktreeStatus.mockReset()
})

describe('repo worktree status query data', () => {
  test('shares status across observers and revalidates a cached workspace once when it becomes active', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const releases: Array<(snapshot: RepoWorktreeStatusSnapshot) => void> = []
    repoClientMocks.getRepoWorktreeStatus.mockImplementation(
      () =>
        new Promise<RepoWorktreeStatusSnapshot>((resolve) => {
          releases.push(resolve)
        }),
    )
    function StatusObservers() {
      useRepoWorktreeStatusReadModel(WORKSPACE_ID, 'repo-runtime-1', true)
      useRepoWorktreeStatusReadModel(WORKSPACE_ID, 'repo-runtime-1', true)
      return null
    }

    const first = renderInJsdom(
      createElement(QueryClientProvider, { client: queryClient }, createElement(StatusObservers)),
    )
    await vi.waitFor(() => expect(releases).toHaveLength(1))
    releases[0]!({ workspaceRuntimeId: 'repo-runtime-1', status: [], loadedAt: 1 })
    await vi.waitFor(() =>
      expect(getRepoWorktreeStatusQueryData(WORKSPACE_ID, 'repo-runtime-1', queryClient)?.loadedAt).toBe(1),
    )
    first.unmount()

    const second = renderInJsdom(
      createElement(QueryClientProvider, { client: queryClient }, createElement(StatusObservers)),
    )
    try {
      await vi.waitFor(() => expect(releases).toHaveLength(2))
      expect(repoClientMocks.getRepoWorktreeStatus).toHaveBeenCalledTimes(2)
      releases[1]!({ workspaceRuntimeId: 'repo-runtime-1', status: [], loadedAt: 2 })
      await vi.waitFor(() =>
        expect(getRepoWorktreeStatusQueryData(WORKSPACE_ID, 'repo-runtime-1', queryClient)?.loadedAt).toBe(2),
      )

      invalidateRepoMetadataQueries(WORKSPACE_ID, 'repo-runtime-1', queryClient)
      await Promise.resolve()
      expect(releases).toHaveLength(2)
      expect(repoClientMocks.getRepoWorktreeStatus).toHaveBeenCalledTimes(2)

      invalidateRepoWorktreeStatusQueries(WORKSPACE_ID, 'repo-runtime-1', queryClient)
      await vi.waitFor(() => expect(releases).toHaveLength(3))
      releases[2]!({ workspaceRuntimeId: 'repo-runtime-1', status: [], loadedAt: 3 })
      await vi.waitFor(() =>
        expect(getRepoWorktreeStatusQueryData(WORKSPACE_ID, 'repo-runtime-1', queryClient)?.loadedAt).toBe(3),
      )
      expect(repoClientMocks.getRepoWorktreeStatus).toHaveBeenCalledTimes(3)
    } finally {
      second.unmount()
      queryClient.clear()
    }
  })

  test('shares one status refetch across repeated focus activation without cancelling it', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const signals: AbortSignal[] = []
    const releases: Array<(snapshot: RepoWorktreeStatusSnapshot) => void> = []
    setRepoWorktreeStatusQueryData(
      WORKSPACE_ID,
      'repo-runtime-1',
      { workspaceRuntimeId: 'repo-runtime-1', status: [], loadedAt: 1 },
      queryClient,
    )
    repoClientMocks.getRepoWorktreeStatus.mockImplementation((_repoRoot, _workspaceRuntimeId, signal) => {
      signals.push(signal)
      return new Promise<RepoWorktreeStatusSnapshot>((resolve) => releases.push(resolve))
    })
    function StatusObservers() {
      useRepoWorktreeStatusReadModel(WORKSPACE_ID, 'repo-runtime-1', true)
      useRepoWorktreeStatusReadModel(WORKSPACE_ID, 'repo-runtime-1', true)
      return null
    }

    focusManager.setFocused(false)
    const result = renderInJsdom(
      createElement(QueryClientProvider, { client: queryClient }, createElement(StatusObservers)),
    )
    try {
      await vi.waitFor(() => expect(releases).toHaveLength(1))
      releases[0]!({ workspaceRuntimeId: 'repo-runtime-1', status: [], loadedAt: 2 })
      await vi.waitFor(() =>
        expect(getRepoWorktreeStatusQueryData(WORKSPACE_ID, 'repo-runtime-1', queryClient)?.loadedAt).toBe(2),
      )

      focusManager.setFocused(true)
      await vi.waitFor(() => expect(releases).toHaveLength(2))
      focusManager.setFocused(false)
      focusManager.setFocused(true)

      expect(releases).toHaveLength(2)
      expect(signals[1]?.aborted).toBe(false)
      releases[1]!({ workspaceRuntimeId: 'repo-runtime-1', status: [], loadedAt: 3 })
      await vi.waitFor(() =>
        expect(getRepoWorktreeStatusQueryData(WORKSPACE_ID, 'repo-runtime-1', queryClient)?.loadedAt).toBe(3),
      )
      expect(repoClientMocks.getRepoWorktreeStatus).toHaveBeenCalledTimes(2)
    } finally {
      result.unmount()
      queryClient.clear()
      focusManager.setFocused(undefined)
    }
  })

  test('retries only the stale in-flight status read after invalidation', async () => {
    const queryClient = new QueryClient()
    const releases: Array<(snapshot: RepoWorktreeStatusSnapshot) => void> = []
    repoClientMocks.getRepoWorktreeStatus.mockImplementation(
      () =>
        new Promise<RepoWorktreeStatusSnapshot>((resolve) => {
          releases.push(resolve)
        }),
    )
    const observer = new QueryObserver(queryClient, repoWorktreeStatusQueryOptions(WORKSPACE_ID, 'repo-runtime-1'))
    const unsubscribe = observer.subscribe(() => {})
    try {
      await vi.waitFor(() => expect(releases).toHaveLength(1))
      invalidateRepoWorktreeStatusQueries(WORKSPACE_ID, 'repo-runtime-1', queryClient)
      releases[0]!({ workspaceRuntimeId: 'repo-runtime-1', status: [], loadedAt: 1 })

      await vi.waitFor(() => expect(releases).toHaveLength(2))
      releases[1]!({ workspaceRuntimeId: 'repo-runtime-1', status: [], loadedAt: 2 })
      await vi.waitFor(() => expect(observer.getCurrentResult().data?.loadedAt).toBe(2))
      expect(observer.getCurrentResult().isError).toBe(false)
      expect(repoClientMocks.getRepoWorktreeStatus).toHaveBeenCalledTimes(2)
    } finally {
      unsubscribe()
      queryClient.clear()
    }
  })

  test('retries a stale explicit status refresh after invalidation', async () => {
    const queryClient = new QueryClient()
    const releases: Array<(snapshot: RepoWorktreeStatusSnapshot) => void> = []
    repoClientMocks.getRepoWorktreeStatus.mockImplementation(
      () =>
        new Promise<RepoWorktreeStatusSnapshot>((resolve) => {
          releases.push(resolve)
        }),
    )

    const refresh = refreshRepoWorktreeStatusReadModel(WORKSPACE_ID, 'repo-runtime-1', { queryClient })
    await vi.waitFor(() => expect(releases).toHaveLength(1))
    invalidateRepoWorktreeStatusQueries(WORKSPACE_ID, 'repo-runtime-1', queryClient)
    releases[0]!({ workspaceRuntimeId: 'repo-runtime-1', status: [], loadedAt: 1 })

    await vi.waitFor(() => expect(releases).toHaveLength(2))
    releases[1]!({ workspaceRuntimeId: 'repo-runtime-1', status: [], loadedAt: 2 })
    await expect(refresh).resolves.toMatchObject({ loadedAt: 2 })
    expect(getRepoWorktreeStatusQueryData(WORKSPACE_ID, 'repo-runtime-1', queryClient)?.loadedAt).toBe(2)
    expect(repoClientMocks.getRepoWorktreeStatus).toHaveBeenCalledTimes(2)
  })

  test('does not accept a status read that started before an explicit refresh', async () => {
    const queryClient = new QueryClient()
    const reads: Array<PromiseWithResolvers<RepoWorktreeStatusSnapshot>> = []
    repoClientMocks.getRepoWorktreeStatus.mockImplementation(() => {
      const read = Promise.withResolvers<RepoWorktreeStatusSnapshot>()
      reads.push(read)
      return read.promise
    })
    const observer = new QueryObserver(queryClient, repoWorktreeStatusQueryOptions(WORKSPACE_ID, 'repo-runtime-1'))
    const unsubscribe = observer.subscribe(() => {})
    await vi.waitFor(() => expect(reads).toHaveLength(1))

    const refresh = refreshRepoWorktreeStatusReadModel(WORKSPACE_ID, 'repo-runtime-1', { queryClient })
    reads[0]!.resolve({ workspaceRuntimeId: 'repo-runtime-1', status: [], loadedAt: 1 })
    await vi.waitFor(() => expect(reads).toHaveLength(2))
    reads[1]!.resolve({ workspaceRuntimeId: 'repo-runtime-1', status: [], loadedAt: 2 })

    await expect(refresh).resolves.toMatchObject({ loadedAt: 2 })
    expect(getRepoWorktreeStatusQueryData(WORKSPACE_ID, 'repo-runtime-1', queryClient)?.loadedAt).toBe(2)
    unsubscribe()
  })

  test('does not create status data when the first refresh fails', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    repoClientMocks.getRepoWorktreeStatus.mockRejectedValue(new Error('transport failed'))

    await expect(refreshRepoWorktreeStatusReadModel(WORKSPACE_ID, 'repo-runtime-1', { queryClient })).rejects.toThrow(
      'transport failed',
    )
    expect(getRepoWorktreeStatusQueryData(WORKSPACE_ID, 'repo-runtime-1', queryClient)).toBeUndefined()
  })

  test('shares the current read after a concurrent refresh supersedes the first read', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const reads: Array<PromiseWithResolvers<RepoWorktreeStatusSnapshot>> = []
    repoClientMocks.getRepoWorktreeStatus.mockImplementation(() => {
      const read = Promise.withResolvers<RepoWorktreeStatusSnapshot>()
      reads.push(read)
      return read.promise
    })

    const first = refreshRepoWorktreeStatusReadModel(WORKSPACE_ID, 'repo-runtime-1', { queryClient })
    await vi.waitFor(() => expect(repoClientMocks.getRepoWorktreeStatus).toHaveBeenCalledOnce())
    const second = refreshRepoWorktreeStatusReadModel(WORKSPACE_ID, 'repo-runtime-1', { queryClient })
    reads[0]!.resolve({ workspaceRuntimeId: 'repo-runtime-1', status: [], loadedAt: 1 })
    await vi.waitFor(() => expect(reads).toHaveLength(2))
    reads[1]!.reject(new Error('transport failed'))

    const results = await Promise.allSettled([first, second])
    expect(results).toEqual([
      expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ message: 'transport failed' }) }),
      expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ message: 'transport failed' }) }),
    ])
    expect(repoClientMocks.getRepoWorktreeStatus).toHaveBeenCalledTimes(2)
    expect(getRepoWorktreeStatusQueryData(WORKSPACE_ID, 'repo-runtime-1', queryClient)).toBeUndefined()
  })

  test('caller cancellation does not abort a shared status read', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const controller = new AbortController()
    const transportSignals: AbortSignal[] = []
    const reads: Array<PromiseWithResolvers<RepoWorktreeStatusSnapshot>> = []
    repoClientMocks.getRepoWorktreeStatus.mockImplementation((_repoRoot, _repoRuntimeId, signal) => {
      transportSignals.push(signal)
      const read = Promise.withResolvers<RepoWorktreeStatusSnapshot>()
      reads.push(read)
      return read.promise
    })

    const first = refreshRepoWorktreeStatusReadModel(WORKSPACE_ID, 'repo-runtime-1', {
      queryClient,
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(repoClientMocks.getRepoWorktreeStatus).toHaveBeenCalledOnce())
    const second = refreshRepoWorktreeStatusReadModel(WORKSPACE_ID, 'repo-runtime-1', { queryClient })
    controller.abort(new Error('caller stopped'))

    await expect(first).rejects.toThrow('caller stopped')
    expect(transportSignals[0]?.aborted).toBe(false)
    reads[0]!.resolve({ workspaceRuntimeId: 'repo-runtime-1', status: [], loadedAt: 1 })
    await vi.waitFor(() => expect(reads).toHaveLength(2))
    reads[1]!.resolve({ workspaceRuntimeId: 'repo-runtime-1', status: [], loadedAt: 2 })
    await expect(second).resolves.toMatchObject({ loadedAt: 2 })
    expect(repoClientMocks.getRepoWorktreeStatus).toHaveBeenCalledTimes(2)
  })

  test('preserves the last accepted status when refresh fails', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const accepted = {
      workspaceRuntimeId: 'repo-runtime-1',
      status: [{ path: '/tmp/repo', branch: 'main', isMain: true, entries: [{ x: 'M', y: ' ', path: 'a.ts' }] }],
      loadedAt: 1,
    }
    setRepoWorktreeStatusQueryData(WORKSPACE_ID, 'repo-runtime-1', accepted, queryClient)
    repoClientMocks.getRepoWorktreeStatus.mockRejectedValue(new Error('transport failed'))

    await expect(refreshRepoWorktreeStatusReadModel(WORKSPACE_ID, 'repo-runtime-1', { queryClient })).rejects.toThrow(
      'transport failed',
    )
    expect(getRepoWorktreeStatusQueryData(WORKSPACE_ID, 'repo-runtime-1', queryClient)).toEqual(accepted)
  })

  test('accepts a successful empty collection as clean', async () => {
    const queryClient = new QueryClient()
    repoClientMocks.getRepoWorktreeStatus.mockResolvedValue({
      workspaceRuntimeId: 'repo-runtime-1',
      status: [],
      loadedAt: 2,
    })

    await refreshRepoWorktreeStatusReadModel(WORKSPACE_ID, 'repo-runtime-1', { queryClient })

    expect(getRepoWorktreeStatusQueryData(WORKSPACE_ID, 'repo-runtime-1', queryClient)?.status).toEqual([])
  })

  test('rejects a response belonging to a replaced workspace runtime', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    repoClientMocks.getRepoWorktreeStatus.mockResolvedValue({
      workspaceRuntimeId: 'repo-runtime-old',
      status: [],
      loadedAt: 2,
    })

    await expect(
      refreshRepoWorktreeStatusReadModel(WORKSPACE_ID, 'repo-runtime-current', { queryClient }),
    ).rejects.toMatchObject({
      name: 'MismatchedRepoRuntimeReadError',
      message: 'error.failed-read-repo',
      cause: expect.objectContaining({ message: 'Mismatched workspace runtime read' }),
    })
    expect(repoClientMocks.getRepoWorktreeStatus).toHaveBeenCalledOnce()
    expect(getRepoWorktreeStatusQueryData(WORKSPACE_ID, 'repo-runtime-current', queryClient)).toBeUndefined()
  })
})
