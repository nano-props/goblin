// @vitest-environment jsdom

import { seedRepoWithReadModelForTest, createBranchSnapshot } from '#/web/test-utils/repo-store.ts'
import { act, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { waitForNextMacrotask } from '#/test-utils/microtasks.ts'
import { WorkspacePane } from '#/web/components/workspace-pane/WorkspacePane.tsx'
import {
  EMPTY_TERMINAL_FILESYSTEM_TARGET_SNAPSHOT,
  TerminalSessionContext,
  TerminalSessionReadContext,
} from '#/web/components/terminal/terminal-session-context.ts'
import type { TerminalSessionReadContextValue } from '#/web/components/terminal/types.ts'
import {
  terminalExecutionPath,
  terminalPresentationBranch,
  terminalSessionCoordinates,
  type TerminalSessionBase,
} from '#/shared/terminal-types.ts'
import {
  PrimaryWindowNavigationProvider,
  type PrimaryWindowNavigationActions,
} from '#/web/primary-window-navigation.tsx'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { setRepoProjectionQueryData } from '#/web/repo-query-cache.ts'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/test-utils/workspace-pane-tabs.ts'
import {
  createTerminalWithAdmissionForContextTest,
  terminalSessionContextForTest,
} from '#/web/test-utils/terminal-session-context.ts'
import { setTerminalSessionCommandBridgeForTest } from '#/web/test-utils/terminal-session-command-bridge.ts'
import type { WorkspacePaneRoute } from '#/web/App.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import {
  REPO_ID,
  directoryWorkspaceProbe,
  historyRestoreOptions,
  navigation,
  navigationWithStore,
  presentationOptions,
  render,
  routeNavigation,
  terminalCommandContext,
  terminalReadContext,
  terminalReadContextWithSession,
  terminalReadContextWithSessions,
  workspacePaneTabsTestBridge,
} from '#/web/test-utils/workspace-pane.tsx'

const responsiveMocks = vi.hoisted(() => ({ compact: false }))
vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useIsCompactUi: () => responsiveMocks.compact,
}))

beforeEach(() => {
  responsiveMocks.compact = false
})

describe('WorkspacePane terminal routes', () => {
  test('selects an existing workspace-root terminal after Files without a route transition', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/plain-terminal-workspace')
    const terminalSessionId = 'term-333333333333333333333'
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: directoryWorkspaceProbe(),
    })
    setWorkspacePaneTabsForTargetQueryData({
      kind: 'workspace-root',
      workspaceId: workspaceId,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      tabs: [workspacePaneStaticTabEntry('files'), workspacePaneRuntimeTabEntry('terminal', terminalSessionId)],
    })
    useWorkspacesStore
      .getState()
      .setWorkspacePaneTabForTarget({ kind: 'workspace-root', workspaceId: workspaceId }, 'files')
    const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKeyForPath(workspaceId, workspaceId)
    const closeTerminalByDescriptor = vi.fn(async () => {
      setWorkspacePaneTabsForTargetQueryData({
        kind: 'workspace-root',
        workspaceId: workspaceId,
        workspaceRuntimeId: repo.workspaceRuntimeId,
        tabs: [workspacePaneStaticTabEntry('files')],
      })
      return true
    })
    const workspaceTerminalCommands = terminalSessionContextForTest({
      ...terminalCommandContext,
      closeTerminalByDescriptor,
    })
    const workspaceTerminalReadContext = terminalReadContextWithSession(terminalFilesystemTargetKey, terminalSessionId)
    const resetTerminalCommandBridge = setTerminalSessionCommandBridgeForTest({
      terminalFilesystemTargetSnapshot: workspaceTerminalReadContext.terminalFilesystemTargetSnapshot,
      createTerminal: terminalCommandContext.createTerminal,
      selectTerminal: terminalCommandContext.selectTerminal,
      focusTerminal: workspaceTerminalCommands.focusTerminal,
      closeTerminalByDescriptor,
    })
    const commitFilesystemWorkspacePaneRoute = vi.fn<
      PrimaryWindowNavigationActions['commitFilesystemWorkspacePaneRoute']
    >(async (_target, route, options) => {
      if (route?.kind === 'terminal') {
        useWorkspacesStore.getState().setSelectedTerminal(terminalFilesystemTargetKey, route.terminalSessionId)
      }
      useWorkspacesStore
        .getState()
        .setWorkspacePaneTabForTarget(
          { kind: 'workspace-root', workspaceId: workspaceId },
          route?.kind === 'terminal' ? 'terminal' : route?.kind === 'static' ? route.tab : null,
        )
      options?.onCommit?.()
      return true
    })
    const workspaceNavigation: PrimaryWindowNavigationActions = {
      ...navigation,
      commitFilesystemWorkspacePaneRoute,
    }

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={workspaceNavigation}>
          <TerminalSessionContext value={workspaceTerminalCommands}>
            <TerminalSessionReadContext value={workspaceTerminalReadContext}>
              <WorkspacePane
                workspaceId={workspaceId}
                workspacePaneRouteContext={{ kind: 'workspace-root', route: null }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    expect(screen.getByRole('tabpanel', { name: 'tab.files' })).toBeTruthy()
    const terminalTab = screen.getByRole('tab', { name: terminalSessionId })
    act(() => terminalTab.click())

    expect(commitFilesystemWorkspacePaneRoute).toHaveBeenCalled()

    await waitFor(() => expect(screen.getByRole('tabpanel', { name: 'tab.terminal' })).toBeTruthy())
    expect(
      useWorkspacesStore.getState().selectedTerminalSessionIdByTerminalFilesystemTarget[terminalFilesystemTargetKey],
    ).toBe(terminalSessionId)

    const terminalChrome = document.querySelector(
      `[data-workspace-pane-tab-tooltip-id="terminal:${terminalSessionId}"]`,
    )
    const closeButton = terminalChrome
      ? Array.from(terminalChrome.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
          (button.getAttribute('aria-label') ?? '').startsWith('terminal.close-named'),
        )
      : null
    expect(closeButton).not.toBeNull()
    act(() => closeButton?.click())

    await waitFor(() => expect(closeTerminalByDescriptor).toHaveBeenCalledWith(terminalSessionId, expect.any(Object)))
    await waitFor(() => expect(screen.getByRole('tabpanel', { name: 'tab.files' })).toBeTruthy())
    expect(screen.queryByRole('tab', { name: terminalSessionId })).toBeNull()
    resetTerminalCommandBridge()
  })

  test('keeps an unexplained missing workspace-root terminal URL as an empty presentation', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/plain-terminal-exit-workspace')
    const retainedSessionId = 'term-111111111111111111111'
    const exitedSessionId = 'term-222222222222222222222'
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: directoryWorkspaceProbe(),
    })
    const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKeyForPath(workspaceId, workspaceId)
    useTerminalProjectionHydrationStore.getState().markProjectionReady(workspaceId, repo.workspaceRuntimeId)
    setWorkspacePaneTabsForTargetQueryData({
      kind: 'workspace-root',
      workspaceId,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      tabs: [
        workspacePaneRuntimeTabEntry('terminal', retainedSessionId),
        workspacePaneRuntimeTabEntry('terminal', exitedSessionId),
      ],
    })
    const commitFilesystemWorkspacePaneRoute = vi.fn<
      PrimaryWindowNavigationActions['commitFilesystemWorkspacePaneRoute']
    >(async () => false)
    const workspaceNavigation = { ...navigation, commitFilesystemWorkspacePaneRoute }
    const workspace = (readContext: TerminalSessionReadContextValue, routeSessionId = exitedSessionId) => (
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={workspaceNavigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={readContext}>
              <WorkspacePane
                workspaceId={workspaceId}
                workspacePaneRouteContext={{
                  kind: 'workspace-root',
                  route: { kind: 'terminal', terminalSessionId: routeSessionId },
                }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>
    )
    const { rerender } = render(
      workspace(
        terminalReadContextWithSessions(
          terminalFilesystemTargetKey,
          [retainedSessionId, exitedSessionId],
          exitedSessionId,
        ),
      ),
    )

    await waitFor(() =>
      expect(useWorkspacesStore.getState().navigationHistoryByWorkspace[workspaceId]?.current).toEqual({
        workspaceId,
        route: { kind: 'workspace-root', workspacePaneTab: 'terminal', terminalSessionId: exitedSessionId },
      }),
    )

    act(() => {
      setWorkspacePaneTabsForTargetQueryData({
        kind: 'workspace-root',
        workspaceId,
        workspaceRuntimeId: repo.workspaceRuntimeId,
        tabs: [workspacePaneRuntimeTabEntry('terminal', retainedSessionId)],
      })
      rerender(workspace(terminalReadContextWithSession(terminalFilesystemTargetKey, retainedSessionId)))
    })

    expect(screen.getByText('workspace-pane-tabs.empty')).toBeTruthy()
    expect(commitFilesystemWorkspacePaneRoute).not.toHaveBeenCalled()
    expect(useWorkspacesStore.getState().navigationHistoryByWorkspace[workspaceId]?.current).toEqual({
      workspaceId,
      route: { kind: 'workspace-root', workspacePaneTab: 'terminal', terminalSessionId: exitedSessionId },
    })
  })

  test('does not navigate a missing filesystem route after unrelated metadata changes', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/rejected-terminal-route-workspace')
    const retainedSessionId = 'term-111111111111111111111'
    const exitedSessionId = 'term-222222222222222222222'
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: directoryWorkspaceProbe(),
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(workspaceId, repo.workspaceRuntimeId)
    setWorkspacePaneTabsForTargetQueryData({
      kind: 'workspace-root',
      workspaceId,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      tabs: [workspacePaneStaticTabEntry('files'), workspacePaneRuntimeTabEntry('terminal', retainedSessionId)],
    })
    const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKeyForPath(workspaceId, workspaceId)
    const commitFilesystemWorkspacePaneRoute = vi.fn<
      PrimaryWindowNavigationActions['commitFilesystemWorkspacePaneRoute']
    >(async () => false)
    const actions = { ...navigation, commitFilesystemWorkspacePaneRoute }
    const workspace = (readContext: TerminalSessionReadContextValue) => (
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={actions}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={readContext}>
              <WorkspacePane
                workspaceId={workspaceId}
                workspacePaneRouteContext={{
                  kind: 'workspace-root',
                  route: { kind: 'terminal', terminalSessionId: exitedSessionId },
                }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>
    )

    const { rerender } = render(
      workspace(
        terminalReadContextWithSessions(terminalFilesystemTargetKey, [retainedSessionId], retainedSessionId, {
          sessionTitles: { [retainedSessionId]: 'shell before metadata update' },
        }),
      ),
    )

    await act(async () => {
      rerender(
        workspace(
          terminalReadContextWithSessions(terminalFilesystemTargetKey, [retainedSessionId], retainedSessionId, {
            sessionTitles: { [retainedSessionId]: 'shell after metadata update' },
          }),
        ),
      )
      await Promise.resolve()
    })
    expect(commitFilesystemWorkspacePaneRoute).not.toHaveBeenCalled()
  })

  test('renders the shared empty pane when every workspace-root tab is closed', () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/empty-plain-workspace')
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: directoryWorkspaceProbe(),
    })
    setWorkspacePaneTabsForTargetQueryData({
      kind: 'workspace-root',
      workspaceId: workspaceId,
      workspaceRuntimeId: repo.workspaceRuntimeId,

      tabs: [],
    })

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane workspaceId={workspaceId} workspacePaneRouteContext={{ kind: 'routed', route: null }} />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    expect(screen.getByText('workspace-pane-tabs.empty')).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'tab.files' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'tab.status' })).toBeNull()
    expect(screen.queryByRole('tree')).toBeNull()
  })

  test('forwards compact missing-branch recovery to the workspace navigation callback', () => {
    responsiveMocks.compact = true
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [],
      currentBranchName: null,
    })
    setRepoProjectionQueryData(REPO_ID, repo.workspaceRuntimeId, 'feature/removed', 'full', {
      snapshot: { branches: [], current: '' },
      pullRequests: null,
      requested: { branch: 'feature/removed', pullRequestMode: 'full' },
      loadedAt: Date.now(),
    })
    const onBackToBranchNavigator = vi.fn()

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName="feature/removed"
                workspacePaneRouteContext={{ kind: 'routed', route: null }}
                onBackToBranchNavigator={onBackToBranchNavigator}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    screen.getByRole('button', { name: 'branches.back-to-list' }).click()
    expect(onBackToBranchNavigator).toHaveBeenCalledOnce()
  })

  test('records workspace history when creating a terminal from the status tab', async () => {
    const worktreePath = '/tmp/repo-workspace-container-repo-a'
    const branch = createBranchSnapshot('feature/a', { worktree: { path: worktreePath } })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [branch],
      currentBranchName: 'feature/a',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/a': [workspacePaneStaticTabEntry('status')],
      },
      status: [{ path: worktreePath, branch: 'feature/a', isMain: false, entries: [] }],
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKeyForPath(REPO_ID, worktreePath)
    const statusEntry = {
      workspaceId: REPO_ID,
      route: {
        kind: 'branch' as const,
        branchName: 'feature/a',
        workspacePaneTab: 'status' as const,
        terminalFilesystemTargetKey,
        terminalSessionId: null,
      },
    }
    const terminalEntry = {
      workspaceId: REPO_ID,
      route: {
        kind: 'branch' as const,
        branchName: 'feature/a',
        workspacePaneTab: 'terminal' as const,
        terminalFilesystemTargetKey,
        terminalSessionId: 'term-111111111111111111111',
      },
    }
    let terminalCreated = false
    const terminalListeners = new Set<() => void>()
    const createdTerminalReadContext = terminalReadContextWithSession(
      terminalFilesystemTargetKey,
      'term-111111111111111111111',
    )
    const readContext: TerminalSessionReadContextValue = {
      ...terminalReadContext,
      terminalFilesystemTargetSnapshot: (key) =>
        terminalCreated
          ? createdTerminalReadContext.terminalFilesystemTargetSnapshot(key)
          : EMPTY_TERMINAL_FILESYSTEM_TARGET_SNAPSHOT,
      subscribeTerminalFilesystemTarget: (_key, listener) => {
        terminalListeners.add(listener)
        return () => terminalListeners.delete(listener)
      },
    }
    const createTerminal = vi.fn(async (base: TerminalSessionBase) => {
      const terminalSessionId = 'term-111111111111111111111'
      const coordinates = terminalSessionCoordinates(base)
      const branchName = terminalPresentationBranch(base.presentation)
      if (!branchName) throw new Error('expected Git worktree terminal fixture')
      workspacePaneTabsTestBridge.addRuntimeTab({
        workspaceId: coordinates.workspaceId,
        workspaceRuntimeId: coordinates.workspaceRuntimeId,
        branchName,
        worktreePath: terminalExecutionPath(base.target),
        terminalSessionId,
      })
      terminalCreated = true
      for (const listener of terminalListeners) listener()
      useWorkspacesStore.getState().setSelectedTerminal(terminalFilesystemTargetKey, terminalSessionId)
      return terminalSessionId
    })
    const route = routeNavigation()
    const testNavigation = navigationWithStore(route)
    const commandContext = {
      ...terminalCommandContext,
      createTerminal,
      createTerminalWithAdmission: createTerminalWithAdmissionForContextTest(createTerminal),
    }

    const workspace = (
      workspacePaneRoute: WorkspacePaneRoute | null,
      nextReadContext: TerminalSessionReadContextValue = readContext,
    ) => (
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={testNavigation}>
          <TerminalSessionContext value={commandContext}>
            <TerminalSessionReadContext value={nextReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName="feature/a"
                workspacePaneRouteContext={{ kind: 'routed', route: workspacePaneRoute }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>
    )
    const { rerender } = render(workspace({ kind: 'static', tab: 'status' }))

    await waitFor(() => {
      expect(useWorkspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]?.current).toEqual(statusEntry)
    })

    await act(async () => {
      screen.getByRole('button', { name: 'terminal.new' }).click()
      await waitForNextMacrotask()
    })
    expect(route.openRepoBranchTerminal).toHaveBeenCalledWith(
      REPO_ID,
      'feature/a',
      'term-111111111111111111111',
      presentationOptions(),
    )

    rerender(
      workspace(
        { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
        terminalReadContextWithSession(terminalFilesystemTargetKey, 'term-111111111111111111111'),
      ),
    )

    await waitFor(() => {
      expect(useWorkspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]?.backStack).toEqual([statusEntry])
      expect(useWorkspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]?.current).toEqual(terminalEntry)
    })

    act(() => {
      testNavigation.goBack(REPO_ID)
    })

    expect(route.openRepoBranchTab).toHaveBeenCalledWith(REPO_ID, 'feature/a', 'status', historyRestoreOptions())
  })
})
