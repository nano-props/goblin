import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  getRepoOperationsQueryData,
  getRepoProjectionPlaceholderData,
  getRepoProjectionQueryData,
  invalidateRepoRuntimeProjectionQueries,
  repoOperationsQueryKey,
  repoProjectionQueryOptions,
  repoProjectionQueryKey,
  refreshRepoProjectionReadModel,
  seedRepoProjectionQueryData,
  setRepoOperationsQueryData,
  setRepoProjectionQueryData,
} from '#/web/repo-data-query.ts'
import type { PullRequestEntry, RepoRuntimeProjection } from '#/shared/api-types.ts'
import type { WorktreeStatus } from '#/shared/git-types.ts'

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

describe('repo data query keys', () => {
  test('separates projection branch and fetch mode', () => {
    expect(repoProjectionQueryKey('/tmp/repo', 'repo-runtime-1', 'feature/a', 'summary')).not.toEqual(
      repoProjectionQueryKey('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full'),
    )
    expect(repoProjectionQueryKey('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full')).not.toEqual(
      repoProjectionQueryKey('/tmp/repo', 'repo-runtime-1', 'feature/b', 'full'),
    )
  })

  test('separates operation snapshots by settled inclusion', () => {
    expect(repoOperationsQueryKey('/tmp/repo', 'repo-runtime-1', false)).not.toEqual(
      repoOperationsQueryKey('/tmp/repo', 'repo-runtime-1', true),
    )
  })
})

describe('repo projection query data', () => {
  test('builds projection placeholder data from cached runtime projection', () => {
    const queryClient = new QueryClient()
    const status: WorktreeStatus[] = [{ path: '/tmp/repo', branch: 'main', isMain: true, entries: [] }]
    const cachedProjection: RepoRuntimeProjection = {
      snapshot: { branches: [], current: 'main' },
      status,
      pullRequests: [
        {
          branch: 'feature/a',
          pullRequest: {
            number: 229,
            title: 'Converge repo data authority',
            url: 'https://github.com/acme/repo/pull/229',
            state: 'open',
          },
        },
      ],
      operations: { operations: [], loadedAt: 123 },
      requested: { branch: null, pullRequestMode: 'full' },
      loadedAt: 123,
    }

    seedRepoProjectionQueryData('/tmp/repo', 'repo-runtime-1', cachedProjection, queryClient)

    expect(getRepoProjectionPlaceholderData('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full', queryClient)).toEqual({
      snapshot: cachedProjection.snapshot,
      status,
      pullRequests: null,
      operations: { operations: [], loadedAt: 123 },
      requested: { branch: 'feature/a', pullRequestMode: 'full' },
      loadedAt: 0,
    })
  })

  test('prefers the null-branch runtime projection as branch workspace placeholder', () => {
    const queryClient = new QueryClient()
    const branchProjection: RepoRuntimeProjection = {
      snapshot: { branches: [], current: 'feature/other' },
      status: [],
      pullRequests: null,
      operations: { operations: [], loadedAt: 101 },
      requested: { branch: 'feature/other', pullRequestMode: 'summary' },
      loadedAt: 101,
    }
    const repoProjection: RepoRuntimeProjection = {
      snapshot: { branches: [], current: 'main' },
      status: [{ path: '/tmp/repo', branch: 'main', isMain: true, entries: [] }],
      pullRequests: null,
      operations: { operations: [], loadedAt: 202 },
      requested: { branch: null, pullRequestMode: 'full' },
      loadedAt: 202,
    }

    seedRepoProjectionQueryData('/tmp/repo', 'repo-runtime-1', branchProjection, queryClient)
    seedRepoProjectionQueryData('/tmp/repo', 'repo-runtime-1', repoProjection, queryClient)

    expect(
      getRepoProjectionPlaceholderData('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full', queryClient),
    ).toMatchObject({
      snapshot: repoProjection.snapshot,
      status: repoProjection.status,
      requested: { branch: 'feature/a', pullRequestMode: 'full' },
      loadedAt: 0,
    })
  })

  test('writes server projection and active operations cache', () => {
    const queryClient = new QueryClient()
    const snapshot = { branches: [], current: 'main' }
    const status: WorktreeStatus[] = [{ path: '/tmp/repo', branch: 'main', isMain: true, entries: [] }]
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
    const projection: RepoRuntimeProjection = {
      snapshot,
      status,
      pullRequests,
      operations: { operations: [], loadedAt: 123 },
      requested: { branch: 'feature/a', pullRequestMode: 'full' },
      loadedAt: 123,
    }

    setRepoProjectionQueryData('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full', projection, queryClient)

    expect(getRepoProjectionQueryData('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full', queryClient)).toEqual(
      projection,
    )
    expect(getRepoOperationsQueryData('/tmp/repo', 'repo-runtime-1', queryClient)).toEqual({
      operations: [],
      loadedAt: 123,
    })
  })

  test('seeds projection data without writing active operations cache', () => {
    const queryClient = new QueryClient()
    const projection: RepoRuntimeProjection = {
      snapshot: { branches: [], current: 'main' },
      status: [{ path: '/tmp/repo', branch: 'main', isMain: true, entries: [] }],
      pullRequests: null,
      operations: { operations: [], loadedAt: 123 },
      requested: { branch: 'feature/a', pullRequestMode: 'summary' },
      loadedAt: 123,
    }

    seedRepoProjectionQueryData('/tmp/repo', 'repo-runtime-1', projection, queryClient)

    expect(getRepoProjectionQueryData('/tmp/repo', 'repo-runtime-1', 'feature/a', 'summary', queryClient)).toEqual({
      ...projection,
    })
    expect(getRepoOperationsQueryData('/tmp/repo', 'repo-runtime-1', queryClient)).toBeUndefined()
  })

  test('projects active operation snapshots into projection caches', () => {
    const queryClient = new QueryClient()
    const projection: RepoRuntimeProjection = {
      snapshot: { branches: [], current: 'main' },
      status: [],
      pullRequests: null,
      operations: { operations: [], loadedAt: 123 },
      requested: { branch: 'feature/a', pullRequestMode: 'full' },
      loadedAt: 123,
    }
    const operations = {
      operations: [
        {
          id: 'repo-op-1',
          repoId: '/tmp/repo',
          repoRuntimeId: null,
          kind: 'fetch' as const,
          phase: 'running' as const,
          source: 'background' as const,
          target: null,
          queuedAt: 100,
          startedAt: 101,
          deadlineAt: null,
          settledAt: null,
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
        },
      ],
      loadedAt: 456,
    }

    setRepoProjectionQueryData('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full', projection, queryClient)
    setRepoOperationsQueryData('/tmp/repo', 'repo-runtime-1', false, operations, queryClient)

    expect(getRepoOperationsQueryData('/tmp/repo', 'repo-runtime-1', queryClient)).toEqual(operations)
    expect(getRepoProjectionQueryData('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full', queryClient)).toEqual({
      ...projection,
      operations,
    })
  })

  test('invalidates runtime projection queries once per server-owned lifecycle signal', () => {
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const refetchQueries = vi.spyOn(queryClient, 'refetchQueries')

    invalidateRepoRuntimeProjectionQueries('/tmp/repo', 'repo-runtime-1', queryClient)

    expect(invalidateQueries).toHaveBeenCalledTimes(2)
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ['repo-data', '/tmp/repo', 'repo-runtime-1', 'projection'],
      refetchType: 'none',
    })
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ['repo-data', '/tmp/repo', 'repo-runtime-1', 'operations'],
      refetchType: 'none',
    })
    expect(refetchQueries).toHaveBeenCalledTimes(2)
    expect(refetchQueries).toHaveBeenNthCalledWith(
      1,
      { queryKey: ['repo-data', '/tmp/repo', 'repo-runtime-1', 'projection'], type: 'active' },
      { cancelRefetch: false },
    )
    expect(refetchQueries).toHaveBeenNthCalledWith(
      2,
      { queryKey: ['repo-data', '/tmp/repo', 'repo-runtime-1', 'operations'], type: 'active' },
      { cancelRefetch: false },
    )
    refetchQueries.mockRestore()
    invalidateQueries.mockRestore()
  })

  test('coalesces runtime projection invalidations without aborting in-flight refetches', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const signals: AbortSignal[] = []
    const releases: Array<(projection: RepoRuntimeProjection) => void> = []
    const observer = new QueryObserver<RepoRuntimeProjection>(queryClient, {
      queryKey: repoProjectionQueryKey('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full'),
      queryFn: ({ signal }) =>
        new Promise<RepoRuntimeProjection>((resolve) => {
          signals.push(signal)
          releases.push(resolve)
        }),
      initialData: repoProjectionForTest(0),
      staleTime: Number.POSITIVE_INFINITY,
    })
    const unsubscribe = observer.subscribe(() => {})
    try {
      invalidateRepoRuntimeProjectionQueries('/tmp/repo', 'repo-runtime-1', queryClient)
      await vi.waitFor(() => {
        expect(releases).toHaveLength(1)
      })

      invalidateRepoRuntimeProjectionQueries('/tmp/repo', 'repo-runtime-1', queryClient)
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
        expect(observer.getCurrentResult().data?.loadedAt).toBe(2)
      })
    } finally {
      unsubscribe()
      queryClient.clear()
    }
  })

  test('imperative projection refresh cancels an active matching projection query before reading', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const signals: AbortSignal[] = []
    const releases: Array<(projection: RepoRuntimeProjection) => void> = []
    repoClientMocks.getRepoProjection.mockImplementation(
      (_repoRoot: string, _branch: string | null | undefined, _options: unknown, signal?: AbortSignal) =>
        new Promise<RepoRuntimeProjection>((resolve, reject) => {
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
      .fetchQuery(repoProjectionQueryOptions('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full'))
      .catch(() => null)

    try {
      await vi.waitFor(() => {
        expect(signals).toHaveLength(1)
      })

      const refresh = refreshRepoProjectionReadModel('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full', { queryClient })
      await vi.waitFor(() => {
        expect(signals).toHaveLength(2)
      })

      expect(signals[0]?.aborted).toBe(true)
      releases[1]?.(repoProjectionForTest(2))
      await expect(refresh).resolves.toMatchObject({ loadedAt: 2 })
      await active
    } finally {
      queryClient.clear()
    }
  })
})

function repoProjectionForTest(loadedAt: number): RepoRuntimeProjection {
  return {
    snapshot: { branches: [], current: 'main' },
    status: [],
    pullRequests: null,
    operations: { operations: [], loadedAt },
    requested: { branch: 'feature/a', pullRequestMode: 'full' },
    loadedAt,
  }
}
