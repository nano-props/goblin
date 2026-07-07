import { QueryClient } from '@tanstack/react-query'
import { describe, expect, test, vi } from 'vitest'
import {
  getRepoOperationsQueryData,
  getRepoProjectionQueryData,
  getRepoSnapshotQueryData,
  getRepoStatusQueryData,
  repoOperationsQueryKey,
  repoProjectionQueryKey,
  scheduleRepoRuntimeProjectionRefresh,
  setRepoOperationsQueryData,
  setRepoProjectionQueryData,
  setRepoStatusQueryData,
} from '#/web/repo-data-query.ts'
import type { PullRequestEntry, RepoRuntimeProjection, RepoSnapshot } from '#/shared/api-types.ts'
import type { WorktreeStatus } from '#/shared/git-types.ts'

describe('repo data query keys', () => {
  test('separates projection branch and fetch mode', () => {
    expect(repoProjectionQueryKey('/tmp/repo', 'repo-instance-1', 'feature/a', 'summary')).not.toEqual(
      repoProjectionQueryKey('/tmp/repo', 'repo-instance-1', 'feature/a', 'full'),
    )
    expect(repoProjectionQueryKey('/tmp/repo', 'repo-instance-1', 'feature/a', 'full')).not.toEqual(
      repoProjectionQueryKey('/tmp/repo', 'repo-instance-1', 'feature/b', 'full'),
    )
  })

  test('separates operation snapshots by settled inclusion', () => {
    expect(repoOperationsQueryKey('/tmp/repo', 'repo-instance-1', false)).not.toEqual(
      repoOperationsQueryKey('/tmp/repo', 'repo-instance-1', true),
    )
  })
})

describe('repo projection query data', () => {
  test('backfills shared section caches from a server projection', () => {
    const queryClient = new QueryClient()
    const snapshot: RepoSnapshot = { branches: [], current: 'main' }
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

    setRepoProjectionQueryData('/tmp/repo', 'repo-instance-1', 'feature/a', 'full', projection, queryClient)

    expect(getRepoProjectionQueryData('/tmp/repo', 'repo-instance-1', 'feature/a', 'full', queryClient)).toEqual(
      projection,
    )
    expect(getRepoSnapshotQueryData('/tmp/repo', 'repo-instance-1', queryClient)).toEqual(snapshot)
    expect(getRepoStatusQueryData('/tmp/repo', 'repo-instance-1', queryClient)).toEqual(status)
    expect(getRepoOperationsQueryData('/tmp/repo', 'repo-instance-1', queryClient)).toEqual({
      operations: [],
      loadedAt: 123,
    })
  })

  test('projects per-section cache writes into matching projection caches', () => {
    const queryClient = new QueryClient()
    const projection: RepoRuntimeProjection = {
      snapshot: { branches: [], current: 'main' },
      status: [{ path: '/tmp/repo', branch: 'main', isMain: true, entries: [] }],
      pullRequests: null,
      operations: { operations: [], loadedAt: 123 },
      requested: { branch: 'feature/a', pullRequestMode: 'summary' },
      loadedAt: 123,
    }
    const updatedStatus: WorktreeStatus[] = [
      { path: '/tmp/repo', branch: 'feature/a', isMain: false, entries: [{ x: 'M', y: ' ', path: 'README.md' }] },
    ]

    setRepoProjectionQueryData('/tmp/repo', 'repo-instance-1', 'feature/a', 'summary', projection, queryClient)
    setRepoStatusQueryData('/tmp/repo', 'repo-instance-1', updatedStatus, queryClient)

    expect(getRepoProjectionQueryData('/tmp/repo', 'repo-instance-1', 'feature/a', 'summary', queryClient)).toEqual({
      ...projection,
      status: updatedStatus,
    })
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
          repoInstanceId: null,
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

    setRepoProjectionQueryData('/tmp/repo', 'repo-instance-1', 'feature/a', 'full', projection, queryClient)
    setRepoOperationsQueryData('/tmp/repo', 'repo-instance-1', false, operations, queryClient)

    expect(getRepoOperationsQueryData('/tmp/repo', 'repo-instance-1', queryClient)).toEqual(operations)
    expect(getRepoProjectionQueryData('/tmp/repo', 'repo-instance-1', 'feature/a', 'full', queryClient)).toEqual({
      ...projection,
      operations,
    })
  })

  test('schedules precise runtime projection invalidations', () => {
    vi.useFakeTimers()
    try {
      const queryClient = new QueryClient()
      const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

      scheduleRepoRuntimeProjectionRefresh('/tmp/repo', 'repo-instance-1', {
        queryClient,
        delaysMs: [10, 20],
      })

      expect(invalidateQueries).toHaveBeenCalledTimes(2)
      expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
        queryKey: ['repo-data', '/tmp/repo', 'repo-instance-1', 'projection'],
      })
      expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
        queryKey: ['repo-data', '/tmp/repo', 'repo-instance-1', 'operations'],
      })

      vi.advanceTimersByTime(10)
      expect(invalidateQueries).toHaveBeenCalledTimes(4)
      vi.advanceTimersByTime(10)
      expect(invalidateQueries).toHaveBeenCalledTimes(6)
    } finally {
      vi.useRealTimers()
    }
  })
})
