import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  beginWorkspacePaneCloseActiveTabPresentationLease,
  commitWorkspacePaneCommittedRuntimeTargetRoute,
  commitWorkspacePaneControllerCloseBackTarget,
  commitWorkspacePaneControllerRoute,
  commitWorkspacePaneExactTargetRoute,
  selectWorkspacePaneControllerTab,
  selectWorkspacePaneControllerTabEntry,
  workspacePaneTabControllerTargetIsCurrent,
  type WorkspacePaneTabControllerCommitNavigation,
  type WorkspacePaneRouteCommitNavigation,
} from '#/web/workspace-pane/workspace-pane-tab-controller.ts'
import {
  workspacePaneRuntimeTabEntry,
  workspacePaneStaticTabEntry,
  workspacePaneStaticTabId,
  type WorkspacePaneStaticTabType,
} from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import type {
  WorkspacePaneRuntimeTab,
  WorkspacePaneStaticTab,
  WorkspacePaneTabModel,
} from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import {
  createRepoBranch,
  resetWorkspacesStore,
  seedRepoReadModelQueryData,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { beginPrimaryWindowNavigation } from '#/web/primary-window-navigation-lifecycle.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const SOURCE_ROUTE = { kind: 'static' as const, tab: 'files' as const }
const TARGET_ROUTE = { kind: 'static' as const, tab: 'status' as const }
const WORKSPACE_ID = workspaceIdForTest('goblin+file:///repo')

describe('workspace pane tab controller transactions', () => {
  beforeEach(() => {
    primaryWindowQueryClient.clear()
    resetWorkspacesStore()
    seedRepoWithReadModelForTest({
      id: WORKSPACE_ID,
      workspaceRuntimeId: 'repo-runtime-1',
      branches: [createRepoBranch('feature/a', { worktree: { path: '/worktree-a' } })],
      status: [{ path: '/worktree-a', branch: 'feature/a', isMain: false, entries: [] }],
      currentBranchName: 'feature/a',
      preferredWorkspacePaneTab: 'files',
    })
  })

  test('commits an exact target route without feature observation', async () => {
    const setWorkspacePaneTab = vi.spyOn(useWorkspacesStore.getState(), 'setWorkspacePaneTab')
    await expect(
      commitWorkspacePaneExactTargetRoute(workspacePaneTarget(), SOURCE_ROUTE, TARGET_ROUTE, committingNavigation()),
    ).resolves.toBe(true)
    expect(setWorkspacePaneTab).toHaveBeenCalledWith(WORKSPACE_ID, 'feature/a', 'status')
  })

  test('passes the observed route as a compare-and-set precondition', async () => {
    const commitWorkspacePaneRoute = vi.fn(async () => false)

    await expect(
      commitWorkspacePaneExactTargetRoute(workspacePaneTarget(), SOURCE_ROUTE, TARGET_ROUTE, {
        commitWorkspacePaneRoute,
      }),
    ).resolves.toBe(false)
    expect(commitWorkspacePaneRoute).toHaveBeenCalledWith(
      WORKSPACE_ID,
      'feature/a',
      TARGET_ROUTE,
      expect.objectContaining({ routePrecondition: { kind: 'exact-route', route: SOURCE_ROUTE } }),
    )
  })

  test('rebases an absolute selection to the current workspace target at execution time', async () => {
    const commitWorkspacePaneRoute = vi.fn(async (_repoId, _branchName, _route, options) => {
      options?.onCommit?.()
      return true
    })

    await expect(
      selectWorkspacePaneControllerTab(
        workspacePaneTarget(),
        staticTab('status'),
        controllerNavigation({
          commitWorkspacePaneRoute,
        }),
      ),
    ).resolves.toBe(true)
    expect(commitWorkspacePaneRoute).toHaveBeenCalledWith(
      WORKSPACE_ID,
      'feature/a',
      TARGET_ROUTE,
      expect.objectContaining({ routePrecondition: { kind: 'current-workspace-target' } }),
    )
  })

  test('presents a workspace-scoped tab through the workspace route', async () => {
    const commitFilesystemWorkspacePaneRoute = vi.fn(async (target, route, options) => {
      useWorkspacesStore
        .getState()
        .setWorkspacePaneTabForTarget(
          target.routeTarget,
          route?.kind === 'terminal' ? 'terminal' : route?.kind === 'static' ? route.tab : null,
        )
      options?.onCommit?.()
      return true
    })
    const navigation = controllerNavigation({ commitFilesystemWorkspacePaneRoute })

    await expect(
      selectWorkspacePaneControllerTab(
        {
          ...workspacePaneTarget(),
          routeTarget: { kind: 'workspace-root', workspaceId: WORKSPACE_ID },
          branchName: null,
          worktreePath: '/repo',
          paneTarget: { kind: 'workspace-root', workspaceId: WORKSPACE_ID },
        },
        staticTab('files'),
        navigation,
      ),
    ).resolves.toBe(true)

    expect(navigation.commitWorkspacePaneRoute).not.toHaveBeenCalled()
    expect(commitFilesystemWorkspacePaneRoute).toHaveBeenCalledWith(
      {
        routeTarget: { kind: 'workspace-root', workspaceId: WORKSPACE_ID },
        workspaceRuntimeId: 'repo-runtime-1',
        authority: { kind: 'workspace-runtime' },
      },
      { kind: 'static', tab: 'files' },
      expect.objectContaining({ navigationGeneration: expect.any(Number) }),
    )
    const targetKey = workspacePaneTabsTargetIdentityKey({
      kind: 'workspace-root',
      workspaceId: WORKSPACE_ID,
    })
    expect(
      useWorkspacesStore.getState().workspaces[WORKSPACE_ID]?.ui.preferredWorkspacePaneTabByTarget[targetKey],
    ).toBe('files')
  })

  test('does not settle terminal focus twice when direct navigation abandons', async () => {
    const onCommit = vi.fn()
    const onAbandon = vi.fn()
    const commitFilesystemWorkspacePaneRoute = vi.fn(async (_target, _route, options) => {
      options?.onAbandon?.()
      return false
    })

    await expect(
      selectWorkspacePaneControllerTab(
        {
          ...workspacePaneTarget(),
          routeTarget: { kind: 'git-worktree', workspaceId: WORKSPACE_ID, worktreePath: '/worktree-a' },
          paneTarget: {
            kind: 'git-worktree',
            workspaceId: WORKSPACE_ID,
            worktreePath: '/worktree-a',
          },
        },
        terminalTab(),
        controllerNavigation({ commitFilesystemWorkspacePaneRoute }),
        {
          navigationGeneration: beginPrimaryWindowNavigation(),
          focusEffects: { onCommit, onAbandon },
        },
      ),
    ).resolves.toBe(false)

    expect(onCommit).not.toHaveBeenCalled()
    expect(onAbandon).toHaveBeenCalledOnce()
  })

  test('does not settle terminal focus twice when committed navigation rejects', async () => {
    const onCommit = vi.fn()
    const onAbandon = vi.fn()

    await expect(
      selectWorkspacePaneControllerTab(
        workspacePaneTarget(),
        terminalTab(),
        controllerNavigation({ commitWorkspacePaneRoute: vi.fn(async () => false) }),
        {
          navigationGeneration: beginPrimaryWindowNavigation(),
          focusEffects: { onCommit, onAbandon },
        },
      ),
    ).resolves.toBe(false)

    expect(onCommit).not.toHaveBeenCalled()
    expect(onAbandon).toHaveBeenCalledOnce()
  })

  test('abandons provided terminal focus before rejecting a stale presentation', async () => {
    const staleGeneration = beginPrimaryWindowNavigation()
    beginPrimaryWindowNavigation()
    const onCommit = vi.fn()
    const onAbandon = vi.fn()
    const navigation = controllerNavigation({ commitWorkspacePaneRoute: vi.fn(async () => true) })

    await expect(
      selectWorkspacePaneControllerTab(workspacePaneTarget(), terminalTab(), navigation, {
        navigationGeneration: staleGeneration,
        focusEffects: { onCommit, onAbandon },
      }),
    ).resolves.toBe(false)

    expect(navigation.commitWorkspacePaneRoute).not.toHaveBeenCalled()
    expect(onCommit).not.toHaveBeenCalled()
    expect(onAbandon).toHaveBeenCalledOnce()
  })

  test('does not create a replacement worktree presentation after the queued generation is superseded', async () => {
    const supersededGeneration = beginPrimaryWindowNavigation()
    beginPrimaryWindowNavigation()
    const commitFilesystemWorkspacePaneRoute = vi.fn(async () => true)
    const target = {
      ...workspacePaneTarget(),
      routeTarget: { kind: 'git-worktree' as const, workspaceId: WORKSPACE_ID, worktreePath: '/worktree-a' },
      paneTarget: {
        kind: 'git-worktree' as const,
        workspaceId: WORKSPACE_ID,
        worktreePath: '/worktree-a',
      },
      tabEntries: [workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111')],
      tabs: [],
    }

    await expect(
      selectWorkspacePaneControllerTabEntry(
        target,
        workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
        controllerNavigation({ commitFilesystemWorkspacePaneRoute }),
        supersededGeneration,
      ),
    ).resolves.toBe(false)
    expect(commitFilesystemWorkspacePaneRoute).not.toHaveBeenCalled()
  })

  test('commits a server-created runtime route while the local branch label is stale', async () => {
    const navigation = committingNavigation()

    await expect(
      commitWorkspacePaneCommittedRuntimeTargetRoute(
        {
          workspaceId: WORKSPACE_ID,
          workspaceRuntimeId: 'repo-runtime-1',
          routeTarget: {
            kind: 'git-branch',
            workspaceId: WORKSPACE_ID,
            branchName: 'feature/renamed',
          },
          branchName: 'feature/renamed',
          worktreePath: '/worktree-a',
          paneTarget: {
            kind: 'git-worktree',
            workspaceId: WORKSPACE_ID,
            worktreePath: '/worktree-a',
          },
        },
        { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
        navigation,
      ),
    ).resolves.toBe(true)

    expect(navigation.commitWorkspacePaneRoute).toHaveBeenCalledWith(
      WORKSPACE_ID,
      'feature/renamed',
      { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
      expect.any(Object),
    )
    const targetKey = workspacePaneTabsTargetIdentityKey({
      kind: 'git-worktree' as const,
      workspaceId: WORKSPACE_ID,
      worktreePath: '/worktree-a',
    })
    expect(
      useWorkspacesStore.getState().workspaces[WORKSPACE_ID]?.ui.preferredWorkspacePaneTabByTarget[targetKey],
    ).toBe('terminal')
  })

  test('rejects exact target completion after its runtime is replaced', async () => {
    const commit = Promise.withResolvers<boolean>()
    const navigation: WorkspacePaneRouteCommitNavigation = {
      commitWorkspacePaneRoute: vi.fn((_repoId, _branchName, _route, options) => {
        options?.onCommit?.()
        return commit.promise
      }),
    }
    const completion = commitWorkspacePaneExactTargetRoute(
      workspacePaneTarget(),
      SOURCE_ROUTE,
      TARGET_ROUTE,
      navigation,
    )
    useWorkspacesStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [WORKSPACE_ID]: { ...state.workspaces[WORKSPACE_ID]!, workspaceRuntimeId: 'repo-runtime-2' },
      },
    }))
    commit.resolve(true)
    await expect(completion).resolves.toBe(false)
  })

  test('propagates an unexpected navigation failure', async () => {
    const onAbandon = vi.fn()
    await expect(
      commitWorkspacePaneExactTargetRoute(
        workspacePaneTarget(),
        SOURCE_ROUTE,
        TARGET_ROUTE,
        {
          commitWorkspacePaneRoute: vi.fn(async () => {
            throw new Error('router failed')
          }),
        },
        { onAbandon },
      ),
    ).rejects.toThrow('router failed')
    expect(onAbandon).toHaveBeenCalledOnce()
  })

  test('returns the navigation settlement result without owning presentation effects', async () => {
    await expect(
      commitWorkspacePaneControllerRoute(WORKSPACE_ID, 'feature/a', TARGET_ROUTE, {
        commitWorkspacePaneRoute: vi.fn(async () => true),
      }),
    ).resolves.toBe(true)
    await expect(
      commitWorkspacePaneControllerRoute(WORKSPACE_ID, 'feature/a', TARGET_ROUTE, {
        commitWorkspacePaneRoute: vi.fn(async () => false),
      }),
    ).resolves.toBe(false)
  })

  test('does not translate an unexpected route failure into a boolean result', async () => {
    await expect(
      commitWorkspacePaneControllerRoute(WORKSPACE_ID, 'feature/a', TARGET_ROUTE, {
        commitWorkspacePaneRoute: vi.fn(() => {
          throw new Error('router failed')
        }),
      }),
    ).rejects.toThrow('router failed')
  })

  test('abandons a stale navigation generation exactly once without invoking navigation', async () => {
    const staleGeneration = beginPrimaryWindowNavigation()
    beginPrimaryWindowNavigation()
    const onCommit = vi.fn()
    const onAbandon = vi.fn()
    const commitWorkspacePaneRoute = vi.fn(async () => true)

    await expect(
      commitWorkspacePaneExactTargetRoute(
        workspacePaneTarget(),
        SOURCE_ROUTE,
        TARGET_ROUTE,
        { commitWorkspacePaneRoute },
        { onCommit, onAbandon },
        staleGeneration,
      ),
    ).resolves.toBe(false)

    expect(commitWorkspacePaneRoute).not.toHaveBeenCalled()
    expect(onCommit).not.toHaveBeenCalled()
    expect(onAbandon).toHaveBeenCalledOnce()
  })

  test('rejects completion when the target worktree changes while navigation settles', async () => {
    const commit = Promise.withResolvers<boolean>()
    const navigation: WorkspacePaneRouteCommitNavigation = {
      commitWorkspacePaneRoute: vi.fn((_repoId, _branchName, _route, options) => {
        options?.onCommit?.()
        return commit.promise
      }),
    }
    const completion = commitWorkspacePaneExactTargetRoute(
      workspacePaneTarget(),
      SOURCE_ROUTE,
      TARGET_ROUTE,
      navigation,
    )
    const repo = useWorkspacesStore.getState().workspaces[WORKSPACE_ID]!
    seedRepoReadModelQueryData(repo, {
      branches: [createRepoBranch('feature/a', { worktree: { path: '/worktree-b' } })],
      currentBranch: 'feature/a',
      status: [],
    })
    commit.resolve(true)

    await expect(completion).resolves.toBe(false)
  })

  test('invalidates a worktree target when Git capability is removed from the same runtime', () => {
    const repo = useWorkspacesStore.getState().workspaces[WORKSPACE_ID]!
    if (repo.capability.kind !== 'git') throw new Error('expected Git workspace fixture')
    const gitProbe = repo.capability.probe
    useWorkspacesStore.setState({
      workspaces: {
        ...useWorkspacesStore.getState().workspaces,
        [WORKSPACE_ID]: {
          ...repo,
          capability: {
            kind: 'filesystem',
            probe: {
              ...gitProbe,
              capabilities: { ...gitProbe.capabilities, git: { status: 'unavailable' } },
            },
          },
        },
      },
    })

    expect(workspacePaneTabControllerTargetIsCurrent(workspacePaneTarget())).toBe(false)
  })

  test('commits a close-back lease through exact route completion', async () => {
    const lease = beginWorkspacePaneCloseActiveTabPresentationLease({
      target: workspacePaneTarget(),
      closingEntry: workspacePaneStaticTabEntry('files'),
      nextEntry: workspacePaneStaticTabEntry('status'),
      workspacePaneRoute: SOURCE_ROUTE,
    })
    if (!lease) throw new Error('missing presentation lease')
    await expect(commitWorkspacePaneControllerCloseBackTarget(lease, committingNavigation())).resolves.toBe(true)
  })
})

function workspacePaneTarget(): WorkspacePaneTabModel {
  return {
    workspaceId: WORKSPACE_ID,
    workspaceRuntimeId: 'repo-runtime-1',
    routeTarget: { kind: 'git-branch', workspaceId: WORKSPACE_ID, branchName: 'feature/a' },
    branchName: 'feature/a',
    worktreePath: '/worktree-a',
    paneTarget: { kind: 'git-worktree', workspaceId: WORKSPACE_ID, worktreePath: '/worktree-a' },
  } as WorkspacePaneTabModel
}

function committingNavigation(): WorkspacePaneTabControllerCommitNavigation {
  return controllerNavigation({
    commitWorkspacePaneRoute: vi.fn(async (_repoId, _branchName, _route, options) => {
      options?.onCommit?.()
      return true
    }),
  })
}

function controllerNavigation(
  overrides: Partial<WorkspacePaneTabControllerCommitNavigation>,
): WorkspacePaneTabControllerCommitNavigation {
  return {
    commitWorkspacePaneRoute: vi.fn(unexpectedNavigationAction('commitWorkspacePaneRoute')),
    commitFilesystemWorkspacePaneRoute: vi.fn(unexpectedNavigationAction('commitFilesystemWorkspacePaneRoute')),
    ...overrides,
  }
}

function unexpectedNavigationAction(name: string): () => never {
  return () => {
    throw new Error(`Unexpected workspace pane navigation action in test: ${name}`)
  }
}

function staticTab(type: WorkspacePaneStaticTabType): WorkspacePaneStaticTab {
  return { identity: workspacePaneStaticTabId(type), type, kind: 'static', view: null }
}

function terminalTab(): WorkspacePaneRuntimeTab {
  const terminalSessionId = 'term-111111111111111111111'
  return {
    identity: `terminal:${terminalSessionId}`,
    type: 'terminal',
    kind: 'runtime',
    runtimeType: 'terminal',
    sessionId: terminalSessionId,
    view: {
      type: 'terminal',
      terminalFilesystemTargetKey: 'terminal-target-test',
      terminalSessionId,
      index: 0,
      title: 'Terminal',
      phase: 'open',
      selected: true,
      hasBell: false,
      hasRecentOutput: false,
    },
  }
}
