import {
  resetWorkspacesStore,
  seedRepoQueryDataForTest,
  seedRepoWithReadModelForTest,
  createRepoBranch,
  createRepoWorktreeSnapshotForTest,
} from '#/web/test-utils/repo-store.ts'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  beginWorkspacePaneDestinationPresentation,
  commitWorkspacePaneDestinationRoute,
  resetWorkspacePaneDestinationPresentationForTest,
} from '#/web/workspace-pane/workspace-pane-destination-navigation.ts'
import type {
  FilesystemWorkspacePaneRouteCommitActions,
  WorkspacePaneRouteCommitActions,
} from '#/web/app-navigation-actions.ts'
import { resolveWorkspacePaneDestinationTargetLease } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { repoSnapshotQueryKey } from '#/web/repo-query-keys.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { createAppNavigationActions } from '#/web/app-navigation-actions.ts'
import type { AppRouteNavigation } from '#/web/app-route-navigation.ts'
import {
  beginAppNavigation,
  observeAppHistoryNavigation,
  appNavigationState,
  appNavigationIsCurrent,
  registerAppNavigation,
} from '#/web/app-navigation-lifecycle.ts'

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/goblin-destination-navigation-repo')
const CURRENT_WORKTREE = '/tmp/goblin-destination-current-worktree'
const DESTINATION_WORKTREE = '/tmp/goblin-destination-target-worktree'
const DESTINATION_ROUTE = { kind: 'static' as const, tab: 'status' as const }

beforeEach(() => {
  appQueryClient.clear()
  resetWorkspacesStore()
  resetWorkspacePaneDestinationPresentationForTest()
})

describe('workspace pane destination navigation', () => {
  test('rejects a stale runtime lease before route commit', async () => {
    seedDestinationRepo()
    const presentation = beginPresentation('feature/destination')
    workspacesStore.setState((state) => {
      const repo = state.workspaces[REPO_ID]
      if (!repo) return state
      return {
        workspaces: { ...state.workspaces, [REPO_ID]: { ...repo, workspaceRuntimeId: 'repo-runtime-reopened' } },
      }
    })
    const commitWorkspacePaneRoute = acceptedRouteCommit()

    await expect(
      commitWorkspacePaneDestinationRoute(presentation, DESTINATION_ROUTE, testNavigation(commitWorkspacePaneRoute)),
    ).resolves.toEqual({ kind: 'superseded' })
    expect(commitWorkspacePaneRoute).not.toHaveBeenCalled()
  })

  test('rejects a worktree replacement after router settlement without writing supplements', async () => {
    const repo = seedDestinationRepo()
    const presentation = beginPresentation('feature/destination')
    const routeCommit = Promise.withResolvers<boolean>()
    const routeNavigation = deferredRouteCommit(routeCommit.promise)
    const setWorkspacePaneTab = vi.spyOn(workspacesStore.getState(), 'setWorkspacePaneTab')
    const committed = commitWorkspacePaneDestinationRoute(
      presentation,
      DESTINATION_ROUTE,
      testNavigation(routeNavigation.commit, routeNavigation.commitFilesystem),
    )
    await routeNavigation.started
    seedRepoQueryDataForTest(repo, {
      branches: [createRepoBranch('feature/current'), createRepoBranch('feature/destination')],
      worktrees: [
        createRepoWorktreeSnapshotForTest('feature/current', CURRENT_WORKTREE),
        createRepoWorktreeSnapshotForTest('feature/destination', '/tmp/goblin-replaced-worktree'),
      ],
      currentBranch: 'feature/current',
    })
    routeCommit.resolve(true)

    await expect(committed).resolves.toEqual({ kind: 'superseded' })
    expect(setWorkspacePaneTab).not.toHaveBeenCalled()
  })

  test('keeps an accepted worktree destination after a background refresh failure', async () => {
    const repo = seedDestinationRepo()
    const presentation = beginPresentation('feature/destination')
    const routeCommit = Promise.withResolvers<boolean>()
    const routeNavigation = deferredRouteCommit(routeCommit.promise)
    const committed = commitWorkspacePaneDestinationRoute(
      presentation,
      DESTINATION_ROUTE,
      testNavigation(routeNavigation.commit, routeNavigation.commitFilesystem),
    )
    await routeNavigation.started
    const queryKey = repoSnapshotQueryKey(REPO_ID, repo.workspaceRuntimeId)
    const query = appQueryClient.getQueryCache().find({ queryKey, exact: true })
    if (!query) throw new Error('missing repo snapshot query')
    query.setState({ ...query.state, status: 'error', error: new Error('snapshot unavailable') })
    routeCommit.resolve(true)

    await expect(committed).resolves.toEqual({ kind: 'completed', changed: true, presentation: 'router-settled' })
    expect(routeNavigation.commit).not.toHaveBeenCalled()
    expect(routeNavigation.commitFilesystem).toHaveBeenCalledOnce()
  })

  test('uses a app presentation generation so the latest destination wins', async () => {
    seedDestinationRepo()
    const first = beginPresentation('feature/current')
    const firstCommit = Promise.withResolvers<boolean>()
    const firstNavigation = deferredRouteCommit(firstCommit.promise)
    const firstWork = commitWorkspacePaneDestinationRoute(
      first,
      DESTINATION_ROUTE,
      testNavigation(firstNavigation.commit, firstNavigation.commitFilesystem),
    )
    await firstNavigation.started

    const second = beginPresentation('feature/destination')
    await expect(
      commitWorkspacePaneDestinationRoute(
        second,
        DESTINATION_ROUTE,
        testNavigation(acceptedRouteCommit(), acceptedFilesystemRouteCommit()),
      ),
    ).resolves.toEqual({ kind: 'completed', changed: true, presentation: 'router-settled' })
    firstCommit.resolve(true)
    await expect(firstWork).resolves.toEqual({ kind: 'superseded' })
  })

  test('a current-target presentation supersedes pending destination navigation', async () => {
    seedDestinationRepo()
    const presentation = beginPresentation('feature/destination')
    const routeCommit = Promise.withResolvers<boolean>()
    const routeNavigation = deferredRouteCommit(routeCommit.promise)
    const committed = commitWorkspacePaneDestinationRoute(
      presentation,
      DESTINATION_ROUTE,
      testNavigation(routeNavigation.commit, routeNavigation.commitFilesystem),
    )
    await routeNavigation.started

    beginAppNavigation()
    routeCommit.resolve(true)

    await expect(committed).resolves.toEqual({ kind: 'superseded' })
  })

  test('Settings supersedes pending destination navigation', async () => {
    seedDestinationRepo()
    const presentation = beginPresentation('feature/destination')
    const routeCommit = Promise.withResolvers<boolean>()
    const routeNavigation = deferredRouteCommit(routeCommit.promise)
    const committed = commitWorkspacePaneDestinationRoute(
      presentation,
      DESTINATION_ROUTE,
      testNavigation(routeNavigation.commit, routeNavigation.commitFilesystem),
    )
    await routeNavigation.started

    primaryNavigationActions().actions.openSettings('general')
    routeCommit.resolve(true)

    await expect(committed).resolves.toEqual({ kind: 'superseded' })
  })

  test('another primary route supersedes pending destination navigation', async () => {
    seedDestinationRepo()
    const presentation = beginPresentation('feature/destination')
    const routeCommit = Promise.withResolvers<boolean>()
    const routeNavigation = deferredRouteCommit(routeCommit.promise)
    const committed = commitWorkspacePaneDestinationRoute(
      presentation,
      DESTINATION_ROUTE,
      testNavigation(routeNavigation.commit, routeNavigation.commitFilesystem),
    )
    await routeNavigation.started

    primaryNavigationActions().actions.activateWorkspace(workspaceIdForTest('goblin+file:///tmp/another-repo'))
    routeCommit.resolve(true)

    await expect(committed).resolves.toEqual({ kind: 'superseded' })
  })

  test('an externally observed route supersedes pending destination navigation', async () => {
    seedDestinationRepo()
    const presentation = beginPresentation('feature/destination')
    const routeCommit = Promise.withResolvers<boolean>()
    const routeNavigation = deferredRouteCommit(routeCommit.promise)
    const committed = commitWorkspacePaneDestinationRoute(
      presentation,
      DESTINATION_ROUTE,
      testNavigation(routeNavigation.commit, routeNavigation.commitFilesystem),
    )
    await routeNavigation.started

    observeAppHistoryNavigation({
      href: '/workspace/current/tab/history',
      state: {},
      action: { type: 'PUSH' },
    })
    routeCommit.resolve(true)

    await expect(committed).resolves.toEqual({ kind: 'superseded' })
  })

  test('a destination commit consumes its own route observation without self-superseding', async () => {
    seedDestinationRepo()
    const { actions, routeNavigation } = primaryNavigationActions()
    vi.mocked(routeNavigation.commitFilesystemWorkspacePaneRoute).mockImplementation(
      async (_target, _route, options) => {
        const generation = options?.navigationGeneration
        if (!generation) return false
        const href = '/workspace/destination/tab/status'
        const registration = registerAppNavigation(generation, href, options.onCommit)
        if (!registration) return false
        observeAppHistoryNavigation({
          href,
          state: appNavigationState({}, generation),
          action: { type: 'PUSH' },
        })
        return true
      },
    )

    await expect(
      commitWorkspacePaneDestinationRoute(beginPresentation('feature/destination'), DESTINATION_ROUTE, actions),
    ).resolves.toEqual({ kind: 'completed', changed: true, presentation: 'router-settled' })
  })
})

function primaryNavigationActions() {
  const store = workspacesStore.getState()
  const routeNavigation = {
    openHome: vi.fn(),
    openWorkspaceDashboard: vi.fn(),
    openWorkspaceRootPane: vi.fn(),
    openRepoBranch: vi.fn(() => true),
    openRepoBranchTab: vi.fn(() => true),
    commitWorkspacePaneRoute: acceptedRouteCommit(),
    commitFilesystemWorkspacePaneRoute: vi.fn<AppRouteNavigation['commitFilesystemWorkspacePaneRoute']>(
      async () => true,
    ),
    openRepoNewWorktree: vi.fn(),
    openSettings: vi.fn(),
  }
  return {
    routeNavigation,
    actions: createAppNavigationActions({
      currentWorkspaceId: REPO_ID,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      peekWorkspaceNavigation: store.peekWorkspaceNavigation,
      commitWorkspaceNavigation: store.commitWorkspaceNavigation,
      routeNavigation: routeNavigation as unknown as AppRouteNavigation,
    }),
  }
}

function beginPresentation(branchName: string) {
  const lease = resolveWorkspacePaneDestinationTargetLease(REPO_ID, branchName)
  if (!lease) throw new Error('missing destination lease')
  return beginWorkspacePaneDestinationPresentation(lease)
}

function acceptedRouteCommit() {
  return vi.fn<WorkspacePaneRouteCommitActions['commitWorkspacePaneRoute']>(
    async (_repoId, _branchName, _route, options) => {
      if (!options?.navigationGeneration || appNavigationIsCurrent(options.navigationGeneration)) {
        options?.onCommit?.()
      }
      return true
    },
  )
}

function acceptedFilesystemRouteCommit() {
  return vi.fn<FilesystemWorkspacePaneRouteCommitActions['commitFilesystemWorkspacePaneRoute']>(
    async (_target, _route, options) => {
      if (!options?.navigationGeneration || appNavigationIsCurrent(options.navigationGeneration)) {
        options?.onCommit?.()
      }
      return true
    },
  )
}

function testNavigation(
  commitWorkspacePaneRoute: WorkspacePaneRouteCommitActions['commitWorkspacePaneRoute'],
  commitFilesystemWorkspacePaneRoute: FilesystemWorkspacePaneRouteCommitActions['commitFilesystemWorkspacePaneRoute'] = vi.fn(
    async () => {
      throw new Error('Unexpected filesystem route commit')
    },
  ),
): FilesystemWorkspacePaneRouteCommitActions {
  return { commitWorkspacePaneRoute, commitFilesystemWorkspacePaneRoute }
}

function deferredRouteCommit(completion: Promise<boolean>) {
  const started = Promise.withResolvers<void>()
  const settle = async (
    options:
      | {
          navigationGeneration?: ReturnType<typeof beginAppNavigation>
          onCommit?: () => void
        }
      | undefined,
  ) => {
    started.resolve()
    const accepted = await completion
    if (accepted && (!options?.navigationGeneration || appNavigationIsCurrent(options.navigationGeneration))) {
      options?.onCommit?.()
    }
    return accepted
  }
  const commit = vi.fn<WorkspacePaneRouteCommitActions['commitWorkspacePaneRoute']>(
    async (_repoId, _branchName, _route, options) => await settle(options),
  )
  const commitFilesystem = vi.fn<FilesystemWorkspacePaneRouteCommitActions['commitFilesystemWorkspacePaneRoute']>(
    async (_target, _route, options) => await settle(options),
  )
  return { commit, commitFilesystem, started: started.promise }
}

function seedDestinationRepo() {
  const current = createRepoBranch('feature/current')
  const destination = createRepoBranch('feature/destination')
  const worktrees = [
    createRepoWorktreeSnapshotForTest(current.name, CURRENT_WORKTREE),
    createRepoWorktreeSnapshotForTest(destination.name, DESTINATION_WORKTREE),
  ]
  const repo = seedRepoWithReadModelForTest({
    id: REPO_ID,
    branches: [current, destination],
    worktrees,
    currentBranchName: current.name,
  })
  seedRepoQueryDataForTest(repo, { branches: [current, destination], worktrees, currentBranch: current.name })
  return repo
}
