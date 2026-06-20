import { describe, expect, test } from 'vitest'
import {
  keyboardRuntimeStateFromStore,
  mainWindowWorkspaceStateEqual,
  mainWindowWorkspaceStateFromStore,
  navigationWorkspaceStateEqual,
  navigationWorkspaceStateFromStore,
  activeRepoFromStore,
  restorableWorkspaceNavigationStateFromStore,
  restorableWorkspaceStateFromStore,
  runtimeCoherentRepoProjectionStateFromStore,
} from '#/web/stores/repos/selector-state.ts'
import {
  mainWindowNavigationStoreActionsEqual,
  mainWindowNavigationStoreActionsFromStore,
  rendererEffectIntentStoreActionsEqual,
  rendererEffectIntentStoreActionsFromStore,
  repoTabStoreActionsEqual,
  repoTabStoreActionsFromStore,
  restorableWorkspaceLayoutPreferenceStoreActionsFromStore,
  restorableWorkspaceLayoutStoreActionsFromStore,
  restorableWorkspaceNavigationStoreActionsFromStore,
  restorableWorkspaceOrderStoreActionsFromStore,
  restorableWorkspaceStoreActionsFromStore,
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
      mainWindowWorkspaceStateFromStore({
        activeId: '/tmp/repo',
        order: ['/tmp/repo'],
        workspaceFocused: true,
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
        workspaceFocused: false,
        workspacePaneSizes: {
          'left-right': 50,
        },
        selectedTerminalByWorktree: {
          '/tmp/repo\0/tmp/repo': 'terminal-1',
        },
        workspacePaneViewByRepo: {},
      }),
    ).toEqual({
      order: ['/tmp/repo'],
      activeId: '/tmp/repo',
      workspaceFocused: false,
      workspacePaneSizes: {
        'left-right': 50,
      },
      selectedTerminalByWorktree: {
        '/tmp/repo\0/tmp/repo': 'terminal-1',
      },
      workspacePaneViewByRepo: {},
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

  test('compares main window workspace slices structurally', () => {
    expect(
      mainWindowWorkspaceStateEqual(
        mainWindowWorkspaceStateFromStore({
          activeId: '/tmp/repo-a',
          order: ['/tmp/repo-a', '/tmp/repo-b'],
          workspaceFocused: false,
          sessionReady: true,
        }),
        mainWindowWorkspaceStateFromStore({
          activeId: '/tmp/repo-a',
          order: ['/tmp/repo-a', '/tmp/repo-b'],
          workspaceFocused: false,
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
      restorableWorkspaceStoreActionsFromStore({
        setActive: fnA as never,
        reorderRepos: fnA as never,
        cycleActive: fnA as never,
        toggleWorkspaceFocused: fnA as never,
        resetLayout: fnA as never,
        setSelectedTerminal: fnA as never,
      }),
    ).toMatchObject({
      setActive: fnA,
      reorderRepos: fnA,
      cycleActive: fnA,
      toggleWorkspaceFocused: fnA,
      resetLayout: fnA,
      setSelectedTerminal: fnA,
    })
    expect(
      restorableWorkspaceNavigationStoreActionsFromStore({
        setActive: fnA as never,
        reorderRepos: fnA as never,
        cycleActive: fnA as never,
      }),
    ).toEqual({
      setActive: fnA,
      reorderRepos: fnA,
      cycleActive: fnA,
    })
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
      restorableWorkspaceOrderStoreActionsFromStore({
        reorderRepos: fnA as never,
      }),
    ).toEqual({
      reorderRepos: fnA,
    })
    expect(
      restorableWorkspaceLayoutStoreActionsFromStore({
        toggleWorkspaceFocused: fnA as never,
        resetLayout: fnA as never,
        setSelectedTerminal: fnA as never,
      }),
    ).toEqual({
      toggleWorkspaceFocused: fnA,
      resetLayout: fnA,
      setSelectedTerminal: fnA,
    })
    expect(
      restorableWorkspaceLayoutPreferenceStoreActionsFromStore({
        toggleWorkspaceFocused: fnA as never,
        resetLayout: fnA as never,
        setSelectedTerminal: fnA as never,
      }),
    ).toEqual({
      toggleWorkspaceFocused: fnA,
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
        setWorkspacePaneView: fnA as never,
      }),
    ).toEqual({
      closeRepo: fnA,
      selectBranch: fnA,
      setWorkspacePaneView: fnA,
    })
    expect(
      runtimeCoherentRepoProjectionStoreActionsFromStore({
        ensureWorkspaceOpen: fnA as never,
        closeRepo: fnA as never,
        selectBranch: fnA as never,
        setWorkspacePaneView: fnA as never,
      }),
    ).toEqual({
      ensureWorkspaceOpen: fnA,
      closeRepo: fnA,
      selectBranch: fnA,
      setWorkspacePaneView: fnA,
    })
    expect(
      mainWindowNavigationStoreActionsEqual(
        mainWindowNavigationStoreActionsFromStore({
          setActive: fnA,
          closeRepo: fnA,
          cycleActive: fnA,
          selectBranch: fnA,
          setWorkspacePaneView: fnA,
        }),
        mainWindowNavigationStoreActionsFromStore({
          setActive: fnA,
          closeRepo: fnA,
          cycleActive: fnA,
          selectBranch: fnA,
          setWorkspacePaneView: fnA,
        }),
      ),
    ).toBe(true)
    expect(
      repoTabStoreActionsEqual(
        repoTabStoreActionsFromStore({
          ensureWorkspaceOpen: fnA as never,
          reorderRepos: fnA as never,
        }),
        repoTabStoreActionsFromStore({
          ensureWorkspaceOpen: fnA as never,
          reorderRepos: fnB as never,
        }),
      ),
    ).toBe(false)
    expect(
      rendererEffectIntentStoreActionsEqual(
        rendererEffectIntentStoreActionsFromStore({
          ensureWorkspaceOpen: fnA as never,
          setSelectedTerminal: fnA as never,
          resetLayout: fnA as never,
        }),
        rendererEffectIntentStoreActionsFromStore({
          ensureWorkspaceOpen: fnA as never,
          setSelectedTerminal: fnA as never,
          resetLayout: fnB as never,
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
