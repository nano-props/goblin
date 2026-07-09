import { createElement } from 'react'
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
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
  useRepoOperationsReadModel,
} from '#/web/repo-data-query.ts'
import type { PullRequestEntry, RepoOperationsSnapshot, RepoRuntimeProjection } from '#/shared/api-types.ts'
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

  test('does not clear projection invalidation when patching operations snapshots', async () => {
    const queryClient = new QueryClient()
    const projection = repoProjectionForTest(1)
    const projectionKey = repoProjectionQueryKey('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full')
    const operations = { operations: [], loadedAt: 2 }

    setRepoProjectionQueryData('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full', projection, queryClient)
    await queryClient.invalidateQueries({ queryKey: projectionKey, exact: true, refetchType: 'none' })

    expect(queryClient.getQueryState(projectionKey)?.isInvalidated).toBe(true)
    setRepoOperationsQueryData('/tmp/repo', 'repo-runtime-1', false, operations, queryClient)

    expect(queryClient.getQueryState(projectionKey)?.isInvalidated).toBe(true)
    expect(getRepoProjectionQueryData('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full', queryClient)).toEqual(
      projection,
    )
  })

  test('marks runtime projection queries invalidated once per server-owned lifecycle signal', () => {
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
    expect(refetchQueries).not.toHaveBeenCalled()
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

  test('reruns runtime projection invalidation after a pre-existing active fetch settles', async () => {
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
      staleTime: Number.POSITIVE_INFINITY,
    })
    const unsubscribe = observer.subscribe(() => {})
    try {
      await vi.waitFor(() => {
        expect(releases).toHaveLength(1)
      })

      invalidateRepoRuntimeProjectionQueries('/tmp/repo', 'repo-runtime-1', queryClient)
      expect(releases).toHaveLength(1)

      releases[0]!(repoProjectionForTest(1))
      await vi.waitFor(() => {
        expect(releases).toHaveLength(2)
      })
      expect(signals[0]?.aborted).toBe(false)

      releases[1]!(repoProjectionForTest(2))
      await vi.waitFor(() => {
        expect(observer.getCurrentResult().data?.loadedAt).toBe(2)
      })
    } finally {
      unsubscribe()
      queryClient.clear()
    }
  })

  test('keeps runtime projection invalidated when observer unmounts before queued rerun', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const releases: Array<(projection: RepoRuntimeProjection) => void> = []
    const queryKey = repoProjectionQueryKey('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full')
    const observer = new QueryObserver<RepoRuntimeProjection>(queryClient, {
      queryKey,
      queryFn: () =>
        new Promise<RepoRuntimeProjection>((resolve) => {
          releases.push(resolve)
        }),
      staleTime: Number.POSITIVE_INFINITY,
    })
    const unsubscribe = observer.subscribe(() => {})
    try {
      await vi.waitFor(() => {
        expect(releases).toHaveLength(1)
      })

      invalidateRepoRuntimeProjectionQueries('/tmp/repo', 'repo-runtime-1', queryClient)
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
      useRepoOperationsReadModel('/tmp/repo', 'repo-runtime-1')
      return null
    }
    const result = renderInJsdom(
      createElement(QueryClientProvider, { client: queryClient }, createElement(OperationsHarness)),
    )
    try {
      await vi.waitFor(() => {
        expect(releases).toHaveLength(1)
      })

      invalidateRepoRuntimeProjectionQueries('/tmp/repo', 'repo-runtime-1', queryClient)
      releases[0]!(repoOperationsForTest(1))

      await vi.waitFor(() => {
        expect(releases).toHaveLength(2)
      })
      await vi.waitFor(() => {
        expect(queryClient.getQueryState(repoOperationsQueryKey('/tmp/repo', 'repo-runtime-1'))?.isInvalidated).toBe(
          true,
        )
      })
    } finally {
      result.unmount()
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

  test('imperative projection refresh reruns after invalidation during an inactive fetch', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const releases: Array<(projection: RepoRuntimeProjection) => void> = []
    repoClientMocks.getRepoProjection.mockImplementation(
      () =>
        new Promise<RepoRuntimeProjection>((resolve) => {
          releases.push(resolve)
        }),
    )

    try {
      const refresh = refreshRepoProjectionReadModel('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full', { queryClient })
      await vi.waitFor(() => {
        expect(releases).toHaveLength(1)
      })

      invalidateRepoRuntimeProjectionQueries('/tmp/repo', 'repo-runtime-1', queryClient)
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
    const releases: Array<(projection: RepoRuntimeProjection) => void> = []
    setRepoProjectionQueryData('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full', repoProjectionForTest(0), queryClient)
    repoClientMocks.getRepoProjection.mockImplementation(
      () =>
        new Promise<RepoRuntimeProjection>((resolve) => {
          releases.push(resolve)
        }),
    )

    try {
      const refresh = refreshRepoProjectionReadModel('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full', { queryClient })
      await vi.waitFor(() => {
        expect(releases).toHaveLength(1)
      })
      expect(
        queryClient.getQueryState(repoProjectionQueryKey('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full'))
          ?.isInvalidated,
      ).toBe(true)

      invalidateRepoRuntimeProjectionQueries('/tmp/repo', 'repo-runtime-1', queryClient)
      releases[0]!(repoProjectionForTest(1))
      await vi.waitFor(() => {
        expect(releases).toHaveLength(2)
      })

      releases[1]!(repoProjectionForTest(2))
      await expect(refresh).resolves.toMatchObject({ loadedAt: 2 })
      expect(getRepoOperationsQueryData('/tmp/repo', 'repo-runtime-1', queryClient)?.loadedAt).toBe(2)
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
      resolve: (projection: RepoRuntimeProjection) => void
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
      (_repoRoot: string, branch: string | null | undefined, options?: { mode?: 'summary' | 'full' }) =>
        new Promise<RepoRuntimeProjection>((resolve) => {
          releases.push({ branch: branch ?? null, mode: options?.mode ?? 'full', resolved: false, resolve })
        }),
    )
    const observer = new QueryObserver(
      queryClient,
      repoProjectionQueryOptions('/tmp/repo', 'repo-runtime-1', null, 'summary'),
    )
    const unsubscribe = observer.subscribe(() => {})
    try {
      await vi.waitFor(() => {
        expect(releases).toHaveLength(1)
      })

      const refresh = refreshRepoProjectionReadModel('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full', {
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

function repoProjectionForTest(
  loadedAt: number,
  branch: string | null = 'feature/a',
  mode: 'summary' | 'full' = 'full',
): RepoRuntimeProjection {
  return {
    snapshot: { branches: [], current: 'main' },
    status: [],
    pullRequests: null,
    operations: { operations: [], loadedAt },
    requested: { branch, pullRequestMode: mode },
    loadedAt,
  }
}

function repoOperationsForTest(loadedAt: number): RepoOperationsSnapshot {
  return { operations: [], loadedAt }
}
