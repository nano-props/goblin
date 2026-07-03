import { describe, expect, test } from 'vitest'
import { repoBulkReadQueryKey, repoPullRequestsQueryKey } from '#/web/repo-data-query.ts'

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
