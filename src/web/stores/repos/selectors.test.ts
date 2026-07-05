import { describe, expect, test } from 'vitest'
import {
  keyboardRuntimeStateFromStore,
  restorableWorkspaceStateFromStore,
  runtimeCoherentRepoProjectionStateFromStore,
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
          '/tmp/repo\0/tmp/repo': 'session-1',
        },
      }),
    ).toEqual({
      order: ['/tmp/repo'],
      restoredRepoId: '/tmp/repo',
      zenMode: false,
      workspacePaneSize: 50,
      selectedTerminalSessionIdByTerminalWorktree: {
        '/tmp/repo\0/tmp/repo': 'session-1',
      },
    })
  })

  test('compares action bundles by function identity', () => {
    const fnA = () => {}
    const fnB = () => {}
    expect(
      restorableWorkspaceLayoutStoreActionsFromStore({
        toggleZenMode: fnA as never,
        resetLayout: fnA as never,
        setSelectedTerminal: fnA as never,
      }),
    ).toEqual({
      toggleZenMode: fnA,
      resetLayout: fnA,
      setSelectedTerminal: fnA,
    })
    expect(
      restorableWorkspaceLayoutPreferenceStoreActionsFromStore({
        toggleZenMode: fnA as never,
        resetLayout: fnA as never,
        setSelectedTerminal: fnA as never,
      }),
    ).toEqual({
      toggleZenMode: fnA,
      resetLayout: fnA,
      setSelectedTerminal: fnA,
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
        setWorkspacePaneTab: fnA as never,
      }),
    ).toEqual({
      closeRepo: fnA,
      setWorkspacePaneTab: fnA,
    })
    expect(
      runtimeCoherentRepoProjectionStoreActionsFromStore({
        ensureWorkspaceOpen: fnA as never,
        closeRepo: fnA as never,
        setWorkspacePaneTab: fnA as never,
      }),
    ).toEqual({
      ensureWorkspaceOpen: fnA,
      closeRepo: fnA,
      setWorkspacePaneTab: fnA,
    })
    expect(
      primaryWindowNavigationStoreActionsFromStore({
        closeRepo: fnA,
        setWorkspacePaneTab: fnA,
      }),
    ).toEqual({
      closeRepo: fnA,
      setWorkspacePaneTab: fnA,
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
        setSelectedTerminal: fnA as never,
        resetLayout: fnA as never,
        toggleZenMode: fnA as never,
      }),
    ).toEqual({
      ensureWorkspaceOpen: fnA,
      setSelectedTerminal: fnA,
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
})
