import { describe, expect, test } from 'vitest'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'
import {
  activeRepoIdAfterWorkspaceHydration,
  nextActiveRepoIdAfterWorkspaceClose,
  persistedOpenWorkspaceEntries,
} from '#/web/open-workspace-state.ts'

describe('persistedOpenWorkspaceEntries', () => {
  test('preserves order, skips missing repos, and serializes remote targets as session entries', () => {
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
      displayName: 'example:repo',
    })
    expect(target).not.toBeNull()

    expect(
      persistedOpenWorkspaceEntries(['/tmp/repo-a', target!.id, '/tmp/missing'], {
        '/tmp/repo-a': { id: '/tmp/repo-a', remote: { lifecycle: null } },
        [target!.id]: {
          id: target!.id,
          remote: {
            lifecycle: { kind: 'ready', target: target! },
          },
        },
      }),
    ).toEqual([
      { kind: 'local', id: '/tmp/repo-a' },
      {
        kind: 'remote',
        id: target!.id,
        ref: {
          id: target!.id,
          alias: 'example',
          remotePath: '/srv/repo',
          displayName: 'example:repo',
        },
      },
    ])
  })
})

describe('nextActiveRepoIdAfterWorkspaceClose', () => {
  test('keeps the active selection when closing an inactive workspace', () => {
    expect(nextActiveRepoIdAfterWorkspaceClose(['/tmp/repo-a', '/tmp/repo-b'], '/tmp/repo-a', '/tmp/repo-b')).toBe(
      '/tmp/repo-a',
    )
  })

  test('slides to the right neighbor, then the left, then null', () => {
    expect(
      nextActiveRepoIdAfterWorkspaceClose(['/tmp/repo-a', '/tmp/repo-b', '/tmp/repo-c'], '/tmp/repo-b', '/tmp/repo-b'),
    ).toBe('/tmp/repo-c')
    expect(nextActiveRepoIdAfterWorkspaceClose(['/tmp/repo-a', '/tmp/repo-b'], '/tmp/repo-b', '/tmp/repo-b')).toBe(
      '/tmp/repo-a',
    )
    expect(nextActiveRepoIdAfterWorkspaceClose(['/tmp/repo-a'], '/tmp/repo-a', '/tmp/repo-a')).toBeNull()
  })
})

describe('activeRepoIdAfterWorkspaceHydration', () => {
  test('preserves a user-selected active repo over the restored preferred repo', () => {
    expect(
      activeRepoIdAfterWorkspaceHydration(
        '/tmp/repo-a',
        { '/tmp/repo-a': {}, '/tmp/repo-b': {} },
        ['/tmp/repo-a', '/tmp/repo-b'],
        '/tmp/repo-b',
        null,
      ),
    ).toBe('/tmp/repo-a')
  })

  test('falls back to the restored preferred repo and then the first open workspace', () => {
    expect(
      activeRepoIdAfterWorkspaceHydration(
        null,
        { '/tmp/repo-a': {}, '/tmp/repo-b': {} },
        ['/tmp/repo-a', '/tmp/repo-b'],
        '/tmp/repo-b',
        null,
      ),
    ).toBe('/tmp/repo-b')
    expect(
      activeRepoIdAfterWorkspaceHydration(null, { '/tmp/repo-a': {} }, ['/tmp/repo-a'], '/tmp/missing', null),
    ).toBe('/tmp/repo-a')
  })
})
