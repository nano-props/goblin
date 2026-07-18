import { describe, expect, test } from 'vitest'
import { normalizeRemoteTarget, remoteWorkspaceSessionEntry } from '#/shared/remote-repo.ts'
import {
  restoredWorkspaceIdAfterWorkspaceHydration,
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
      persistedOpenWorkspaceEntries(['goblin+file:///tmp/repo-a', target!.id, '/tmp/missing'], {
        'goblin+file:///tmp/repo-a': { id: 'goblin+file:///tmp/repo-a', remote: { lifecycle: null } },
        [target!.id]: {
          id: target!.id,
          remote: {
            lifecycle: { kind: 'ready', target: target! },
          },
        },
      }),
    ).toEqual([
      { kind: 'local', id: 'goblin+file:///tmp/repo-a' },
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

  test('uses the preserved session entry for a remote restore stub without a target', () => {
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.com',
      user: 'alice',
      port: 22,
      remotePath: '/srv/repo',
      displayName: 'example:repo',
    })
    expect(target).not.toBeNull()
    const entry = remoteWorkspaceSessionEntry(target!)

    expect(
      persistedOpenWorkspaceEntries([target!.id], {
        [target!.id]: {
          id: target!.id,
          session: { entry },
          remote: {
            lifecycle: null,
          },
        },
      }),
    ).toEqual([entry])
  })
})

describe('nextRestoredRepoIdAfterWorkspaceClose', () => {
  test('keeps the active selection when closing an inactive workspace', () => {
    expect(
      nextRestoredRepoIdAfterWorkspaceClose(
        ['goblin+file:///tmp/repo-a', 'goblin+file:///tmp/repo-b'],
        'goblin+file:///tmp/repo-a',
        'goblin+file:///tmp/repo-b',
      ),
    ).toBe('goblin+file:///tmp/repo-a')
  })

  test('slides to the right neighbor, then the left, then null', () => {
    expect(
      nextRestoredRepoIdAfterWorkspaceClose(
        ['goblin+file:///tmp/repo-a', 'goblin+file:///tmp/repo-b', 'goblin+file:///tmp/repo-c'],
        'goblin+file:///tmp/repo-b',
        'goblin+file:///tmp/repo-b',
      ),
    ).toBe('goblin+file:///tmp/repo-c')
    expect(
      nextRestoredRepoIdAfterWorkspaceClose(
        ['goblin+file:///tmp/repo-a', 'goblin+file:///tmp/repo-b'],
        'goblin+file:///tmp/repo-b',
        'goblin+file:///tmp/repo-b',
      ),
    ).toBe('goblin+file:///tmp/repo-a')
    expect(
      nextRestoredRepoIdAfterWorkspaceClose(
        ['goblin+file:///tmp/repo-a'],
        'goblin+file:///tmp/repo-a',
        'goblin+file:///tmp/repo-a',
      ),
    ).toBeNull()
  })
})

describe('restoredWorkspaceIdAfterWorkspaceHydration', () => {
  test('preserves a user-selected restored repo over the persisted restored repo', () => {
    expect(
      restoredWorkspaceIdAfterWorkspaceHydration(
        'goblin+file:///tmp/repo-a',
        { 'goblin+file:///tmp/repo-a': {}, 'goblin+file:///tmp/repo-b': {} },
        ['goblin+file:///tmp/repo-a', 'goblin+file:///tmp/repo-b'],
        'goblin+file:///tmp/repo-b',
        null,
      ),
    ).toBe('goblin+file:///tmp/repo-a')
  })

  test('falls back to the restored preferred repo and then the first open workspace when no preferred repo was restored', () => {
    expect(
      restoredWorkspaceIdAfterWorkspaceHydration(
        null,
        { 'goblin+file:///tmp/repo-a': {}, 'goblin+file:///tmp/repo-b': {} },
        ['goblin+file:///tmp/repo-a', 'goblin+file:///tmp/repo-b'],
        'goblin+file:///tmp/repo-b',
        null,
      ),
    ).toBe('goblin+file:///tmp/repo-b')
    expect(
      restoredWorkspaceIdAfterWorkspaceHydration(
        null,
        { 'goblin+file:///tmp/repo-a': {} },
        ['goblin+file:///tmp/repo-a'],
        null,
        null,
      ),
    ).toBe('goblin+file:///tmp/repo-a')
  })

  test('does not select the first restored repo while the persisted restored repo is still unavailable', () => {
    expect(
      restoredWorkspaceIdAfterWorkspaceHydration(
        null,
        { 'goblin+file:///tmp/repo-a': {} },
        ['goblin+file:///tmp/repo-a'],
        '/tmp/missing',
        null,
      ),
    ).toBeNull()
  })
})
