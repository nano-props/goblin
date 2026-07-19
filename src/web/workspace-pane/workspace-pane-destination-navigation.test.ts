import { beforeEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  beginWorkspacePaneDestinationPresentation,
  commitWorkspacePaneDestinationRoute,
  dispatchWorkspacePaneDestinationRoute,
  resetWorkspacePaneDestinationPresentationForTest,
  type WorkspacePaneDestinationNavigation,
} from '#/web/workspace-pane/workspace-pane-destination-navigation.ts'
import { resolveWorkspacePaneDestinationTargetLease } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { resetWorkspacePaneActionQueueForTest } from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import {
  createRepoBranch,
  resetWorkspacesStore,
  seedRepoReadModelQueryData,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { createPrimaryWindowNavigationActions } from '#/web/primary-window-navigation-actions.ts'
import type { PrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'
import {
  beginPrimaryWindowPresentation,
  observePrimaryWindowHistoryNavigation,
  primaryWindowNavigationState,
  primaryWindowPresentationIsCurrent,
  registerPrimaryWindowNavigation,
} from '#/web/primary-window-presentation.ts'

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/goblin-destination-navigation-repo')
const CURRENT_WORKTREE = '/tmp/goblin-destination-current-worktree'
const DESTINATION_WORKTREE = '/tmp/goblin-destination-target-worktree'
const DESTINATION_ROUTE = { kind: 'static' as const, tab: 'status' as const }

beforeEach(() => {
  primaryWindowQueryClient.clear()
  resetWorkspacesStore()
  resetWorkspacePaneActionQueueForTest()
  resetWorkspacePaneDestinationPresentationForTest()
})

describe('workspace pane destination navigation', () => {
  test('commits branch-scoped tabs for a destination without a worktree', async () => {
    seedNoWorktreeRepo()
    const commitWorkspacePaneRoute = acceptedRouteCommit()
    const setWorkspacePaneTab = vi.spyOn(useWorkspacesStore.getState(), 'setWorkspacePaneTab')

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
    useWorkspacesStore.setState((state) => {
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
    const commitWorkspacePaneRoute = deferredRouteCommit(routeCommit.promise)
    const setWorkspacePaneTab = vi.spyOn(useWorkspacesStore.getState(), 'setWorkspacePaneTab')
    const committed = commitWorkspacePaneDestinationRoute(presentation, DESTINATION_ROUTE, {
      commitWorkspacePaneRoute,
    })
    await Promise.resolve()
    seedRepoReadModelQueryData(repo, {
      branches: [
        createRepoBranch('feature/current', { worktree: { path: CURRENT_WORKTREE } }),
        createRepoBranch('feature/destination', { worktree: { path: '/tmp/goblin-replaced-worktree' } }),
      ],
      currentBranch: 'feature/current',
    })
    routeCommit.resolve(true)

    await expect(committed).resolves.toEqual({ kind: 'superseded' })
    expect(setWorkspacePaneTab).not.toHaveBeenCalled()
  })

  test('uses a primary-window presentation generation so the latest destination wins', async () => {
    seedDestinationRepo()
    const first = beginPresentation('feature/current')
    const firstCommit = Promise.withResolvers<boolean>()
    const firstNavigation = deferredRouteCommit(firstCommit.promise)
    const firstWork = commitWorkspacePaneDestinationRoute(first, DESTINATION_ROUTE, {
      commitWorkspacePaneRoute: firstNavigation,
    })
    await Promise.resolve()

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
    const committed = commitWorkspacePaneDestinationRoute(presentation, DESTINATION_ROUTE, {
      commitWorkspacePaneRoute: deferredRouteCommit(routeCommit.promise),
    })
    await Promise.resolve()

    beginPrimaryWindowPresentation()
    routeCommit.resolve(true)

    await expect(committed).resolves.toEqual({ kind: 'superseded' })
  })

  test('Settings supersedes pending destination navigation', async () => {
    seedDestinationRepo()
    const presentation = beginPresentation('feature/destination')
    const routeCommit = Promise.withResolvers<boolean>()
    const committed = commitWorkspacePaneDestinationRoute(presentation, DESTINATION_ROUTE, {
      commitWorkspacePaneRoute: deferredRouteCommit(routeCommit.promise),
    })
    await Promise.resolve()

    primaryNavigationActions().actions.openSettings('general')
    routeCommit.resolve(true)

    await expect(committed).resolves.toEqual({ kind: 'superseded' })
  })

  test('another primary route supersedes pending destination navigation', async () => {
    seedDestinationRepo()
    const presentation = beginPresentation('feature/destination')
    const routeCommit = Promise.withResolvers<boolean>()
    const committed = commitWorkspacePaneDestinationRoute(presentation, DESTINATION_ROUTE, {
      commitWorkspacePaneRoute: deferredRouteCommit(routeCommit.promise),
    })
    await Promise.resolve()

    primaryNavigationActions().actions.activateWorkspace(workspaceIdForTest('goblin+file:///tmp/another-repo'))
    routeCommit.resolve(true)

    await expect(committed).resolves.toEqual({ kind: 'superseded' })
  })

  test('an externally observed route supersedes pending destination navigation', async () => {
    seedDestinationRepo()
    const presentation = beginPresentation('feature/destination')
    const routeCommit = Promise.withResolvers<boolean>()
    const committed = commitWorkspacePaneDestinationRoute(presentation, DESTINATION_ROUTE, {
      commitWorkspacePaneRoute: deferredRouteCommit(routeCommit.promise),
    })
    await Promise.resolve()

    observePrimaryWindowHistoryNavigation({
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
        const token = options?.presentationToken
        if (!token) return false
        const href = '/workspace/destination/tab/status'
        const navigationId = registerPrimaryWindowNavigation(token, href, options.onCommit)
        if (!navigationId) return false
        observePrimaryWindowHistoryNavigation({
          href,
          state: primaryWindowNavigationState({}, navigationId),
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
  const store = useWorkspacesStore.getState()
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
    actions: createPrimaryWindowNavigationActions({
      currentWorkspaceId: REPO_ID,
      workspaceOrder: [REPO_ID],
      closeWorkspace: vi.fn(),
      peekWorkspaceNavigation: store.peekWorkspaceNavigation,
      commitWorkspaceNavigation: store.commitWorkspaceNavigation,
      routeNavigation: routeNavigation as unknown as PrimaryWindowRouteNavigation,
    }),
  }
}

function beginPresentation(branchName: string) {
  const lease = resolveWorkspacePaneDestinationTargetLease(REPO_ID, branchName)
  if (!lease) throw new Error('missing destination lease')
  return beginWorkspacePaneDestinationPresentation(lease)
}

function acceptedRouteCommit() {
  return vi.fn<WorkspacePaneDestinationNavigation['commitWorkspacePaneRoute']>(
    async (_repoId, _branchName, _route, options) => {
      if (!options?.presentationToken || primaryWindowPresentationIsCurrent(options.presentationToken)) {
        options?.onCommit?.()
      }
      return true
    },
  )
}

function deferredRouteCommit(completion: Promise<boolean>) {
  return vi.fn<WorkspacePaneDestinationNavigation['commitWorkspacePaneRoute']>(
    async (_repoId, _branchName, _route, options) => {
      const accepted = await completion
      if (accepted && (!options?.presentationToken || primaryWindowPresentationIsCurrent(options.presentationToken))) {
        options?.onCommit?.()
      }
      return accepted
    },
  )
}

function seedNoWorktreeRepo() {
  const branch = createRepoBranch('feature/no-worktree')
  const repo = seedRepoWithReadModelForTest({
    id: REPO_ID,
    branches: [branch],
    currentBranchName: branch.name,
  })
  seedRepoReadModelQueryData(repo, { branches: [branch], currentBranch: branch.name })
}

function seedDestinationRepo() {
  const current = createRepoBranch('feature/current', { worktree: { path: CURRENT_WORKTREE } })
  const destination = createRepoBranch('feature/destination', { worktree: { path: DESTINATION_WORKTREE } })
  const repo = seedRepoWithReadModelForTest({
    id: REPO_ID,
    branches: [current, destination],
    currentBranchName: current.name,
  })
  seedRepoReadModelQueryData(repo, { branches: [current, destination], currentBranch: current.name })
  return repo
}
