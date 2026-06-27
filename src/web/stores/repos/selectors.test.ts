import { describe, expect, test } from 'vitest'
import {
  keyboardRuntimeStateFromStore,
  primaryWindowWorkspaceStateEqual,
  primaryWindowWorkspaceStateFromStore,
  navigationWorkspaceStateEqual,
  navigationWorkspaceStateFromStore,
  activeRepoFromStore,
  restorableWorkspaceNavigationStateFromStore,
  restorableWorkspaceStateFromStore,
  runtimeCoherentRepoProjectionStateFromStore,
} from '#/web/stores/repos/selector-state.ts'
import {
  primaryWindowNavigationStoreActionsEqual,
  primaryWindowNavigationStoreActionsFromStore,
  clientEffectIntentStoreActionsEqual,
  clientEffectIntentStoreActionsFromStore,
  repoPickerStoreActionsEqual,
  repoPickerStoreActionsFromStore,
  restorableWorkspaceLayoutPreferenceStoreActionsFromStore,
  restorableWorkspaceLayoutStoreActionsFromStore,
  restorableWorkspaceViewportStoreActionsFromStore,
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
    expect(
      primaryWindowWorkspaceStateFromStore({
        activeId: '/tmp/repo',
        order: ['/tmp/repo'],
        zenMode: true,
        sessionReady: true,
      }),
    ).toMatchObject({
      sessionReady: true,
    })
  })

  test('builds restorable workspace state from store fields', () => {
    expect(
      restorableWorkspaceStateFromStore({
        order: ['/tmp/repo'],
        activeId: '/tmp/repo',
        zenMode: false,
        workspacePaneSize: 50,
        selectedTerminalSessionByWorktree: {
          '/tmp/repo\0/tmp/repo': 'session-1',
        },
      }),
    ).toEqual({
      order: ['/tmp/repo'],
      activeId: '/tmp/repo',
      zenMode: false,
      workspacePaneSize: 50,
      selectedTerminalSessionByWorktree: {
        '/tmp/repo\0/tmp/repo': 'session-1',
      },
    })
  })

  test('builds narrower restorable navigation state from store fields', () => {
    expect(
      restorableWorkspaceNavigationStateFromStore({
        activeId: '/tmp/repo',
        order: ['/tmp/repo'],
      }),
    ).toEqual({
      activeId: '/tmp/repo',
      order: ['/tmp/repo'],
    })
  })

  test('compares primary window workspace slices structurally', () => {
    expect(
      primaryWindowWorkspaceStateEqual(
        primaryWindowWorkspaceStateFromStore({
          activeId: '/tmp/repo-a',
          order: ['/tmp/repo-a', '/tmp/repo-b'],
          zenMode: false,
          sessionReady: true,
        }),
        primaryWindowWorkspaceStateFromStore({
          activeId: '/tmp/repo-a',
          order: ['/tmp/repo-a', '/tmp/repo-b'],
          zenMode: false,
          sessionReady: true,
        }),
      ),
    ).toBe(true)
  })

  test('compares navigation slices structurally and resolves the active repo', () => {
    expect(
      navigationWorkspaceStateEqual(
        navigationWorkspaceStateFromStore({
          activeId: '/tmp/repo-a',
          order: ['/tmp/repo-a', '/tmp/repo-b'],
        }),
        navigationWorkspaceStateFromStore({
          activeId: '/tmp/repo-a',
          order: ['/tmp/repo-a', '/tmp/repo-b'],
        }),
      ),
    ).toBe(true)
    expect(
      activeRepoFromStore({
        activeId: '/tmp/repo-a',
        repos: {
          '/tmp/repo-a': {
            id: '/tmp/repo-a',
          } as never,
        },
      })?.id,
    ).toBe('/tmp/repo-a')
    expect(
      activeRepoFromStore({
        activeId: '/tmp/repo-missing',
        repos: {},
      }),
    ).toBeNull()
  })

  test('compares action bundles by function identity', () => {
    const fnA = () => {}
    const fnB = () => {}
    expect(
      restorableWorkspaceViewportStoreActionsFromStore({
        setActive: fnA as never,
        cycleActive: fnA as never,
      }),
    ).toEqual({
      setActive: fnA,
      cycleActive: fnA,
    })
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
        selectBranch: fnA as never,
        setWorkspacePaneTab: fnA as never,
      }),
    ).toEqual({
      closeRepo: fnA,
      selectBranch: fnA,
      setWorkspacePaneTab: fnA,
    })
    expect(
      runtimeCoherentRepoProjectionStoreActionsFromStore({
        ensureWorkspaceOpen: fnA as never,
        closeRepo: fnA as never,
        selectBranch: fnA as never,
        setWorkspacePaneTab: fnA as never,
      }),
    ).toEqual({
      ensureWorkspaceOpen: fnA,
      closeRepo: fnA,
      selectBranch: fnA,
      setWorkspacePaneTab: fnA,
    })
    expect(
      primaryWindowNavigationStoreActionsEqual(
        primaryWindowNavigationStoreActionsFromStore({
          setActive: fnA,
          closeRepo: fnA,
          cycleActive: fnA,
          selectBranch: fnA,
          setWorkspacePaneTab: fnA,
        }),
        primaryWindowNavigationStoreActionsFromStore({
          setActive: fnA,
          closeRepo: fnA,
          cycleActive: fnA,
          selectBranch: fnA,
          setWorkspacePaneTab: fnA,
        }),
      ),
    ).toBe(true)
    expect(
      repoPickerStoreActionsEqual(
        repoPickerStoreActionsFromStore({
          ensureWorkspaceOpen: fnA as never,
        }),
        repoPickerStoreActionsFromStore({
          ensureWorkspaceOpen: fnB as never,
        }),
      ),
    ).toBe(false)
    expect(
      clientEffectIntentStoreActionsEqual(
        clientEffectIntentStoreActionsFromStore({
          ensureWorkspaceOpen: fnA as never,
          setSelectedTerminal: fnA as never,
          resetLayout: fnA as never,
          toggleZenMode: fnA as never,
        }),
        clientEffectIntentStoreActionsFromStore({
          ensureWorkspaceOpen: fnA as never,
          setSelectedTerminal: fnA as never,
          resetLayout: fnB as never,
          toggleZenMode: fnA as never,
        }),
      ),
    ).toBe(false)
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
