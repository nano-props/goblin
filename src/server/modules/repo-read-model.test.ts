import { afterEach, describe, expect, test } from 'vitest'
import type { PullRequestInfo } from '#/shared/git-types.ts'
import type { RepoSnapshot } from '#/shared/rpc.ts'
import {
  invalidateCachedRepoReadModel,
  readCachedPullRequests,
  readCachedRepoSnapshot,
  resetRepoReadModelForTests,
  writeCachedPullRequests,
  writeCachedRepoSnapshot,
} from '#/server/modules/repo-read-model.ts'

function repoSnapshot(branch = 'main'): RepoSnapshot {
  return {
    branches: [
      {
        name: branch,
        isCurrent: true,
        ahead: 0,
        behind: 0,
        lastCommitHash: 'hash-0',
        lastCommitMessage: 'commit 0',
        lastCommitDate: '2024-01-01T00:00:00.000Z',
        lastCommitAuthor: 'dev',
      },
    ],
    current: branch,
  }
}

function pullRequest(number: number): PullRequestInfo {
  return {
    number,
    title: `PR ${number}`,
    url: `https://example.com/pr/${number}`,
    state: 'open',
  }
}

afterEach(() => {
  resetRepoReadModelForTests()
})

describe('repo read model snapshot cache', () => {
  test('stores and returns a cached repo snapshot', async () => {
    await writeCachedRepoSnapshot('/tmp/repo', repoSnapshot('feature/a'))

    await expect(readCachedRepoSnapshot('/tmp/repo')).resolves.toEqual(repoSnapshot('feature/a'))
  })

  test('invalidates cached snapshot and pull requests for a repo', async () => {
    await writeCachedRepoSnapshot('/tmp/repo', repoSnapshot('main'))
    await writeCachedPullRequests('/tmp/repo', [{ branch: 'main', pullRequest: pullRequest(1) }], {
      branches: ['main'],
      mode: 'full',
    })

    await invalidateCachedRepoReadModel('/tmp/repo')

    await expect(readCachedRepoSnapshot('/tmp/repo')).resolves.toBeNull()
    await expect(readCachedPullRequests('/tmp/repo', ['main'], 'full')).resolves.toBeUndefined()
  })
})

describe('repo read model pull request cache', () => {
  test('stores requested branches including no-pr hits', async () => {
    await writeCachedPullRequests('/tmp/repo', [{ branch: 'feature/a', pullRequest: pullRequest(1) }], {
      branches: ['feature/a', 'feature/b'],
      mode: 'full',
    })

    await expect(readCachedPullRequests('/tmp/repo', ['feature/a', 'feature/b'], 'full')).resolves.toEqual([
      { branch: 'feature/a', pullRequest: pullRequest(1) },
    ])
  })

  test('returns undefined when one requested branch is not cached', async () => {
    await writeCachedPullRequests('/tmp/repo', [{ branch: 'feature/a', pullRequest: pullRequest(1) }], {
      branches: ['feature/a'],
      mode: 'summary',
    })

    await expect(readCachedPullRequests('/tmp/repo', ['feature/a', 'feature/b'], 'summary')).resolves.toBeUndefined()
  })
})
