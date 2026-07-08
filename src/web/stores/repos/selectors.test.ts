import { describe, expect, test } from 'vitest'
import {
  keyboardRuntimeStateFromStore,
  restorableWorkspaceStateFromStore,
  runtimeCoherentRepoProjectionStateFromStore,
  workspaceRestoreStatusFromStore,
  workspaceSessionPersistenceOpenFromStore,
} from '#/web/stores/repos/selector-state.ts'
import {
  primaryWindowNavigationStoreActionsFromStore,
  clientEffectIntentStoreActionsFromStore,
  repoPickerStoreActionsFromStore,
  restorableWorkspaceLayoutPreferenceStoreActionsFromStore,
  restorableWorkspaceLayoutStoreActionsFromStore,
  runtimeCoherentRepoNavigationStoreActionsFromStore,
  runtimeCoherentRepoOpenStoreActionsFromStore,
  runtimeCoherentRepoProjectionStoreActionsFromStore,
} from '#/web/stores/repos/selector-actions.ts'

describe('repo selectors', () => {
  test('builds explicit runtime-coherent and local state slices from store fields', () => {
    expect(
      runtimeCoherentRepoProjectionStateFromStore({
        repos: {
          '/tmp/repo': {
            id: '/tmp/repo',
          } as never,
        },
      }),
    ).toEqual({
      repos: {
        '/tmp/repo': {
          id: '/tmp/repo',
        },
      },
    })
  })

  test('builds restorable workspace state from store fields', () => {
    expect(
      restorableWorkspaceStateFromStore({
        order: ['/tmp/repo'],
        restoredRepoId: '/tmp/repo',
        zenMode: false,
        workspacePaneSize: 50,
        selectedTerminalSessionIdByTerminalWorktree: {
          '/tmp/repo\0/tmp/repo': 'term-111111111111111111111',
        },
      }),
    ).toEqual({
      order: ['/tmp/repo'],
      restoredRepoId: '/tmp/repo',
      zenMode: false,
      workspacePaneSize: 50,
      selectedTerminalSessionIdByTerminalWorktree: {
        '/tmp/repo\0/tmp/repo': 'term-111111111111111111111',
      },
    })
  })

  test('compares action bundles by function identity', () => {
    const fnA = () => {}
    expect(
      restorableWorkspaceLayoutStoreActionsFromStore({
        toggleZenMode: fnA as never,
        resetLayout: fnA as never,
      }),
    ).toEqual({
      toggleZenMode: fnA,
      resetLayout: fnA,
    })
    expect(
      restorableWorkspaceLayoutPreferenceStoreActionsFromStore({
        toggleZenMode: fnA as never,
        resetLayout: fnA as never,
      }),
    ).toEqual({
      toggleZenMode: fnA,
      resetLayout: fnA,
    })
    expect(
      runtimeCoherentRepoOpenStoreActionsFromStore({
        ensureWorkspaceOpen: fnA as never,
      }),
    ).toEqual({
      ensureWorkspaceOpen: fnA,
    })
    expect(
      runtimeCoherentRepoNavigationStoreActionsFromStore({
        closeRepo: fnA as never,
      }),
    ).toEqual({
      closeRepo: fnA,
    })
    expect(
      runtimeCoherentRepoProjectionStoreActionsFromStore({
        ensureWorkspaceOpen: fnA as never,
        closeRepo: fnA as never,
      }),
    ).toEqual({
      ensureWorkspaceOpen: fnA,
      closeRepo: fnA,
    })
    expect(
      primaryWindowNavigationStoreActionsFromStore({
        closeRepo: fnA,
      }),
    ).toEqual({
      closeRepo: fnA,
      goBackInWorkspaceNavigation: expect.any(Function),
      goForwardInWorkspaceNavigation: expect.any(Function),
    })
    expect(
      repoPickerStoreActionsFromStore({
        ensureWorkspaceOpen: fnA as never,
      }),
    ).toEqual({
      ensureWorkspaceOpen: fnA,
    })
    expect(
      clientEffectIntentStoreActionsFromStore({
        ensureWorkspaceOpen: fnA as never,
        resetLayout: fnA as never,
        toggleZenMode: fnA as never,
      }),
    ).toEqual({
      ensureWorkspaceOpen: fnA,
      resetLayout: fnA,
      toggleZenMode: fnA,
    })
  })

  test('builds keyboard runtime state from the current repo selection', () => {
    expect(
      keyboardRuntimeStateFromStore(
        {
          repos: {
            '/tmp/repo-a': {
              id: '/tmp/repo-a',
            } as never,
          },
        },
        '/tmp/repo-a',
      ),
    ).toMatchObject({
      repo: { id: '/tmp/repo-a' },
    })
    expect(
      keyboardRuntimeStateFromStore(
        {
          repos: {},
        },
        null,
      ),
    ).toEqual({
      repo: null,
    })
  })

  test('derives workspace restore status from membership and persistence gates', () => {
    expect(
      workspaceRestoreStatusFromStore({
        workspaceMembershipReady: false,
        sessionPersistenceReady: false,
        sessionRestoreError: null,
      }),
    ).toBe('restoring-membership')
    expect(
      workspaceRestoreStatusFromStore({
        workspaceMembershipReady: true,
        sessionPersistenceReady: false,
        sessionRestoreError: null,
      }),
    ).toBe('restoring-runtime-state')
    expect(
      workspaceRestoreStatusFromStore({
        workspaceMembershipReady: true,
        sessionPersistenceReady: false,
        sessionRestoreError: 'restore failed',
      }),
    ).toBe('blocked')
    expect(
      workspaceRestoreStatusFromStore({
        workspaceMembershipReady: true,
        sessionPersistenceReady: true,
        sessionRestoreError: null,
      }),
    ).toBe('ready')
  })

  test('opens session persistence only after workspace restore is ready', () => {
    expect(
      workspaceSessionPersistenceOpenFromStore({
        workspaceMembershipReady: true,
        sessionPersistenceReady: true,
        sessionRestoreError: null,
      }),
    ).toBe(true)
    expect(
      workspaceSessionPersistenceOpenFromStore({
        workspaceMembershipReady: true,
        sessionPersistenceReady: true,
        sessionRestoreError: 'restore failed',
      }),
    ).toBe(false)
  })
})
