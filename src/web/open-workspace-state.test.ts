import { describe, expect, test } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { normalizeRemoteTarget, remoteWorkspaceSessionEntry } from '#/shared/remote-workspace.ts'
import {
  restoredWorkspaceIdAfterWorkspaceHydration,
  nextRestoredRepoIdAfterWorkspaceClose,
  persistedOpenWorkspaceEntries,
} from '#/web/open-workspace-state.ts'

const REPO_A = workspaceIdForTest('goblin+file:///tmp/repo-a')
const REPO_B = workspaceIdForTest('goblin+file:///tmp/repo-b')
const REPO_C = workspaceIdForTest('goblin+file:///tmp/repo-c')

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
    if (!target) throw new Error('expected a valid remote target fixture')

    expect(
      persistedOpenWorkspaceEntries([REPO_A, target.id, workspaceIdForTest('goblin+file:///tmp/missing')], {
        [REPO_A]: {
          id: REPO_A,
          admission: { kind: 'local' },
        },
        [target.id]: {
          id: target.id,
          admission: {
            kind: 'remote',
            lifecycle: { kind: 'ready', target },
            lifecycleAttemptId: 1,
          },
        },
      }),
    ).toEqual([
      { kind: 'local', id: 'goblin+file:///tmp/repo-a' },
      {
        kind: 'remote',
        id: target.id,
        ref: {
          id: target.id,
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
    if (!target) throw new Error('expected a valid remote target fixture')
    const entry = remoteWorkspaceSessionEntry(target)

    expect(
      persistedOpenWorkspaceEntries([target.id], {
        [target.id]: {
          id: target.id,
          session: { entry },
          admission: { kind: 'remote', lifecycle: null, lifecycleAttemptId: null },
        },
      }),
    ).toEqual([entry])
  })
})

describe('nextRestoredRepoIdAfterWorkspaceClose', () => {
  test('keeps the active selection when closing an inactive workspace', () => {
    expect(
      nextRestoredRepoIdAfterWorkspaceClose(
        [REPO_A, REPO_B],
        REPO_A,
        REPO_B,
      ),
    ).toBe('goblin+file:///tmp/repo-a')
  })

  test('slides to the right neighbor, then the left, then null', () => {
    expect(
      nextRestoredRepoIdAfterWorkspaceClose(
        [REPO_A, REPO_B, REPO_C],
        REPO_B,
        REPO_B,
      ),
    ).toBe('goblin+file:///tmp/repo-c')
    expect(
      nextRestoredRepoIdAfterWorkspaceClose(
        [REPO_A, REPO_B],
        REPO_B,
        REPO_B,
      ),
    ).toBe('goblin+file:///tmp/repo-a')
    expect(
      nextRestoredRepoIdAfterWorkspaceClose(
        [REPO_A],
        REPO_A,
        REPO_A,
      ),
    ).toBeNull()
  })
})

describe('restoredWorkspaceIdAfterWorkspaceHydration', () => {
  test('preserves a user-selected restored repo over the persisted restored repo', () => {
    expect(
      restoredWorkspaceIdAfterWorkspaceHydration(
        REPO_A,
        { 'goblin+file:///tmp/repo-a': {}, 'goblin+file:///tmp/repo-b': {} },
        [REPO_A, REPO_B],
        REPO_B,
        null,
      ),
    ).toBe('goblin+file:///tmp/repo-a')
  })

  test('falls back to the restored preferred repo and then the first open workspace when no preferred repo was restored', () => {
    expect(
      restoredWorkspaceIdAfterWorkspaceHydration(
        null,
        { 'goblin+file:///tmp/repo-a': {}, 'goblin+file:///tmp/repo-b': {} },
        [REPO_A, REPO_B],
        REPO_B,
        null,
      ),
    ).toBe('goblin+file:///tmp/repo-b')
    expect(
      restoredWorkspaceIdAfterWorkspaceHydration(
        null,
        { 'goblin+file:///tmp/repo-a': {} },
        [REPO_A],
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
        [REPO_A],
        workspaceIdForTest('goblin+file:///tmp/missing'),
        null,
      ),
    ).toBeNull()
  })
})
