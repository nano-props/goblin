// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { resetWorkspacesStore, seedRepoWithReadModelForTest } from '#/web/test-utils/repo-store.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'
import {
  appNavigationIsCurrent,
  beginAppNavigation,
  registerAppNavigation,
  resetAppNavigationForTest,
} from '#/web/app-navigation-lifecycle.ts'
import {
  observedAppNavigationActionsForTest,
  seedInitialObservedWorkspacePaneRouteForTest,
  type AppNavigationOverridesForTest,
} from '#/web/test-utils/workspace-pane-navigation.ts'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/test-utils/workspace-pane-tabs.ts'
import { terminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { dispatchRetiredTerminalWorkspacePaneTabPresentationAction } from '#/web/workspace-pane/workspace-pane-tab-close-presentation.ts'

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
  test('presents a naturally exited terminal from the server-captured before-state', async () => {
    const terminalSessionId = 'term-111111111111111111111'
    const repo = seedRepoWithReadModelForTest({ id: REPO_ID, branches: [], currentBranchName: null })
    terminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    const paneTarget = { kind: 'workspace-root' as const, workspaceId: REPO_ID }
    setWorkspacePaneTabsForTargetQueryData({
      ...paneTarget,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      tabs: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
    })
    const sourceRoute = { kind: 'terminal' as const, terminalSessionId }
    const commitFilesystemWorkspacePaneRoute = vi.fn<AppNavigationActions['commitFilesystemWorkspacePaneRoute']>(
      async (_target, _route, options) => {
        options?.onCommit?.()
        return true
      },
    )
    const input = {
      workspaceId: REPO_ID,
      workspacePaneRoute: sourceRoute,
      routeTarget: paneTarget,
      paneTarget,
      terminalSessionId,
      tabsBeforeRetirement: [
        workspacePaneStaticTabEntry('status'),
        workspacePaneRuntimeTabEntry('terminal', terminalSessionId),
        workspacePaneStaticTabEntry('files'),
      ],
    }

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

    resetAppNavigationForTest()
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
        routeTarget: paneTarget,
        paneTarget,
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
        routeTarget: paneTarget,
        paneTarget,
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

function navigationWith(overrides: AppNavigationOverridesForTest = {}): AppNavigationActions {
  seedInitialObservedWorkspacePaneRouteForTest()
  return observedAppNavigationActionsForTest({
    activateWorkspace: vi.fn(),
    closeWorkspace: vi.fn(),
    cycleWorkspace: vi.fn(),
    selectRepoBranch: vi.fn(() => true),
    showRepoBranchEmptyWorkspacePane: vi.fn(() => true),
    showRepoBranchWorkspacePaneTab: vi.fn(() => true),
    showRepoBranchTerminalSession: vi.fn(() => true),
    showWorkspaceRootPaneTab: vi.fn((_repoId, _presentation, options) => {
      options?.onCommit?.()
      return true
    }),
    goBack: vi.fn(),
    goForward: vi.fn(),
    openSettings: vi.fn(),
    openCreateWorktree: vi.fn(),
    ...overrides,
  })
}
