import { createElement } from 'react'
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { GitWorkspaceRuntimeProjection, PullRequestEntry, RepoOperationsSnapshot } from '#/shared/api-types.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import {
  getRepoOperationsQueryData,
  getRepoProjectionQueryData,
  seedRepoProjectionQueryData,
  setRepoProjectionQueryData,
} from '#/web/repo-query-cache.ts'
import { repoOperationsQueryKey, repoProjectionQueryKey, repoWorktreeStatusQueryKey } from '#/web/repo-query-keys.ts'
import { repoProjectionQueryOptions } from '#/web/repo-query-options.ts'
import { useRepoLogQuery, useRepoOperationsReadModel, useRepoRemoteBranchesQuery } from '#/web/repo-queries.ts'
import {
  invalidateRepoOperationsQueries,
  invalidateRepoSnapshotQueries,
  invalidateRepoWorktreeStatusQueries,
  refreshRepoProjectionReadModel,
} from '#/web/repo-query-runtime.ts'
import { repoOperationsForTest, repoProjectionForTest, WORKSPACE_ID } from '#/web/test-utils/repo-query-runtime.ts'

const repoClientMocks = vi.hoisted(() => ({
  getRepoLog: vi.fn(),
  getRepoOperations: vi.fn(),
  getRepoProjection: vi.fn(),
  getRepoRemoteBranches: vi.fn(),
}))

vi.mock('#/web/repo-client.ts', () => repoClientMocks)

beforeEach(() => {
  repoClientMocks.getRepoLog.mockReset()
  repoClientMocks.getRepoOperations.mockReset()
  repoClientMocks.getRepoProjection.mockReset()
  repoClientMocks.getRepoRemoteBranches.mockReset()
})

describe('repo projection query data', () => {
  test('writes server projection cache', () => {
    const queryClient = new QueryClient()
    const snapshot = { branches: [], current: 'main' }
    const pullRequests: PullRequestEntry[] = [
      {
        branch: 'feature/a',
        pullRequest: {
          number: 229,
          title: 'Converge repo data authority',
          url: 'https://github.com/acme/repo/pull/229',
          state: 'open',
        },
      },
    ]
    const projection: GitWorkspaceRuntimeProjection = {
      snapshot,
      pullRequests,
      requested: { branch: 'feature/a', pullRequestMode: 'full' },
      loadedAt: 123,
    }

    setRepoProjectionQueryData(WORKSPACE_ID, 'repo-runtime-1', 'feature/a', 'full', projection, queryClient)

    expect(getRepoProjectionQueryData(WORKSPACE_ID, 'repo-runtime-1', 'feature/a', 'full', queryClient)).toEqual(
      projection,
    )
    expect(getRepoOperationsQueryData(WORKSPACE_ID, 'repo-runtime-1', queryClient)).toBeUndefined()
  })

  test('seeds projection data', () => {
    const queryClient = new QueryClient()
    const projection: GitWorkspaceRuntimeProjection = {
      snapshot: { branches: [], current: 'main' },
      pullRequests: null,
      requested: { branch: 'feature/a', pullRequestMode: 'summary' },
      loadedAt: 123,
    }

    seedRepoProjectionQueryData(WORKSPACE_ID, 'repo-runtime-1', projection, queryClient)

    expect(getRepoProjectionQueryData(WORKSPACE_ID, 'repo-runtime-1', 'feature/a', 'summary', queryClient)).toEqual({
      ...projection,
    })
    expect(getRepoOperationsQueryData(WORKSPACE_ID, 'repo-runtime-1', queryClient)).toBeUndefined()
  })

  test('does not project retained operations data after the canonical query enters an error state', () => {
    const queryClient = new QueryClient()
    const queryKey = repoOperationsQueryKey(WORKSPACE_ID, 'repo-runtime-1')
    const operations = repoOperationsForTest(123)
    queryClient.setQueryData(queryKey, operations)

    expect(getRepoOperationsQueryData(WORKSPACE_ID, 'repo-runtime-1', queryClient)).toBe(operations)
    const query = queryClient.getQueryCache().find({ queryKey, exact: true })
    if (!query) throw new Error('Missing operations query')
    query.setState({ ...query.state, status: 'error', error: new Error('error.repository-boundary-unavailable') })

    expect(queryClient.getQueryData(queryKey)).toBe(operations)
    expect(getRepoOperationsQueryData(WORKSPACE_ID, 'repo-runtime-1', queryClient)).toBeUndefined()

    const replacement = repoOperationsForTest(456)
    queryClient.setQueryData(queryKey, replacement)
    expect(getRepoOperationsQueryData(WORKSPACE_ID, 'repo-runtime-1', queryClient)).toEqual(replacement)
  })

  test('keeps snapshot and operation invalidation domains independent', () => {
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const projectionKey = repoProjectionQueryKey(WORKSPACE_ID, 'repo-runtime-1', null, 'full')
    const statusKey = repoWorktreeStatusQueryKey(WORKSPACE_ID, 'repo-runtime-1')
    const operationsKey = repoOperationsQueryKey(WORKSPACE_ID, 'repo-runtime-1')
    const settledOperationsKey = repoOperationsQueryKey(WORKSPACE_ID, 'repo-runtime-1', true)
    const logKey = ['repo-data', WORKSPACE_ID, 'repo-runtime-1', 'log', 'feature/a', 50, 0] as const
    const remoteBranchesKey = ['repo-data', WORKSPACE_ID, 'repo-runtime-1', 'remote-branches'] as const
    queryClient.setQueryData(projectionKey, repoProjectionForTest(1))
    queryClient.setQueryData(statusKey, { workspaceRuntimeId: 'repo-runtime-1', status: [], loadedAt: 1 })
    queryClient.setQueryData(operationsKey, repoOperationsForTest(1))
    queryClient.setQueryData(settledOperationsKey, repoOperationsForTest(1))
    queryClient.setQueryData(logKey, [])
    queryClient.setQueryData(remoteBranchesKey, [])

    invalidateRepoSnapshotQueries(WORKSPACE_ID, 'repo-runtime-1', queryClient)

    expect(invalidateQueries).toHaveBeenCalledOnce()
    expect(queryClient.getQueryState(projectionKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(statusKey)?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(operationsKey)?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(settledOperationsKey)?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(logKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(remoteBranchesKey)?.isInvalidated).toBe(true)

    invalidateQueries.mockClear()
    invalidateRepoOperationsQueries(WORKSPACE_ID, 'repo-runtime-1', queryClient)

    expect(invalidateQueries).toHaveBeenCalledOnce()
    expect(invalidateQueries).toHaveBeenCalledWith(
      {
        queryKey: ['repo-data', WORKSPACE_ID, 'repo-runtime-1', 'operations'],
        refetchType: 'active',
      },
      { cancelRefetch: false },
    )
    expect(queryClient.getQueryState(operationsKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(settledOperationsKey)?.isInvalidated).toBe(true)
    invalidateQueries.mockRestore()
  })

  test('limits worktree snapshot invalidation to status', () => {
    const queryClient = new QueryClient()
    const projectionKey = repoProjectionQueryKey(WORKSPACE_ID, 'repo-runtime-1', null, 'full')
    const statusKey = repoWorktreeStatusQueryKey(WORKSPACE_ID, 'repo-runtime-1')
    const operationsKey = repoOperationsQueryKey(WORKSPACE_ID, 'repo-runtime-1')
    const logKey = ['repo-data', WORKSPACE_ID, 'repo-runtime-1', 'log', 'feature/a', 50, 0] as const
    const remoteBranchesKey = ['repo-data', WORKSPACE_ID, 'repo-runtime-1', 'remote-branches'] as const
    for (const queryKey of [projectionKey, statusKey, operationsKey, logKey, remoteBranchesKey]) {
      queryClient.setQueryData(queryKey, {})
    }

    invalidateRepoWorktreeStatusQueries(WORKSPACE_ID, 'repo-runtime-1', queryClient)

    expect(queryClient.getQueryState(projectionKey)?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(statusKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(operationsKey)?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(logKey)?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(remoteBranchesKey)?.isInvalidated).toBe(false)
  })

  test('coalesces snapshot projection invalidations without aborting in-flight refetches', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const signals: AbortSignal[] = []
    const releases: Array<(projection: GitWorkspaceRuntimeProjection) => void> = []
    setRepoProjectionQueryData(
      WORKSPACE_ID,
      'repo-runtime-1',
      'feature/a',
      'full',
      repoProjectionForTest(0),
      queryClient,
    )
    repoClientMocks.getRepoProjection.mockImplementation(
      (
        _repoRoot: string,
        _repoRuntimeId: string,
        _branch: string | null | undefined,
        _options: unknown,
        signal?: AbortSignal,
      ) =>
        new Promise<GitWorkspaceRuntimeProjection>((resolve) => {
          if (!signal) throw new Error('missing projection abort signal')
          signals.push(signal)
          releases.push(resolve)
        }),
    )
    const observer = new QueryObserver(
      queryClient,
      repoProjectionQueryOptions(WORKSPACE_ID, 'repo-runtime-1', 'feature/a', 'full'),
    )
    const unsubscribe = observer.subscribe(() => {})
    try {
      invalidateRepoSnapshotQueries(WORKSPACE_ID, 'repo-runtime-1', queryClient)
      await vi.waitFor(() => {
        expect(releases).toHaveLength(1)
      })

      invalidateRepoSnapshotQueries(WORKSPACE_ID, 'repo-runtime-1', queryClient)
      expect(signals[0]?.aborted).toBe(false)
      expect(releases).toHaveLength(1)

      releases[0]!(repoProjectionForTest(1))
      await vi.waitFor(() => {
        expect(releases).toHaveLength(2)
      })
      expect(signals[0]?.aborted).toBe(false)
      expect(signals[1]?.aborted).toBe(false)

      releases[1]!(repoProjectionForTest(2))
      await vi.waitFor(() => {
        expect((observer.getCurrentResult().data as GitWorkspaceRuntimeProjection | undefined)?.loadedAt).toBe(2)
      })
    } finally {
      unsubscribe()
      queryClient.clear()
    }
  })

  test('reruns snapshot projection invalidation after a pre-existing active fetch settles', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const signals: AbortSignal[] = []
    const releases: Array<(projection: GitWorkspaceRuntimeProjection) => void> = []
    repoClientMocks.getRepoProjection.mockImplementation(
      (
        _repoRoot: string,
        _repoRuntimeId: string,
        _branch: string | null | undefined,
        _options: unknown,
        signal?: AbortSignal,
      ) =>
        new Promise<GitWorkspaceRuntimeProjection>((resolve) => {
          if (!signal) throw new Error('missing projection abort signal')
          signals.push(signal)
          releases.push(resolve)
        }),
    )
    const observer = new QueryObserver(
      queryClient,
      repoProjectionQueryOptions(WORKSPACE_ID, 'repo-runtime-1', 'feature/a', 'full'),
    )
    const unsubscribe = observer.subscribe(() => {})
    try {
      await vi.waitFor(() => {
        expect(releases).toHaveLength(1)
      })

      invalidateRepoSnapshotQueries(WORKSPACE_ID, 'repo-runtime-1', queryClient)
      expect(releases).toHaveLength(1)

      releases[0]!(repoProjectionForTest(1))
      await vi.waitFor(() => {
        expect(releases).toHaveLength(2)
      })
      expect(signals[0]?.aborted).toBe(false)

      releases[1]!(repoProjectionForTest(2))
      await vi.waitFor(() => {
        expect((observer.getCurrentResult().data as GitWorkspaceRuntimeProjection | undefined)?.loadedAt).toBe(2)
      })
    } finally {
      unsubscribe()
      queryClient.clear()
    }
  })

  test('keeps snapshot projection invalidated when observer unmounts before queued rerun', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const releases: Array<(projection: GitWorkspaceRuntimeProjection) => void> = []
    const queryKey = repoProjectionQueryKey(WORKSPACE_ID, 'repo-runtime-1', 'feature/a', 'full')
    const observer = new QueryObserver<GitWorkspaceRuntimeProjection>(queryClient, {
      queryKey,
      queryFn: () =>
        new Promise<GitWorkspaceRuntimeProjection>((resolve) => {
          releases.push(resolve)
        }),
      staleTime: Number.POSITIVE_INFINITY,
    })
    const unsubscribe = observer.subscribe(() => {})
    try {
      await vi.waitFor(() => {
        expect(releases).toHaveLength(1)
      })

      invalidateRepoSnapshotQueries(WORKSPACE_ID, 'repo-runtime-1', queryClient)
      unsubscribe()
      releases[0]!(repoProjectionForTest(1))

      await vi.waitFor(() => {
        expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true)
      })
      expect(releases).toHaveLength(1)
    } finally {
      queryClient.clear()
    }
  })

  test('does not clear operations invalidation from a stale operations query success', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const releases: Array<(snapshot: RepoOperationsSnapshot) => void> = []
    repoClientMocks.getRepoOperations.mockImplementation(
      () =>
        new Promise<RepoOperationsSnapshot>((resolve) => {
          releases.push(resolve)
        }),
    )
    function OperationsHarness() {
      useRepoOperationsReadModel(WORKSPACE_ID, 'repo-runtime-1')
      return null
    }
    const result = renderInJsdom(
      createElement(QueryClientProvider, { client: queryClient }, createElement(OperationsHarness)),
    )
    try {
      await vi.waitFor(() => {
        expect(releases).toHaveLength(1)
      })

      invalidateRepoOperationsQueries(WORKSPACE_ID, 'repo-runtime-1', queryClient)
      invalidateRepoOperationsQueries(WORKSPACE_ID, 'repo-runtime-1', queryClient)
      invalidateRepoOperationsQueries(WORKSPACE_ID, 'repo-runtime-1', queryClient)
      expect(releases).toHaveLength(1)
      releases[0]!(repoOperationsForTest(1))

      await vi.waitFor(() => {
        expect(releases).toHaveLength(2)
      })
      await vi.waitFor(() => {
        expect(queryClient.getQueryState(repoOperationsQueryKey(WORKSPACE_ID, 'repo-runtime-1'))?.isInvalidated).toBe(
          true,
        )
      })
      expect(releases).toHaveLength(2)
    } finally {
      result.unmount()
      queryClient.clear()
    }
  })

  test('does not stale an in-flight projection when independent domains change', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const releases: Array<(projection: GitWorkspaceRuntimeProjection) => void> = []
    repoClientMocks.getRepoProjection.mockImplementation(
      () =>
        new Promise<GitWorkspaceRuntimeProjection>((resolve) => {
          releases.push(resolve)
        }),
    )
    const observer = new QueryObserver(
      queryClient,
      repoProjectionQueryOptions(WORKSPACE_ID, 'repo-runtime-1', 'feature/a', 'full'),
    )
    const unsubscribe = observer.subscribe(() => {})
    try {
      await vi.waitFor(() => expect(releases).toHaveLength(1))
      invalidateRepoOperationsQueries(WORKSPACE_ID, 'repo-runtime-1', queryClient)
      invalidateRepoWorktreeStatusQueries(WORKSPACE_ID, 'repo-runtime-1', queryClient)
      releases[0]!(repoProjectionForTest(1))
      await vi.waitFor(() => expect(observer.getCurrentResult().data?.loadedAt).toBe(1))
      expect(releases).toHaveLength(1)
    } finally {
      unsubscribe()
      queryClient.clear()
    }
  })

  test('does not stale an in-flight operations read when the repo snapshot changes', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const releases: Array<(snapshot: RepoOperationsSnapshot) => void> = []
    repoClientMocks.getRepoOperations.mockImplementation(
      () =>
        new Promise<RepoOperationsSnapshot>((resolve) => {
          releases.push(resolve)
        }),
    )
    function OperationsHarness() {
      useRepoOperationsReadModel(WORKSPACE_ID, 'repo-runtime-1')
      return null
    }
    const result = renderInJsdom(
      createElement(QueryClientProvider, { client: queryClient }, createElement(OperationsHarness)),
    )
    try {
      await vi.waitFor(() => expect(releases).toHaveLength(1))
      invalidateRepoSnapshotQueries(WORKSPACE_ID, 'repo-runtime-1', queryClient)
      releases[0]!(repoOperationsForTest(1))
      await vi.waitFor(() =>
        expect(getRepoOperationsQueryData(WORKSPACE_ID, 'repo-runtime-1', queryClient)?.loadedAt).toBe(1),
      )
      expect(releases).toHaveLength(1)
    } finally {
      result.unmount()
      queryClient.clear()
    }
  })

  test('reruns an in-flight log read after a full snapshot invalidation', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const releases: Array<(entries: []) => void> = []
    repoClientMocks.getRepoLog.mockImplementation(
      () =>
        new Promise<[]>((resolve) => {
          releases.push(resolve)
        }),
    )
    function LogHarness() {
      useRepoLogQuery(WORKSPACE_ID, 'repo-runtime-1', 'main')
      return null
    }
    const result = renderInJsdom(createElement(QueryClientProvider, { client: queryClient }, createElement(LogHarness)))
    try {
      await vi.waitFor(() => expect(releases).toHaveLength(1))
      invalidateRepoSnapshotQueries(WORKSPACE_ID, 'repo-runtime-1', queryClient)
      releases[0]!([])
      await vi.waitFor(() => expect(releases).toHaveLength(2))
      releases[1]!([])
      await vi.waitFor(() => expect(repoClientMocks.getRepoLog).toHaveBeenCalledTimes(2))
    } finally {
      result.unmount()
      queryClient.clear()
    }
  })

  test('reruns an in-flight remote branch read after a full snapshot invalidation', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const releases: Array<(branches: string[]) => void> = []
    repoClientMocks.getRepoRemoteBranches.mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          releases.push(resolve)
        }),
    )
    function RemoteBranchesHarness() {
      useRepoRemoteBranchesQuery(WORKSPACE_ID, 'repo-runtime-1')
      return null
    }
    const result = renderInJsdom(
      createElement(QueryClientProvider, { client: queryClient }, createElement(RemoteBranchesHarness)),
    )
    try {
      await vi.waitFor(() => expect(releases).toHaveLength(1))
      invalidateRepoSnapshotQueries(WORKSPACE_ID, 'repo-runtime-1', queryClient)
      releases[0]!([])
      await vi.waitFor(() => expect(releases).toHaveLength(2))
      releases[1]!([])
      await vi.waitFor(() => expect(repoClientMocks.getRepoRemoteBranches).toHaveBeenCalledTimes(2))
    } finally {
      result.unmount()
      queryClient.clear()
    }
  })

  test('imperative projection refresh does not spawn and cancel a matching active observer refetch', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const signals: AbortSignal[] = []
    const releases: Array<(projection: GitWorkspaceRuntimeProjection) => void> = []
    const queryKey = repoProjectionQueryKey(WORKSPACE_ID, 'repo-runtime-1', 'feature/a', 'full')
    const operationsKey = repoOperationsQueryKey(WORKSPACE_ID, 'repo-runtime-1')
    const statusKey = repoWorktreeStatusQueryKey(WORKSPACE_ID, 'repo-runtime-1')
    const logKey = ['repo-data', WORKSPACE_ID, 'repo-runtime-1', 'log', 'main', 50, 0] as const
    const remoteBranchesKey = ['repo-data', WORKSPACE_ID, 'repo-runtime-1', 'remote-branches'] as const
    setRepoProjectionQueryData(
      WORKSPACE_ID,
      'repo-runtime-1',
      'feature/a',
      'full',
      repoProjectionForTest(0),
      queryClient,
    )
    queryClient.setQueryData(operationsKey, repoOperationsForTest(0))
    queryClient.setQueryData(statusKey, { workspaceRuntimeId: 'repo-runtime-1', status: [], loadedAt: 0 })
    queryClient.setQueryData(logKey, [])
    queryClient.setQueryData(remoteBranchesKey, [])
    repoClientMocks.getRepoProjection.mockImplementation(
      (
        _repoRoot: string,
        _repoRuntimeId: string,
        _branch: string | null | undefined,
        _options: unknown,
        signal?: AbortSignal,
      ) =>
        new Promise<GitWorkspaceRuntimeProjection>((resolve, reject) => {
          if (!signal) throw new Error('missing projection abort signal')
          signals.push(signal)
          const abort = () => reject(new Error('cancelled'))
          signal.addEventListener('abort', abort, { once: true })
          releases.push((projection) => {
            signal.removeEventListener('abort', abort)
            resolve(projection)
          })
        }),
    )
    const observer = new QueryObserver(
      queryClient,
      repoProjectionQueryOptions(WORKSPACE_ID, 'repo-runtime-1', 'feature/a', 'full'),
    )
    const unsubscribe = observer.subscribe(() => {})
    try {
      expect(queryClient.getQueryData(queryKey)).toMatchObject({ loadedAt: 0 })
      expect(repoClientMocks.getRepoProjection).not.toHaveBeenCalled()

      const refresh = refreshRepoProjectionReadModel(WORKSPACE_ID, 'repo-runtime-1', 'feature/a', 'full', {
        queryClient,
      })
      await vi.waitFor(() => {
        expect(signals).toHaveLength(1)
      })

      expect(queryClient.getQueryState(operationsKey)?.isInvalidated).toBe(false)
      expect(queryClient.getQueryState(statusKey)?.isInvalidated).toBe(false)
      expect(queryClient.getQueryState(logKey)?.isInvalidated).toBe(false)
      expect(queryClient.getQueryState(remoteBranchesKey)?.isInvalidated).toBe(false)
      expect(signals[0]?.aborted).toBe(false)
      releases[0]?.(repoProjectionForTest(2))
      await expect(refresh).resolves.toMatchObject({ loadedAt: 2 })
      expect(signals).toHaveLength(1)
      expect(signals[0]?.aborted).toBe(false)
    } finally {
      unsubscribe()
      queryClient.clear()
    }
  })

  test('imperative projection refresh does not stale or retry an in-flight log read', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const logRead = Promise.withResolvers<Awaited<ReturnType<typeof repoClientMocks.getRepoLog>>>()
    repoClientMocks.getRepoLog.mockReturnValue(logRead.promise)
    repoClientMocks.getRepoProjection.mockResolvedValue(repoProjectionForTest(1))
    function LogHarness() {
      useRepoLogQuery(WORKSPACE_ID, 'repo-runtime-1', 'main')
      return null
    }
    const result = renderInJsdom(createElement(QueryClientProvider, { client: queryClient }, createElement(LogHarness)))
    try {
      await vi.waitFor(() => expect(repoClientMocks.getRepoLog).toHaveBeenCalledOnce())

      await refreshRepoProjectionReadModel(WORKSPACE_ID, 'repo-runtime-1', null, 'full', { queryClient })
      logRead.resolve([])
      await vi.waitFor(() => expect(repoClientMocks.getRepoLog).toHaveBeenCalledOnce())
    } finally {
      result.unmount()
      queryClient.clear()
    }
  })

  test('imperative projection refresh forwards caller abort to a cold projection fetch', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const signals: AbortSignal[] = []
    repoClientMocks.getRepoProjection.mockImplementation(
      (
        _repoRoot: string,
        _repoRuntimeId: string,
        _branch: string | null | undefined,
        _options: unknown,
        signal?: AbortSignal,
      ) =>
        new Promise<GitWorkspaceRuntimeProjection>((_resolve, reject) => {
          if (!signal) throw new Error('missing projection abort signal')
          signals.push(signal)
          signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), { once: true })
        }),
    )
    const controller = new AbortController()

    try {
      const refresh = refreshRepoProjectionReadModel(WORKSPACE_ID, 'repo-runtime-1', 'feature/a', 'full', {
        queryClient,
        signal: controller.signal,
      })
      await vi.waitFor(() => {
        expect(signals).toHaveLength(1)
      })

      controller.abort(new Error('stopped'))

      expect(signals[0]?.aborted).toBe(true)
      await expect(refresh).rejects.toThrow('stopped')
    } finally {
      queryClient.clear()
    }
  })

  test('imperative projection refresh reuses a pre-existing active matching projection query', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const signals: AbortSignal[] = []
    const releases: Array<(projection: GitWorkspaceRuntimeProjection) => void> = []
    repoClientMocks.getRepoProjection.mockImplementation(
      (
        _repoRoot: string,
        _repoRuntimeId: string,
        _branch: string | null | undefined,
        _options: unknown,
        signal?: AbortSignal,
      ) =>
        new Promise<GitWorkspaceRuntimeProjection>((resolve, reject) => {
          if (!signal) throw new Error('missing projection abort signal')
          signals.push(signal)
          const abort = () => reject(new Error('cancelled'))
          signal.addEventListener('abort', abort, { once: true })
          releases.push((projection) => {
            signal.removeEventListener('abort', abort)
            resolve(projection)
          })
        }),
    )
    const active = queryClient
      .fetchQuery(repoProjectionQueryOptions(WORKSPACE_ID, 'repo-runtime-1', 'feature/a', 'full'))
      .catch(() => null)

    try {
      await vi.waitFor(() => {
        expect(signals).toHaveLength(1)
      })

      const refresh = refreshRepoProjectionReadModel(WORKSPACE_ID, 'repo-runtime-1', 'feature/a', 'full', {
        queryClient,
      })

      expect(signals).toHaveLength(1)
      expect(signals[0]?.aborted).toBe(false)
      releases[0]?.(repoProjectionForTest(1))
      await vi.waitFor(() => {
        expect(signals).toHaveLength(2)
      })
      expect(signals[0]?.aborted).toBe(false)
      expect(signals[1]?.aborted).toBe(false)
      releases[1]?.(repoProjectionForTest(2))
      await expect(refresh).resolves.toMatchObject({ loadedAt: 2 })
      await active
    } finally {
      queryClient.clear()
    }
  })

  test('imperative projection refresh reruns after invalidation during an inactive fetch', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const releases: Array<(projection: GitWorkspaceRuntimeProjection) => void> = []
    repoClientMocks.getRepoProjection.mockImplementation(
      () =>
        new Promise<GitWorkspaceRuntimeProjection>((resolve) => {
          releases.push(resolve)
        }),
    )

    try {
      const refresh = refreshRepoProjectionReadModel(WORKSPACE_ID, 'repo-runtime-1', 'feature/a', 'full', {
        queryClient,
      })
      await vi.waitFor(() => {
        expect(releases).toHaveLength(1)
      })

      invalidateRepoSnapshotQueries(WORKSPACE_ID, 'repo-runtime-1', queryClient)
      releases[0]!(repoProjectionForTest(1))
      await vi.waitFor(() => {
        expect(releases).toHaveLength(2)
      })

      releases[1]!(repoProjectionForTest(2))
      await expect(refresh).resolves.toMatchObject({ loadedAt: 2 })
      expect(repoClientMocks.getRepoProjection).toHaveBeenCalledTimes(2)
    } finally {
      queryClient.clear()
    }
  })

  test('imperative projection refresh reruns after invalidation of an already invalidated cached query', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const releases: Array<(projection: GitWorkspaceRuntimeProjection) => void> = []
    setRepoProjectionQueryData(
      WORKSPACE_ID,
      'repo-runtime-1',
      'feature/a',
      'full',
      repoProjectionForTest(0),
      queryClient,
    )
    repoClientMocks.getRepoProjection.mockImplementation(
      () =>
        new Promise<GitWorkspaceRuntimeProjection>((resolve) => {
          releases.push(resolve)
        }),
    )

    try {
      const refresh = refreshRepoProjectionReadModel(WORKSPACE_ID, 'repo-runtime-1', 'feature/a', 'full', {
        queryClient,
      })
      await vi.waitFor(() => {
        expect(releases).toHaveLength(1)
      })
      expect(
        queryClient.getQueryState(repoProjectionQueryKey(WORKSPACE_ID, 'repo-runtime-1', 'feature/a', 'full'))
          ?.isInvalidated,
      ).toBe(true)

      invalidateRepoSnapshotQueries(WORKSPACE_ID, 'repo-runtime-1', queryClient)
      releases[0]!(repoProjectionForTest(1))
      await vi.waitFor(() => {
        expect(releases).toHaveLength(2)
      })

      releases[1]!(repoProjectionForTest(2))
      await expect(refresh).resolves.toMatchObject({ loadedAt: 2 })
      expect(getRepoOperationsQueryData(WORKSPACE_ID, 'repo-runtime-1', queryClient)).toBeUndefined()
    } finally {
      queryClient.clear()
    }
  })

  test('imperative projection refresh invalidates and reruns other active runtime projections', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const releases: Array<{
      branch: string | null
      mode: 'summary' | 'full'
      resolved: boolean
      resolve: (projection: GitWorkspaceRuntimeProjection) => void
    }> = []
    const resolveNextProjection = (branch: string | null, mode: 'summary' | 'full', loadedAt: number) => {
      const release = releases.find((candidate) => {
        return !candidate.resolved && candidate.branch === branch && candidate.mode === mode
      })
      expect(release).toBeDefined()
      release!.resolved = true
      release!.resolve(repoProjectionForTest(loadedAt, branch, mode))
    }
    repoClientMocks.getRepoProjection.mockImplementation(
      (
        _repoRoot: string,
        _repoRuntimeId: string,
        branch: string | null | undefined,
        options?: { mode?: 'summary' | 'full' },
      ) =>
        new Promise<GitWorkspaceRuntimeProjection>((resolve) => {
          releases.push({ branch: branch ?? null, mode: options?.mode ?? 'full', resolved: false, resolve })
        }),
    )
    const observer = new QueryObserver(
      queryClient,
      repoProjectionQueryOptions(WORKSPACE_ID, 'repo-runtime-1', null, 'summary'),
    )
    const unsubscribe = observer.subscribe(() => {})
    try {
      await vi.waitFor(() => {
        expect(releases).toHaveLength(1)
      })

      const refresh = refreshRepoProjectionReadModel(WORKSPACE_ID, 'repo-runtime-1', 'feature/a', 'full', {
        queryClient,
      })
      await vi.waitFor(() => {
        expect(releases.some((release) => release.branch === 'feature/a' && release.mode === 'full')).toBe(true)
      })

      resolveNextProjection(null, 'summary', 1)
      await vi.waitFor(() => {
        expect(releases.filter((release) => release.branch === null && release.mode === 'summary')).toHaveLength(2)
      })
      expect(observer.getCurrentResult().data).toBeUndefined()

      resolveNextProjection('feature/a', 'full', 2)
      await expect(refresh).resolves.toMatchObject({ loadedAt: 2 })

      resolveNextProjection(null, 'summary', 3)
      await vi.waitFor(() => {
        expect(observer.getCurrentResult().data?.loadedAt).toBe(3)
      })
    } finally {
      unsubscribe()
      queryClient.clear()
    }
  })
})
