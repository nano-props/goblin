import { createElement } from 'react'
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import {
  getRepoOperationsQueryData,
  getRepoProjectionPlaceholderData,
  getRepoProjectionQueryData,
  getRepoWorktreeStatusQueryData,
  invalidateRepoRuntimeProjectionQueries,
  repoOperationsQueryKey,
  repoProjectionQueryOptions,
  repoProjectionQueryKey,
  refreshRepoProjectionReadModel,
  refreshRepoWorktreeStatusReadModel,
  seedRepoProjectionQueryData,
  setRepoOperationsQueryData,
  setRepoProjectionQueryData,
  setRepoWorktreeStatusQueryData,
  useRepoOperationsReadModel,
} from '#/web/repo-data-query.ts'
import type {
  PullRequestEntry,
  RepoOperationsSnapshot,
  WorkspaceRuntimeProjection,
  RepoWorktreeStatusSnapshot,
} from '#/shared/api-types.ts'
import type { WorktreeStatus } from '#/shared/git-types.ts'

const repoClientMocks = vi.hoisted(() => ({
  getRepoLog: vi.fn(),
  getRepoOperations: vi.fn(),
  getRepoProjection: vi.fn(),
  getRepoRemoteBranches: vi.fn(),
  getRepoWorktreeStatus: vi.fn(),
}))

vi.mock('#/web/repo-client.ts', () => repoClientMocks)

beforeEach(() => {
  repoClientMocks.getRepoLog.mockReset()
  repoClientMocks.getRepoOperations.mockReset()
  repoClientMocks.getRepoProjection.mockReset()
  repoClientMocks.getRepoRemoteBranches.mockReset()
  repoClientMocks.getRepoWorktreeStatus.mockReset()
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
    const cachedProjection: WorkspaceRuntimeProjection = {
      snapshot: { branches: [], current: 'main' },
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
      pullRequests: null,
      operations: { operations: [], loadedAt: 123 },
      requested: { branch: 'feature/a', pullRequestMode: 'full' },
      loadedAt: 0,
    })
  })

  test('prefers the null-branch runtime projection as branch workspace placeholder', () => {
    const queryClient = new QueryClient()
    const branchProjection: WorkspaceRuntimeProjection = {
      snapshot: { branches: [], current: 'feature/other' },
      pullRequests: null,
      operations: { operations: [], loadedAt: 101 },
      requested: { branch: 'feature/other', pullRequestMode: 'summary' },
      loadedAt: 101,
    }
    const repoProjection: WorkspaceRuntimeProjection = {
      snapshot: { branches: [], current: 'main' },
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
      requested: { branch: 'feature/a', pullRequestMode: 'full' },
      loadedAt: 0,
    })
  })

  test('writes server projection and active operations cache', () => {
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
    const projection: WorkspaceRuntimeProjection = {
      snapshot,
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
    const projection: WorkspaceRuntimeProjection = {
      snapshot: { branches: [], current: 'main' },
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
    const projection: WorkspaceRuntimeProjection = {
      snapshot: { branches: [], current: 'main' },
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
          workspaceRuntimeId: null,
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

    invalidateRepoRuntimeProjectionQueries('/tmp/repo', 'repo-runtime-1', queryClient)

    expect(invalidateQueries).toHaveBeenCalledTimes(3)
    expect(invalidateQueries).toHaveBeenNthCalledWith(
      1,
      {
        queryKey: ['repo-data', '/tmp/repo', 'repo-runtime-1', 'projection'],
        refetchType: 'active',
      },
      { cancelRefetch: false },
    )
    expect(invalidateQueries).toHaveBeenNthCalledWith(
      2,
      {
        queryKey: ['repo-data', '/tmp/repo', 'repo-runtime-1', 'operations'],
        refetchType: 'active',
      },
      { cancelRefetch: false },
    )
    expect(invalidateQueries).toHaveBeenNthCalledWith(
      3,
      {
        queryKey: ['repo-data', '/tmp/repo', 'repo-runtime-1', 'worktree-status'],
        exact: true,
        refetchType: 'active',
      },
      { cancelRefetch: false },
    )
    invalidateQueries.mockRestore()
  })

  test('coalesces runtime projection invalidations without aborting in-flight refetches', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const signals: AbortSignal[] = []
    const releases: Array<(projection: WorkspaceRuntimeProjection) => void> = []
    setRepoProjectionQueryData(
      '/tmp/repo',
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
        new Promise<WorkspaceRuntimeProjection>((resolve) => {
          if (!signal) throw new Error('missing projection abort signal')
          signals.push(signal)
          releases.push(resolve)
        }),
    )
    const observer = new QueryObserver(
      queryClient,
      repoProjectionQueryOptions('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full'),
    )
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
        expect((observer.getCurrentResult().data as WorkspaceRuntimeProjection | undefined)?.loadedAt).toBe(2)
      })
    } finally {
      unsubscribe()
      queryClient.clear()
    }
  })

  test('reruns runtime projection invalidation after a pre-existing active fetch settles', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const signals: AbortSignal[] = []
    const releases: Array<(projection: WorkspaceRuntimeProjection) => void> = []
    repoClientMocks.getRepoProjection.mockImplementation(
      (
        _repoRoot: string,
        _repoRuntimeId: string,
        _branch: string | null | undefined,
        _options: unknown,
        signal?: AbortSignal,
      ) =>
        new Promise<WorkspaceRuntimeProjection>((resolve) => {
          if (!signal) throw new Error('missing projection abort signal')
          signals.push(signal)
          releases.push(resolve)
        }),
    )
    const observer = new QueryObserver(
      queryClient,
      repoProjectionQueryOptions('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full'),
    )
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
        expect((observer.getCurrentResult().data as WorkspaceRuntimeProjection | undefined)?.loadedAt).toBe(2)
      })
    } finally {
      unsubscribe()
      queryClient.clear()
    }
  })

  test('keeps runtime projection invalidated when observer unmounts before queued rerun', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const releases: Array<(projection: WorkspaceRuntimeProjection) => void> = []
    const queryKey = repoProjectionQueryKey('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full')
    const observer = new QueryObserver<WorkspaceRuntimeProjection>(queryClient, {
      queryKey,
      queryFn: () =>
        new Promise<WorkspaceRuntimeProjection>((resolve) => {
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

  test('imperative projection refresh does not spawn and cancel a matching active observer refetch', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const signals: AbortSignal[] = []
    const releases: Array<(projection: WorkspaceRuntimeProjection) => void> = []
    const queryKey = repoProjectionQueryKey('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full')
    setRepoProjectionQueryData(
      '/tmp/repo',
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
        new Promise<WorkspaceRuntimeProjection>((resolve, reject) => {
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
      repoProjectionQueryOptions('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full'),
    )
    const unsubscribe = observer.subscribe(() => {})
    try {
      expect(queryClient.getQueryData(queryKey)).toMatchObject({ loadedAt: 0 })
      expect(repoClientMocks.getRepoProjection).not.toHaveBeenCalled()

      const refresh = refreshRepoProjectionReadModel('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full', {
        queryClient,
      })
      await vi.waitFor(() => {
        expect(signals).toHaveLength(1)
      })

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
        new Promise<WorkspaceRuntimeProjection>((_resolve, reject) => {
          if (!signal) throw new Error('missing projection abort signal')
          signals.push(signal)
          signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), { once: true })
        }),
    )
    const controller = new AbortController()

    try {
      const refresh = refreshRepoProjectionReadModel('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full', {
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
    const releases: Array<(projection: WorkspaceRuntimeProjection) => void> = []
    repoClientMocks.getRepoProjection.mockImplementation(
      (
        _repoRoot: string,
        _repoRuntimeId: string,
        _branch: string | null | undefined,
        _options: unknown,
        signal?: AbortSignal,
      ) =>
        new Promise<WorkspaceRuntimeProjection>((resolve, reject) => {
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

      const refresh = refreshRepoProjectionReadModel('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full', {
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
    const releases: Array<(projection: WorkspaceRuntimeProjection) => void> = []
    repoClientMocks.getRepoProjection.mockImplementation(
      () =>
        new Promise<WorkspaceRuntimeProjection>((resolve) => {
          releases.push(resolve)
        }),
    )

    try {
      const refresh = refreshRepoProjectionReadModel('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full', {
        queryClient,
      })
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
    const releases: Array<(projection: WorkspaceRuntimeProjection) => void> = []
    setRepoProjectionQueryData(
      '/tmp/repo',
      'repo-runtime-1',
      'feature/a',
      'full',
      repoProjectionForTest(0),
      queryClient,
    )
    repoClientMocks.getRepoProjection.mockImplementation(
      () =>
        new Promise<WorkspaceRuntimeProjection>((resolve) => {
          releases.push(resolve)
        }),
    )

    try {
      const refresh = refreshRepoProjectionReadModel('/tmp/repo', 'repo-runtime-1', 'feature/a', 'full', {
        queryClient,
      })
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
      resolve: (projection: WorkspaceRuntimeProjection) => void
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
        new Promise<WorkspaceRuntimeProjection>((resolve) => {
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

describe('repo worktree status query data', () => {
  test('does not create status data when the first refresh fails', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    repoClientMocks.getRepoWorktreeStatus.mockRejectedValue(new Error('transport failed'))

    await expect(refreshRepoWorktreeStatusReadModel('/tmp/repo', 'repo-runtime-1', { queryClient })).rejects.toThrow(
      'transport failed',
    )
    expect(getRepoWorktreeStatusQueryData('/tmp/repo', 'repo-runtime-1', queryClient)).toBeUndefined()
  })

  test('shares a failing in-flight status read between concurrent refreshes', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let rejectRead!: (error: Error) => void
    repoClientMocks.getRepoWorktreeStatus.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectRead = reject
        }),
    )

    const first = refreshRepoWorktreeStatusReadModel('/tmp/repo', 'repo-runtime-1', { queryClient })
    await vi.waitFor(() => expect(repoClientMocks.getRepoWorktreeStatus).toHaveBeenCalledOnce())
    const second = refreshRepoWorktreeStatusReadModel('/tmp/repo', 'repo-runtime-1', { queryClient })
    rejectRead(new Error('transport failed'))

    const results = await Promise.allSettled([first, second])
    expect(results).toEqual([
      expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ message: 'transport failed' }) }),
      expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ message: 'transport failed' }) }),
    ])
    expect(repoClientMocks.getRepoWorktreeStatus).toHaveBeenCalledOnce()
    expect(getRepoWorktreeStatusQueryData('/tmp/repo', 'repo-runtime-1', queryClient)).toBeUndefined()
  })

  test('caller cancellation does not abort a shared status read', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const controller = new AbortController()
    let transportSignal!: AbortSignal
    let resolveRead!: (snapshot: RepoWorktreeStatusSnapshot) => void
    repoClientMocks.getRepoWorktreeStatus.mockImplementation((_repoRoot, _repoRuntimeId, signal) => {
      transportSignal = signal
      return new Promise((resolve) => {
        resolveRead = resolve
      })
    })

    const first = refreshRepoWorktreeStatusReadModel('/tmp/repo', 'repo-runtime-1', {
      queryClient,
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(repoClientMocks.getRepoWorktreeStatus).toHaveBeenCalledOnce())
    const second = refreshRepoWorktreeStatusReadModel('/tmp/repo', 'repo-runtime-1', { queryClient })
    controller.abort(new Error('caller stopped'))

    await expect(first).rejects.toThrow('caller stopped')
    expect(transportSignal.aborted).toBe(false)
    resolveRead({ workspaceRuntimeId: 'repo-runtime-1', status: [], loadedAt: 2 })
    await expect(second).resolves.toMatchObject({ loadedAt: 2 })
    expect(repoClientMocks.getRepoWorktreeStatus).toHaveBeenCalledOnce()
  })

  test('preserves the last accepted status when refresh fails', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const accepted = {
      workspaceRuntimeId: 'repo-runtime-1',
      status: [{ path: '/tmp/repo', branch: 'main', isMain: true, entries: [{ x: 'M', y: ' ', path: 'a.ts' }] }],
      loadedAt: 1,
    }
    setRepoWorktreeStatusQueryData('/tmp/repo', 'repo-runtime-1', accepted, queryClient)
    repoClientMocks.getRepoWorktreeStatus.mockRejectedValue(new Error('transport failed'))

    await expect(refreshRepoWorktreeStatusReadModel('/tmp/repo', 'repo-runtime-1', { queryClient })).rejects.toThrow(
      'transport failed',
    )
    expect(getRepoWorktreeStatusQueryData('/tmp/repo', 'repo-runtime-1', queryClient)).toEqual(accepted)
  })

  test('accepts a successful empty collection as clean', async () => {
    const queryClient = new QueryClient()
    repoClientMocks.getRepoWorktreeStatus.mockResolvedValue({
      workspaceRuntimeId: 'repo-runtime-1',
      status: [],
      loadedAt: 2,
    })

    await refreshRepoWorktreeStatusReadModel('/tmp/repo', 'repo-runtime-1', { queryClient })

    expect(getRepoWorktreeStatusQueryData('/tmp/repo', 'repo-runtime-1', queryClient)?.status).toEqual([])
  })

  test('rejects a response belonging to a replaced workspace runtime', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    repoClientMocks.getRepoWorktreeStatus.mockResolvedValue({
      workspaceRuntimeId: 'repo-runtime-old',
      status: [],
      loadedAt: 2,
    })

    await expect(
      refreshRepoWorktreeStatusReadModel('/tmp/repo', 'repo-runtime-current', { queryClient }),
    ).rejects.toMatchObject({
      name: 'MismatchedRepoRuntimeReadError',
      message: 'error.failed-read-repo',
      cause: expect.objectContaining({ message: 'Mismatched workspace runtime read' }),
    })
    expect(repoClientMocks.getRepoWorktreeStatus).toHaveBeenCalledOnce()
    expect(getRepoWorktreeStatusQueryData('/tmp/repo', 'repo-runtime-current', queryClient)).toBeUndefined()
  })
})

function repoProjectionForTest(
  loadedAt: number,
  branch: string | null = 'feature/a',
  mode: 'summary' | 'full' = 'full',
): WorkspaceRuntimeProjection {
  return {
    snapshot: { branches: [], current: 'main' },
    pullRequests: null,
    operations: { operations: [], loadedAt },
    requested: { branch, pullRequestMode: mode },
    loadedAt,
  }
}

function repoOperationsForTest(loadedAt: number): RepoOperationsSnapshot {
  return { operations: [], loadedAt }
}
