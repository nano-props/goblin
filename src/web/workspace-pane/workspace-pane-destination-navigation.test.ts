import {
  resetWorkspacesStore,
  seedRepoQueryDataForTest,
  seedRepoWithReadModelForTest,
  createRepoBranch,
} from '#/web/test-utils/repo-store.ts'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  beginWorkspacePaneDestinationPresentation,
  commitWorkspacePaneDestinationRoute,
  dispatchWorkspacePaneDestinationRoute,
  resetWorkspacePaneDestinationPresentationForTest,
} from '#/web/workspace-pane/workspace-pane-destination-navigation.ts'
import type { WorkspacePaneRouteCommitActions } from '#/web/app-navigation-actions.ts'
import { resolveWorkspacePaneDestinationTargetLease } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { resetWorkspacePaneActionQueueForTest } from '#/web/workspace-pane/workspace-pane-action-queue.ts'
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
  resetWorkspacePaneActionQueueForTest()
  resetWorkspacePaneDestinationPresentationForTest()
})

describe('workspace pane destination navigation', () => {
  test('commits branch-scoped tabs for a destination without a worktree', async () => {
    seedNoWorktreeRepo()
    const commitWorkspacePaneRoute = acceptedRouteCommit()
    const setWorkspacePaneTab = vi.spyOn(workspacesStore.getState(), 'setWorkspacePaneTab')

    await expect(
      dispatchWorkspacePaneDestinationRoute({
        workspaceId: REPO_ID,
        branchName: 'feature/no-worktree',
        route: DESTINATION_ROUTE,
        navigation: { commitWorkspacePaneRoute },
      }),
    ).resolves.toEqual({ kind: 'completed', changed: true, presentation: 'router-settled' })
    expect(commitWorkspacePaneRoute).toHaveBeenCalledOnce()
    expect(setWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/no-worktree', 'status')
  })

  test('rejects worktree-scoped tabs for a destination without a worktree', async () => {
    seedNoWorktreeRepo()
    const commitWorkspacePaneRoute = acceptedRouteCommit()

    await expect(
      dispatchWorkspacePaneDestinationRoute({
        workspaceId: REPO_ID,
        branchName: 'feature/no-worktree',
        route: { kind: 'static', tab: 'changes' },
        navigation: { commitWorkspacePaneRoute },
      }),
    ).resolves.toEqual({ kind: 'unsupported', reason: 'worktree-required' })
    expect(commitWorkspacePaneRoute).not.toHaveBeenCalled()
  })

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
      commitWorkspacePaneDestinationRoute(presentation, DESTINATION_ROUTE, { commitWorkspacePaneRoute }),
    ).resolves.toEqual({ kind: 'superseded' })
    expect(commitWorkspacePaneRoute).not.toHaveBeenCalled()
  })

  test('rejects a worktree replacement after router settlement without writing supplements', async () => {
    const repo = seedDestinationRepo()
    const presentation = beginPresentation('feature/destination')
    const routeCommit = Promise.withResolvers<boolean>()
    const routeNavigation = deferredRouteCommit(routeCommit.promise)
    const setWorkspacePaneTab = vi.spyOn(workspacesStore.getState(), 'setWorkspacePaneTab')
    const committed = commitWorkspacePaneDestinationRoute(presentation, DESTINATION_ROUTE, {
      commitWorkspacePaneRoute: routeNavigation.commit,
    })
    await routeNavigation.started
    seedRepoQueryDataForTest(repo, {
      branches: [
        createRepoBranch('feature/current', {
          worktree: { path: CURRENT_WORKTREE, isPrimary: false, isLocked: false },
        }),
        createRepoBranch('feature/destination', {
          worktree: { path: '/tmp/goblin-replaced-worktree', isPrimary: false, isLocked: false },
        }),
      ],
      currentBranch: 'feature/current',
    })
    routeCommit.resolve(true)

    await expect(committed).resolves.toEqual({ kind: 'superseded' })
    expect(setWorkspacePaneTab).not.toHaveBeenCalled()
  })

  test('commits accepted branch data after a background refresh failure', async () => {
    const repo = seedDestinationRepo()
    const presentation = beginPresentation('feature/destination')
    const routeCommit = Promise.withResolvers<boolean>()
    const routeNavigation = deferredRouteCommit(routeCommit.promise)
    const setWorkspacePaneTab = vi.spyOn(workspacesStore.getState(), 'setWorkspacePaneTab')
    const committed = commitWorkspacePaneDestinationRoute(presentation, DESTINATION_ROUTE, {
      commitWorkspacePaneRoute: routeNavigation.commit,
    })
    await routeNavigation.started
    const queryKey = repoSnapshotQueryKey(REPO_ID, repo.workspaceRuntimeId)
    const query = appQueryClient.getQueryCache().find({ queryKey, exact: true })
    if (!query) throw new Error('missing repo snapshot query')
    query.setState({ ...query.state, status: 'error', error: new Error('snapshot unavailable') })
    routeCommit.resolve(true)

    await expect(committed).resolves.toEqual({ kind: 'completed', changed: true, presentation: 'router-settled' })
    expect(setWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/destination', 'status')
  })

  test('uses a app presentation generation so the latest destination wins', async () => {
    seedDestinationRepo()
    const first = beginPresentation('feature/current')
    const firstCommit = Promise.withResolvers<boolean>()
    const firstNavigation = deferredRouteCommit(firstCommit.promise)
    const firstWork = commitWorkspacePaneDestinationRoute(first, DESTINATION_ROUTE, {
      commitWorkspacePaneRoute: firstNavigation.commit,
    })
    await firstNavigation.started

    const second = beginPresentation('feature/destination')
    await expect(
      commitWorkspacePaneDestinationRoute(second, DESTINATION_ROUTE, {
        commitWorkspacePaneRoute: acceptedRouteCommit(),
      }),
    ).resolves.toEqual({ kind: 'completed', changed: true, presentation: 'router-settled' })
    firstCommit.resolve(true)
    await expect(firstWork).resolves.toEqual({ kind: 'superseded' })
  })

  test('a current-target presentation supersedes pending destination navigation', async () => {
    seedDestinationRepo()
    const presentation = beginPresentation('feature/destination')
    const routeCommit = Promise.withResolvers<boolean>()
    const routeNavigation = deferredRouteCommit(routeCommit.promise)
    const committed = commitWorkspacePaneDestinationRoute(presentation, DESTINATION_ROUTE, {
      commitWorkspacePaneRoute: routeNavigation.commit,
    })
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
    const committed = commitWorkspacePaneDestinationRoute(presentation, DESTINATION_ROUTE, {
      commitWorkspacePaneRoute: routeNavigation.commit,
    })
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
    const committed = commitWorkspacePaneDestinationRoute(presentation, DESTINATION_ROUTE, {
      commitWorkspacePaneRoute: routeNavigation.commit,
    })
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
    const committed = commitWorkspacePaneDestinationRoute(presentation, DESTINATION_ROUTE, {
      commitWorkspacePaneRoute: routeNavigation.commit,
    })
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
    vi.mocked(routeNavigation.commitWorkspacePaneRoute).mockImplementation(
      async (_repoId, _branchName, _route, options) => {
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
    openRepoBranchTerminal: vi.fn(() => true),
    commitWorkspacePaneRoute: acceptedRouteCommit(),
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

function deferredRouteCommit(completion: Promise<boolean>) {
  const started = Promise.withResolvers<void>()
  const commit = vi.fn<WorkspacePaneRouteCommitActions['commitWorkspacePaneRoute']>(
    async (_repoId, _branchName, _route, options) => {
      started.resolve()
      const accepted = await completion
      if (accepted && (!options?.navigationGeneration || appNavigationIsCurrent(options.navigationGeneration))) {
        options?.onCommit?.()
      }
      return accepted
    },
  )
  return { commit, started: started.promise }
}

function seedNoWorktreeRepo() {
  const branch = createRepoBranch('feature/no-worktree')
  const repo = seedRepoWithReadModelForTest({
    id: REPO_ID,
    branches: [branch],
    currentBranchName: branch.name,
  })
  seedRepoQueryDataForTest(repo, { branches: [branch], currentBranch: branch.name })
}

function seedDestinationRepo() {
  const current = createRepoBranch('feature/current', {
    worktree: { path: CURRENT_WORKTREE, isPrimary: false, isLocked: false },
  })
  const destination = createRepoBranch('feature/destination', {
    worktree: { path: DESTINATION_WORKTREE, isPrimary: false, isLocked: false },
  })
  const repo = seedRepoWithReadModelForTest({
    id: REPO_ID,
    branches: [current, destination],
    currentBranchName: current.name,
  })
  seedRepoQueryDataForTest(repo, { branches: [current, destination], currentBranch: current.name })
  return repo
}
