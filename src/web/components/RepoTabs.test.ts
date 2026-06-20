import { describe, expect, test } from 'vitest'
import { repoTabSummariesEqual } from '#/web/components/repo-tabs/summary-equality.ts'
import type { RepoTabSummary } from '#/web/components/repo-tabs/types.ts'

describe('repoTabSummariesEqual', () => {
  test('treats remote lifecycle target changes as unequal even when repo id stays the same', () => {
    const left: RepoTabSummary[] = [
      {
        id: 'ssh-config://example/srv%2Frepo',
        name: 'repo',
        remoteDetails: [],
        lifecycle: {
          kind: 'ready',
          target: {
            id: 'ssh-config://example/srv%2Frepo',
            alias: 'example',
            host: 'old-host.internal',
            user: 'old-user',
            port: 22,
            remotePath: '/srv/repo',
            displayName: 'example:repo',
          },
        },
      },
    ]
    const right: RepoTabSummary[] = [
      {
        id: 'ssh-config://example/srv%2Frepo',
        name: 'repo',
        remoteDetails: [],
        lifecycle: {
          kind: 'ready',
          target: {
            id: 'ssh-config://example/srv%2Frepo',
            alias: 'example',
            host: 'new-host.internal',
            user: 'new-user',
            port: 2222,
            remotePath: '/srv/repo',
            displayName: 'example-renamed:repo',
          },
        },
      },
    ]

    expect(repoTabSummariesEqual(left, right)).toBe(false)
  })
})
