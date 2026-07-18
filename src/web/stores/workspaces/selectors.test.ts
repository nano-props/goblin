import { describe, expect, test } from 'vitest'
import {
  keyboardRuntimeStateFromStore,
  restorableWorkspaceStateFromStore,
  runtimeCoherentRepoProjectionStateFromStore,
  workspaceRestoreStatusFromStore,
  workspaceSessionPersistenceOpenFromStore,
} from '#/web/stores/workspaces/selector-state.ts'
import {
  primaryWindowNavigationStoreActionsFromStore,
  clientEffectIntentStoreActionsFromStore,
  workspacePickerStoreActionsFromStore,
  restorableWorkspaceLayoutPreferenceStoreActionsFromStore,
  restorableWorkspaceLayoutStoreActionsFromStore,
  runtimeCoherentWorkspaceNavigationStoreActionsFromStore,
  runtimeCoherentWorkspaceOpenStoreActionsFromStore,
  runtimeCoherentWorkspaceProjectionStoreActionsFromStore,
} from '#/web/stores/workspaces/selector-actions.ts'

describe('repo selectors', () => {
  test('builds explicit runtime-coherent and local state slices from store fields', () => {
    expect(
      runtimeCoherentRepoProjectionStateFromStore({
        workspaces: {
          'goblin+file:///tmp/repo': {
            id: 'goblin+file:///tmp/repo',
          } as never,
        },
      }),
    ).toEqual({
      workspaces: {
        'goblin+file:///tmp/repo': {
          id: 'goblin+file:///tmp/repo',
        },
      },
    })
  })

  test('builds restorable workspace state from store fields', () => {
    expect(
      restorableWorkspaceStateFromStore({
        workspaceOrder: ['goblin+file:///tmp/repo'],
        restoredWorkspaceId: 'goblin+file:///tmp/repo',
        zenMode: false,
        workspacePaneSize: 50,
        selectedTerminalSessionIdByTerminalWorktree: {
          'goblin+file:///tmp/repo\0goblin+file:///tmp/repo': 'term-111111111111111111111',
        },
      }),
    ).toEqual({
      workspaceOrder: ['goblin+file:///tmp/repo'],
      restoredWorkspaceId: 'goblin+file:///tmp/repo',
      zenMode: false,
      workspacePaneSize: 50,
      selectedTerminalSessionIdByTerminalWorktree: {
        'goblin+file:///tmp/repo\0goblin+file:///tmp/repo': 'term-111111111111111111111',
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
      runtimeCoherentWorkspaceOpenStoreActionsFromStore({
        ensureWorkspaceOpen: fnA as never,
      }),
    ).toEqual({
      ensureWorkspaceOpen: fnA,
    })
    expect(
      runtimeCoherentWorkspaceNavigationStoreActionsFromStore({
        closeWorkspace: fnA as never,
      }),
    ).toEqual({
      closeWorkspace: fnA,
    })
    expect(
      runtimeCoherentWorkspaceProjectionStoreActionsFromStore({
        ensureWorkspaceOpen: fnA as never,
        closeWorkspace: fnA as never,
      }),
    ).toEqual({
      ensureWorkspaceOpen: fnA,
      closeWorkspace: fnA,
    })
    expect(
      primaryWindowNavigationStoreActionsFromStore({
        closeWorkspace: fnA as never,
        peekWorkspaceNavigation: fnA as never,
        commitWorkspaceNavigation: fnA as never,
      }),
    ).toEqual({
      closeWorkspace: fnA,
      peekWorkspaceNavigation: fnA,
      commitWorkspaceNavigation: fnA,
    })
    expect(
      workspacePickerStoreActionsFromStore({
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
          workspaces: {
            'goblin+file:///tmp/repo-a': {
              id: 'goblin+file:///tmp/repo-a',
            } as never,
          },
        },
        'goblin+file:///tmp/repo-a',
      ),
    ).toMatchObject({
      repo: { id: 'goblin+file:///tmp/repo-a' },
    })
    expect(
      keyboardRuntimeStateFromStore(
        {
          workspaces: {},
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
