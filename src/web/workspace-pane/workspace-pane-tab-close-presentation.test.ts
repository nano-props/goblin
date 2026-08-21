// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { workspacePaneLocationForRoot } from '#/web/workspace-pane/workspace-pane-location.ts'
import { resetWorkspacesStore, seedRepoWithReadModelForTest } from '#/web/test-utils/repo-store.ts'
import { appQueryClient } from '#/web/app/query-client.ts'
import type { AppNavigationActions } from '#/web/app/navigation/actions.ts'
import {
  appNavigationIsCurrent,
  beginAppNavigation,
  registerAppNavigation,
  resetAppNavigationForTest,
} from '#/web/app/navigation/lifecycle.ts'
import {
  observedAppNavigationActionsForTest,
  seedInitialObservedWorkspacePaneRouteForTest,
  type AppNavigationOverridesForTest,
} from '#/web/test-utils/workspace-pane-navigation.ts'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/test-utils/workspace-pane-tabs.ts'
import { terminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import {
  dispatchRetiredTerminalWorkspacePaneTabPresentationAction,
  prepareWorkspacePaneClosePresentation,
} from '#/web/workspace-pane/workspace-pane-tab-close-presentation.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { createWorkspacePaneTabModel } from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { recordWorkspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { markRepoGitUnavailable } from '#/web/app/navigation/actions.test-utils.ts'

const feedbackMocks = vi.hoisted(() => ({ warning: vi.fn() }))

vi.mock('vue-sonner', () => ({ toast: { error: vi.fn(), warning: feedbackMocks.warning } }))

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/workspace-pane-tab-close-presentation-repo')

beforeEach(() => {
  feedbackMocks.warning.mockClear()
  resetAppNavigationForTest()
  appQueryClient.clear()
  resetWorkspacesStore()
})

describe('workspace pane tab close presentation', () => {
  test('ignores a source-only opener when closing on the workspace-root surface', () => {
    const repo = seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
    markRepoGitUnavailable(REPO_ID)
    const location = workspacePaneLocationForRoot(REPO_ID, repo.workspaceRuntimeId)
    const model = createWorkspacePaneTabModel({
      location,
      preferredTab: 'status',
      allowPreferredTabFallback: false,
      tabEntries: [
        workspacePaneStaticTabEntry('status'),
        workspacePaneStaticTabEntry('changes'),
        workspacePaneStaticTabEntry('files'),
      ],
      runtimeTabViews: [],
      runtimeTabStateByType: {},
    })
    recordWorkspacePaneTabOpener(
      location.paneTarget,
      repo.workspaceRuntimeId,
      'workspace-pane:status',
      'workspace-pane:changes',
    )

    const transition = prepareWorkspacePaneClosePresentation({
      target: model,
      closingIdentity: 'workspace-pane:status',
      workspacePaneRoute: { kind: 'static', tab: 'status' },
    })

    expect(transition.nextEntry).toEqual(workspacePaneStaticTabEntry('files'))
  })

  test("projects a retired terminal's canonical before-state through the workspace-root surface", async () => {
    const { input, paneTarget, repo, sourceRoute } = retiredTerminalPresentationInput()
    const commitFilesystemWorkspacePaneRoute = vi.fn<AppNavigationActions['commitFilesystemWorkspacePaneRoute']>(
      async (_target, _route, options) => {
        options?.onCommit?.()
        return true
      },
    )

    await expect(
      dispatchRetiredTerminalWorkspacePaneTabPresentationAction({
        ...input,
        navigation: navigationWith({ commitFilesystemWorkspacePaneRoute }),
      }),
    ).resolves.toBe(true)

    expect(commitFilesystemWorkspacePaneRoute).toHaveBeenCalledWith(
      expect.objectContaining({ routeTarget: paneTarget, workspaceRuntimeId: repo.workspaceRuntimeId }),
      { kind: 'static', tab: 'files' },
      expect.objectContaining({ replace: true, routePrecondition: { kind: 'exact-route', route: sourceRoute } }),
    )
    expect(feedbackMocks.warning).not.toHaveBeenCalled()
  })

  test('does not supersede an explicit navigation with retired terminal presentation', async () => {
    const { input } = retiredTerminalPresentationInput()
    const explicitGeneration = beginAppNavigation()
    const explicitNavigation = registerAppNavigation(explicitGeneration, '/pending-explicit-navigation')
    if (!explicitNavigation) throw new Error('missing explicit navigation registration')
    const passiveCommit = vi.fn<AppNavigationActions['commitFilesystemWorkspacePaneRoute']>()

    await expect(
      dispatchRetiredTerminalWorkspacePaneTabPresentationAction({
        ...input,
        navigation: navigationWith({ commitFilesystemWorkspacePaneRoute: passiveCommit }),
      }),
    ).resolves.toBe(false)

    expect(passiveCommit).not.toHaveBeenCalled()
    expect(appNavigationIsCurrent(explicitGeneration)).toBe(true)
    explicitNavigation.release()
  })

  test('does not navigate when a background terminal exits naturally', async () => {
    const terminalSessionId = 'term-111111111111111111111'
    const repo = seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
    markRepoGitUnavailable(REPO_ID)
    terminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    const paneTarget = { kind: 'workspace-root' as const, workspaceId: REPO_ID }
    setWorkspacePaneTabsForTargetQueryData({
      ...paneTarget,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      tabs: [workspacePaneStaticTabEntry('status'), workspacePaneRuntimeTabEntry('terminal', terminalSessionId)],
    })
    const commitFilesystemWorkspacePaneRoute = vi.fn<AppNavigationActions['commitFilesystemWorkspacePaneRoute']>()

    await expect(
      dispatchRetiredTerminalWorkspacePaneTabPresentationAction({
        workspaceId: REPO_ID,
        workspacePaneRoute: { kind: 'static', tab: 'status' },
        location: workspacePaneLocationForRoot(REPO_ID, repo.workspaceRuntimeId),
        navigation: navigationWith({ commitFilesystemWorkspacePaneRoute }),
        terminalSessionId,
        tabsBeforeRetirement: [
          workspacePaneStaticTabEntry('status'),
          workspacePaneRuntimeTabEntry('terminal', terminalSessionId),
        ],
      }),
    ).resolves.toBe(false)

    expect(commitFilesystemWorkspacePaneRoute).not.toHaveBeenCalled()
  })

  test('surfaces close-back failure after a terminal retires in another client', async () => {
    const terminalSessionId = 'term-111111111111111111111'
    const repo = seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
    markRepoGitUnavailable(REPO_ID)
    terminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    const paneTarget = { kind: 'workspace-root' as const, workspaceId: REPO_ID }
    setWorkspacePaneTabsForTargetQueryData({
      ...paneTarget,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    const sourceRoute = { kind: 'terminal' as const, terminalSessionId }
    const commitFilesystemWorkspacePaneRoute = vi.fn<AppNavigationActions['commitFilesystemWorkspacePaneRoute']>(
      async () => {
        throw new Error('navigation failed')
      },
    )

    await expect(
      dispatchRetiredTerminalWorkspacePaneTabPresentationAction({
        workspaceId: REPO_ID,
        workspacePaneRoute: sourceRoute,
        location: workspacePaneLocationForRoot(REPO_ID, repo.workspaceRuntimeId),
        navigation: navigationWith({ commitFilesystemWorkspacePaneRoute }),
        terminalSessionId,
        tabsBeforeRetirement: [
          workspacePaneStaticTabEntry('status'),
          workspacePaneRuntimeTabEntry('terminal', terminalSessionId),
        ],
      }),
    ).resolves.toBe(true)

    expect(commitFilesystemWorkspacePaneRoute).toHaveBeenCalledOnce()
    expect(feedbackMocks.warning).toHaveBeenCalledWith('error.workspace-tabs-committed-projection-failed', {
      id: 'workspace-pane-tab-close-projection-failed',
    })
  })
})

function retiredTerminalPresentationInput() {
  const terminalSessionId = 'term-111111111111111111111'
  const repo = seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
  markRepoGitUnavailable(REPO_ID)
  terminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
  const paneTarget = { kind: 'workspace-root' as const, workspaceId: REPO_ID }
  setWorkspacePaneTabsForTargetQueryData({
    ...paneTarget,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    tabs: [
      workspacePaneStaticTabEntry('status'),
      workspacePaneStaticTabEntry('history'),
      workspacePaneStaticTabEntry('files'),
    ],
  })
  const sourceRoute = { kind: 'terminal' as const, terminalSessionId }
  return {
    repo,
    paneTarget,
    sourceRoute,
    input: {
      workspaceId: REPO_ID,
      workspacePaneRoute: sourceRoute,
      location: workspacePaneLocationForRoot(REPO_ID, repo.workspaceRuntimeId),
      terminalSessionId,
      tabsBeforeRetirement: [
        workspacePaneStaticTabEntry('status'),
        workspacePaneRuntimeTabEntry('terminal', terminalSessionId),
        workspacePaneStaticTabEntry('history'),
        workspacePaneStaticTabEntry('files'),
      ],
    },
  }
}

function navigationWith(overrides: AppNavigationOverridesForTest = {}): AppNavigationActions {
  seedInitialObservedWorkspacePaneRouteForTest()
  return observedAppNavigationActionsForTest({
    activateWorkspace: vi.fn(),
    closeWorkspace: vi.fn(),
    cycleWorkspace: vi.fn(),
    selectRepoBranch: vi.fn(() => true),
    showRepoBranchEmptyWorkspacePane: vi.fn(() => true),
    showRepoBranchWorkspacePaneTab: vi.fn(() => true),
    goBack: vi.fn(),
    goForward: vi.fn(),
    openSettings: vi.fn(),
    openCreateWorktree: vi.fn(),
    ...overrides,
  })
}
