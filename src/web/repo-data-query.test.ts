import { QueryClient } from '@tanstack/react-query'
import { describe, expect, test, vi } from 'vitest'
import {
  getRepoOperationsQueryData,
  getRepoProjectionPlaceholderData,
  getRepoProjectionQueryData,
  invalidateRepoRuntimeProjectionQueries,
  repoOperationsQueryKey,
  repoProjectionQueryKey,
  seedRepoProjectionQueryData,
  setRepoOperationsQueryData,
  setRepoProjectionQueryData,
} from '#/web/repo-data-query.ts'
import type { PullRequestEntry, RepoRuntimeProjection } from '#/shared/api-types.ts'
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

    seedRepoProjectionQueryData('/tmp/repo', 'repo-instance-1', cachedProjection, queryClient)

    expect(getRepoProjectionPlaceholderData('/tmp/repo', 'repo-instance-1', 'feature/a', 'full', queryClient)).toEqual({
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

    seedRepoProjectionQueryData('/tmp/repo', 'repo-instance-1', branchProjection, queryClient)
    seedRepoProjectionQueryData('/tmp/repo', 'repo-instance-1', repoProjection, queryClient)

    expect(
      getRepoProjectionPlaceholderData('/tmp/repo', 'repo-instance-1', 'feature/a', 'full', queryClient),
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

    setRepoProjectionQueryData('/tmp/repo', 'repo-instance-1', 'feature/a', 'full', projection, queryClient)

    expect(getRepoProjectionQueryData('/tmp/repo', 'repo-instance-1', 'feature/a', 'full', queryClient)).toEqual(
      projection,
    )
    expect(getRepoOperationsQueryData('/tmp/repo', 'repo-instance-1', queryClient)).toEqual({
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

    seedRepoProjectionQueryData('/tmp/repo', 'repo-instance-1', projection, queryClient)

    expect(getRepoProjectionQueryData('/tmp/repo', 'repo-instance-1', 'feature/a', 'summary', queryClient)).toEqual({
      ...projection,
    })
    expect(getRepoOperationsQueryData('/tmp/repo', 'repo-instance-1', queryClient)).toBeUndefined()
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

  test('invalidates runtime projection queries once per server-owned lifecycle signal', () => {
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    invalidateRepoRuntimeProjectionQueries('/tmp/repo', 'repo-instance-1', queryClient)

    expect(invalidateQueries).toHaveBeenCalledTimes(2)
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ['repo-data', '/tmp/repo', 'repo-instance-1', 'projection'],
    })
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ['repo-data', '/tmp/repo', 'repo-instance-1', 'operations'],
    })
  })
})
