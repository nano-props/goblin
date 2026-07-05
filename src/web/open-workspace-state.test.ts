import { describe, expect, test } from 'vitest'
import { normalizeRemoteTarget } from '#/shared/remote-repo.ts'
import {
  restoredRepoIdAfterWorkspaceHydration,
  nextRestoredRepoIdAfterWorkspaceClose,
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

describe('nextRestoredRepoIdAfterWorkspaceClose', () => {
  test('keeps the active selection when closing an inactive workspace', () => {
    expect(nextRestoredRepoIdAfterWorkspaceClose(['/tmp/repo-a', '/tmp/repo-b'], '/tmp/repo-a', '/tmp/repo-b')).toBe(
      '/tmp/repo-a',
    )
  })

  test('slides to the right neighbor, then the left, then null', () => {
    expect(
      nextRestoredRepoIdAfterWorkspaceClose(['/tmp/repo-a', '/tmp/repo-b', '/tmp/repo-c'], '/tmp/repo-b', '/tmp/repo-b'),
    ).toBe('/tmp/repo-c')
    expect(nextRestoredRepoIdAfterWorkspaceClose(['/tmp/repo-a', '/tmp/repo-b'], '/tmp/repo-b', '/tmp/repo-b')).toBe(
      '/tmp/repo-a',
    )
    expect(nextRestoredRepoIdAfterWorkspaceClose(['/tmp/repo-a'], '/tmp/repo-a', '/tmp/repo-a')).toBeNull()
  })
})

describe('restoredRepoIdAfterWorkspaceHydration', () => {
  test('preserves a user-selected restored repo over the persisted restored repo', () => {
    expect(
      restoredRepoIdAfterWorkspaceHydration(
        '/tmp/repo-a',
        { '/tmp/repo-a': {}, '/tmp/repo-b': {} },
        ['/tmp/repo-a', '/tmp/repo-b'],
        '/tmp/repo-b',
        null,
      ),
    ).toBe('/tmp/repo-a')
  })

  test('falls back to the restored preferred repo and then the first open workspace when no preferred repo was restored', () => {
    expect(
      restoredRepoIdAfterWorkspaceHydration(
        null,
        { '/tmp/repo-a': {}, '/tmp/repo-b': {} },
        ['/tmp/repo-a', '/tmp/repo-b'],
        '/tmp/repo-b',
        null,
      ),
    ).toBe('/tmp/repo-b')
    expect(restoredRepoIdAfterWorkspaceHydration(null, { '/tmp/repo-a': {} }, ['/tmp/repo-a'], null, null)).toBe(
      '/tmp/repo-a',
    )
  })

  test('does not select the first restored repo while the persisted restored repo is still unavailable', () => {
    expect(
      restoredRepoIdAfterWorkspaceHydration(null, { '/tmp/repo-a': {} }, ['/tmp/repo-a'], '/tmp/missing', null),
    ).toBeNull()
  })
})
