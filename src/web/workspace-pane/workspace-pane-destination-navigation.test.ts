import { beforeEach, describe, expect, test, vi } from 'vitest'
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
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  createRepoBranch,
  resetReposStore,
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

const REPO_ID = 'goblin+file:///tmp/goblin-destination-navigation-repo'
const CURRENT_WORKTREE = '/tmp/goblin-destination-current-worktree'
const DESTINATION_WORKTREE = '/tmp/goblin-destination-target-worktree'
const DESTINATION_ROUTE = { kind: 'static' as const, tab: 'status' as const }

beforeEach(() => {
  primaryWindowQueryClient.clear()
  resetReposStore()
  resetWorkspacePaneActionQueueForTest()
  resetWorkspacePaneDestinationPresentationForTest()
})

describe('workspace pane destination navigation', () => {
  test('commits branch-scoped tabs for a destination without a worktree', async () => {
    seedNoWorktreeRepo()
    const commitRepoBranchWorkspacePaneRoute = acceptedRouteCommit()
    const setWorkspacePaneTab = vi.spyOn(useReposStore.getState(), 'setWorkspacePaneTab')

    await expect(
      dispatchWorkspacePaneDestinationRoute({
        repoId: REPO_ID,
        branchName: 'feature/no-worktree',
        route: DESTINATION_ROUTE,
        navigation: { commitRepoBranchWorkspacePaneRoute },
      }),
    ).resolves.toEqual({ kind: 'completed', changed: true, presentation: 'router-settled' })
    expect(commitRepoBranchWorkspacePaneRoute).toHaveBeenCalledOnce()
    expect(setWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/no-worktree', 'status')
  })

  test('rejects worktree-scoped tabs for a destination without a worktree', async () => {
    seedNoWorktreeRepo()
    const commitRepoBranchWorkspacePaneRoute = acceptedRouteCommit()

    await expect(
      dispatchWorkspacePaneDestinationRoute({
        repoId: REPO_ID,
        branchName: 'feature/no-worktree',
        route: { kind: 'static', tab: 'changes' },
        navigation: { commitRepoBranchWorkspacePaneRoute },
      }),
    ).resolves.toEqual({ kind: 'unsupported', reason: 'worktree-required' })
    expect(commitRepoBranchWorkspacePaneRoute).not.toHaveBeenCalled()
  })

  test('rejects a stale runtime lease before route commit', async () => {
    seedDestinationRepo()
    const presentation = beginPresentation('feature/destination')
    useReposStore.setState((state) => {
      const repo = state.repos[REPO_ID]
      if (!repo) return state
      return { repos: { ...state.repos, [REPO_ID]: { ...repo, repoRuntimeId: 'repo-runtime-reopened' } } }
    })
    const commitRepoBranchWorkspacePaneRoute = acceptedRouteCommit()

    await expect(
      commitWorkspacePaneDestinationRoute(presentation, DESTINATION_ROUTE, { commitRepoBranchWorkspacePaneRoute }),
    ).resolves.toEqual({ kind: 'superseded' })
    expect(commitRepoBranchWorkspacePaneRoute).not.toHaveBeenCalled()
  })

  test('rejects a worktree replacement after router settlement without writing supplements', async () => {
    const repo = seedDestinationRepo()
    const presentation = beginPresentation('feature/destination')
    const routeCommit = Promise.withResolvers<boolean>()
    const commitRepoBranchWorkspacePaneRoute = deferredRouteCommit(routeCommit.promise)
    const setWorkspacePaneTab = vi.spyOn(useReposStore.getState(), 'setWorkspacePaneTab')
    const committed = commitWorkspacePaneDestinationRoute(presentation, DESTINATION_ROUTE, {
      commitRepoBranchWorkspacePaneRoute,
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
      commitRepoBranchWorkspacePaneRoute: firstNavigation,
    })
    await Promise.resolve()

    const second = beginPresentation('feature/destination')
    await expect(
      commitWorkspacePaneDestinationRoute(second, DESTINATION_ROUTE, {
        commitRepoBranchWorkspacePaneRoute: acceptedRouteCommit(),
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
      commitRepoBranchWorkspacePaneRoute: deferredRouteCommit(routeCommit.promise),
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
      commitRepoBranchWorkspacePaneRoute: deferredRouteCommit(routeCommit.promise),
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
      commitRepoBranchWorkspacePaneRoute: deferredRouteCommit(routeCommit.promise),
    })
    await Promise.resolve()

    primaryNavigationActions().actions.activateRepo('/tmp/another-repo')
    routeCommit.resolve(true)

    await expect(committed).resolves.toEqual({ kind: 'superseded' })
  })

  test('an externally observed route supersedes pending destination navigation', async () => {
    seedDestinationRepo()
    const presentation = beginPresentation('feature/destination')
    const routeCommit = Promise.withResolvers<boolean>()
    const committed = commitWorkspacePaneDestinationRoute(presentation, DESTINATION_ROUTE, {
      commitRepoBranchWorkspacePaneRoute: deferredRouteCommit(routeCommit.promise),
    })
    await Promise.resolve()

    observePrimaryWindowHistoryNavigation({
      href: '/repo/current/tab/history',
      state: {},
      action: { type: 'PUSH' },
    })
    routeCommit.resolve(true)

    await expect(committed).resolves.toEqual({ kind: 'superseded' })
  })

  test('a destination commit consumes its own route observation without self-superseding', async () => {
    seedDestinationRepo()
    const { actions, routeNavigation } = primaryNavigationActions()
    vi.mocked(routeNavigation.commitRepoBranchWorkspacePaneRoute).mockImplementation(async (_repoId, _branchName, _route, options) => {
      const token = options?.presentationToken
      if (!token) return false
      const href = '/repo/destination/tab/status'
      const navigationId = registerPrimaryWindowNavigation(token, href, options.onCommit)
      if (!navigationId) return false
      observePrimaryWindowHistoryNavigation({
        href,
        state: primaryWindowNavigationState({}, navigationId),
        action: { type: 'PUSH' },
      })
      return true
    })

    await expect(
      commitWorkspacePaneDestinationRoute(beginPresentation('feature/destination'), DESTINATION_ROUTE, actions),
    ).resolves.toEqual({ kind: 'completed', changed: true, presentation: 'router-settled' })
  })
})

function primaryNavigationActions() {
  const store = useReposStore.getState()
  const routeNavigation = {
    openHome: vi.fn(),
    openRepoDashboard: vi.fn(),
    openRepoBranch: vi.fn(() => true),
    openRepoBranchTab: vi.fn(() => true),
    openRepoBranchTerminal: vi.fn(() => true),
    commitRepoBranchWorkspacePaneRoute: acceptedRouteCommit(),
    openRepoNewWorktree: vi.fn(),
    openSettings: vi.fn(),
  }
  return {
    routeNavigation,
    actions: createPrimaryWindowNavigationActions({
      currentRepoId: REPO_ID,
      order: [REPO_ID],
      closeRepo: vi.fn(),
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
  return vi.fn<WorkspacePaneDestinationNavigation['commitRepoBranchWorkspacePaneRoute']>(
    async (_repoId, _branchName, _route, options) => {
      if (!options?.presentationToken || primaryWindowPresentationIsCurrent(options.presentationToken)) {
        options?.onCommit?.()
      }
      return true
    },
  )
}

function deferredRouteCommit(completion: Promise<boolean>) {
  return vi.fn<WorkspacePaneDestinationNavigation['commitRepoBranchWorkspacePaneRoute']>(
    async (_repoId, _branchName, _route, options) => {
      const accepted = await completion
      if (
        accepted &&
        (!options?.presentationToken || primaryWindowPresentationIsCurrent(options.presentationToken))
      ) {
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
