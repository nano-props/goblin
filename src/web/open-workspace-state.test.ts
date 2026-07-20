import { describe, expect, test } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  restoredWorkspaceIdAfterWorkspaceHydration,
  nextRestoredWorkspaceIdAfterWorkspaceClose,
  persistedOpenWorkspaceEntries,
} from '#/web/open-workspace-state.ts'

const REPO_A = workspaceIdForTest('goblin+file:///tmp/repo-a')
const REPO_B = workspaceIdForTest('goblin+file:///tmp/repo-b')
const REPO_C = workspaceIdForTest('goblin+file:///tmp/repo-c')

describe('persistedOpenWorkspaceEntries', () => {
  test('preserves order, skips missing workspaces, and persists canonical IDs', () => {
    const remoteId = workspaceIdForTest('goblin+ssh://example/srv/repo')
    expect(
      persistedOpenWorkspaceEntries([REPO_A, remoteId, workspaceIdForTest('goblin+file:///tmp/missing')], {
        [REPO_A]: {
          id: REPO_A,
        },
        [remoteId]: {
          id: remoteId,
        },
      }),
    ).toEqual([
      { id: 'goblin+file:///tmp/repo-a' },
      { id: remoteId },
    ])
  })
})

describe('nextRestoredWorkspaceIdAfterWorkspaceClose', () => {
  test('keeps the active selection when closing an inactive workspace', () => {
    expect(nextRestoredWorkspaceIdAfterWorkspaceClose([REPO_A, REPO_B], REPO_A, REPO_B)).toBe('goblin+file:///tmp/repo-a')
  })

  test('slides to the right neighbor, then the left, then null', () => {
    expect(nextRestoredWorkspaceIdAfterWorkspaceClose([REPO_A, REPO_B, REPO_C], REPO_B, REPO_B)).toBe(
      'goblin+file:///tmp/repo-c',
    )
    expect(nextRestoredWorkspaceIdAfterWorkspaceClose([REPO_A, REPO_B], REPO_B, REPO_B)).toBe('goblin+file:///tmp/repo-a')
    expect(nextRestoredWorkspaceIdAfterWorkspaceClose([REPO_A], REPO_A, REPO_A)).toBeNull()
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
      restoredWorkspaceIdAfterWorkspaceHydration(null, { 'goblin+file:///tmp/repo-a': {} }, [REPO_A], null, null),
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
