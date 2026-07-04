import { QueryClient } from '@tanstack/react-query'
import { describe, expect, test } from 'vitest'
import {
  getRepoSnapshotQueryData,
  getRepoStatusQueryData,
  repoBulkReadQueryKey,
  repoPullRequestsQueryKey,
  setRepoBulkReadQueryData,
} from '#/web/repo-data-query.ts'

describe('repo data query keys', () => {
  test('separates pull request branch names from fetch mode', () => {
    expect(repoPullRequestsQueryKey('/tmp/repo', 'repo-instance-1', ['feature/a'], 'full')).not.toEqual(
      repoPullRequestsQueryKey('/tmp/repo', 'repo-instance-1', ['feature/a', 'full'], undefined),
    )
    expect(repoPullRequestsQueryKey('/tmp/repo', 'repo-instance-1', ['summary'], 'full')).not.toEqual(
      repoPullRequestsQueryKey('/tmp/repo', 'repo-instance-1', ['full'], 'summary'),
    )
  })

  test('normalizes unordered dimensions inside structured key fields', () => {
    expect(repoPullRequestsQueryKey('/tmp/repo', 'repo-instance-1', ['feature/b', 'feature/a'], 'full')).toEqual(
      repoPullRequestsQueryKey('/tmp/repo', 'repo-instance-1', ['feature/a', 'feature/b'], 'full'),
    )
    expect(repoBulkReadQueryKey('/tmp/repo', 'repo-instance-1', ['status', 'snapshot'])).toEqual(
      repoBulkReadQueryKey('/tmp/repo', 'repo-instance-1', ['snapshot', 'status']),
    )
  })
})

describe('repo bulk read query data', () => {
  test('records partial bulk reads without treating missing snapshot data as a cache write error', () => {
    const queryClient = new QueryClient()
    const status = [{ path: '/tmp/repo', branch: 'main', isMain: true, entries: [] }]

    expect(() =>
      setRepoBulkReadQueryData(
        '/tmp/repo',
        'repo-instance-1',
        ['snapshot', 'status'],
        { snapshot: null, status, pullRequests: null },
        queryClient,
      ),
    ).not.toThrow()

    expect(getRepoSnapshotQueryData('/tmp/repo', 'repo-instance-1', queryClient)).toBeUndefined()
    expect(getRepoStatusQueryData('/tmp/repo', 'repo-instance-1', queryClient)).toEqual(status)
  })
})
