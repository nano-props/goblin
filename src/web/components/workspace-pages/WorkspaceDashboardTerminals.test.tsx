// @vitest-environment jsdom

import { cleanup, screen } from '@testing-library/vue'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { createMemoryHistory, createRouter, useRoute } from 'vue-router'
import { AppNavigationProvider } from '#/web/app/navigation/context.tsx'
import { createAppNavigationActions } from '#/web/app/navigation/actions.ts'
import type { AppNavigationActions } from '#/web/app/navigation/actions.ts'
import { useAppRouteNavigation } from '#/web/app/navigation/route-navigation.ts'
import {
  createAppHistoryPresentationHistory,
  installAppHistoryPresentationObserver,
} from '#/web/app/navigation/history-presentation.ts'
import { resetAppNavigationForTest } from '#/web/app/navigation/lifecycle.ts'
import {
  workspaceNavigationRouteContext,
  workspaceRouteContextFromVueRoute,
} from '#/web/app/navigation/layout-model.ts'
import { useWorkspaceNavigationHistory } from '#/web/app/navigation/workspace-history.ts'
import { workspaceSlugFromId, worktreeSlugFromPath } from '#/web/app/navigation/workspace-route-slugs.ts'
import { TerminalSessionReadScope } from '#/web/terminal/components/terminal-session-context.ts'
import { WorkspaceDashboardTerminals } from '#/web/components/workspace-pages/WorkspaceDashboardTerminals.tsx'
import type {
  TerminalSessionReadContextValue,
  WorkspaceTerminalSessionSummary,
} from '#/web/terminal/components/types.ts'
import { terminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import {
  provideTerminalProjectionRecoveryActions,
  type TerminalProjectionRecoveryActions,
} from '#/web/runtime/terminal-projection-recovery-context.ts'
import { appNavigationActionsForTest } from '#/web/test-utils/app-navigation.ts'
import {
  createRepoBranch,
  createRepoWorktreeSnapshotForTest,
  resetWorkspacesStore,
  seedRepoShellForTest,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/repo-store.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { appQueryClient } from '#/web/app/query-client.ts'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'
import { workspacePaneTabsQueryKey } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { recordWorkspacePaneTabOpener, workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { repoSnapshotQueryKey } from '#/web/repos/query-keys.ts'
import { installGoblinTestBridge } from '#/web/test-utils/bridge.ts'
import { workspacePaneRuntimeTabEntry } from '#/shared/workspace-pane.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import { workspacePaneLocationForWorktree } from '#/web/workspace-pane/workspace-pane-location.ts'
import { createWorkspacePaneTabModel } from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { useFilesystemWorkspacePaneRouteController } from '#/web/workspace-pane/filesystem-workspace-pane-route-controller.ts'
import type { WorkspaceRepoWorktreeSnapshot } from '#/shared/git-types.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace')
const WORKSPACE_RUNTIME_ID = 'repo-runtime-dashboard'
const toastMocks = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn() }))
const readRepoSnapshot = vi.fn(() => new Promise(() => {}))

const TerminalProjectionRecoveryScope = defineComponent<{ value: TerminalProjectionRecoveryActions }>({
  props: {
    value: { type: Object as PropType<TerminalProjectionRecoveryActions>, required: true },
  },
  setup(props, { slots }) {
    provideTerminalProjectionRecoveryActions(props.value)
    return () => slots.default?.()
  },
})

vi.mock('vue-sonner', () => ({ toast: toastMocks }))

beforeEach(() => {
  readRepoSnapshot.mockReset()
  readRepoSnapshot.mockImplementation(() => new Promise(() => {}))
  installGoblinTestBridge({ 'repo.snapshot': readRepoSnapshot })
})

afterEach(() => {
  cleanup()
  resetAppNavigationForTest()
  resetWorkspacesStore()
  terminalProjectionHydrationStore.setState({
    hydrationByWorkspace: new Map(),
    lastSuccessfulRecoveryByWorkspace: new Map(),
  })
  toastMocks.error.mockReset()
  toastMocks.warning.mockReset()
  appQueryClient.clear()
})

describe('WorkspaceDashboardTerminals', () => {
  test('lists root and Git worktree terminals, shows output activity, and opens the selected session', async () => {
    const sessions = [
      terminalSummary('term-root-session', 'Root shell', {
        target: { kind: 'workspace-root', workspaceId: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        presentation: { kind: 'workspace-root' },
      }),
      terminalSummary(
        'term-git-session',
        'Build server',
        {
          target: {
            kind: 'git-worktree',
            workspaceId: WORKSPACE_ID,
            workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
            root: workspaceIdForTest('goblin+file:///workspace/feature'),
          },
          presentation: { kind: 'git-worktree' },
        },
        true,
      ),
    ]
    const sourceWorktree = createRepoWorktreeSnapshotForTest('main', '/workspace', {
      isSource: true,
      isPrimary: true,
    })
    const linkedWorktree = createRepoWorktreeSnapshotForTest('feature/dashboard', '/workspace/feature')
    seedRepoWithReadModelForTest({
      id: WORKSPACE_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branches: [createRepoBranch('feature/dashboard')],
      worktrees: [sourceWorktree, linkedWorktree],
      currentBranchName: 'feature/dashboard',
    })
    terminalProjectionHydrationStore.getState().markProjectionReady(WORKSPACE_ID, WORKSPACE_RUNTIME_ID)
    const commitFilesystemWorkspacePaneRoute = vi.fn(async () => true)
    const commitWorkspacePaneRoute = vi.fn<AppNavigationActions['commitWorkspacePaneRoute']>(
      async (_workspaceId, _branchName, _route, options) => {
        options?.onCommit?.()
        return true
      },
    )
    const gitPaneTarget = {
      kind: 'git-worktree' as const,
      workspaceId: WORKSPACE_ID,
      worktreePath: '/workspace/feature',
    }
    expect(
      recordWorkspacePaneTabOpener(
        gitPaneTarget,
        WORKSPACE_RUNTIME_ID,
        'terminal:term-git-session',
        'workspace-pane:status',
      ),
    ).toBe('recorded')

    renderDashboardTerminals(sessions, commitFilesystemWorkspacePaneRoute, vi.fn(), commitWorkspacePaneRoute)

    expect(screen.getByText('Root shell')).toBeTruthy()
    expect(screen.getByText('Build server')).toBeTruthy()
    expect(screen.getByText('feature/dashboard')).toBeTruthy()
    expect(screen.getByTestId('terminal-output-activity-indicator')).toBeTruthy()

    await userEvent.click(screen.getByText('Root shell'))
    expect(commitFilesystemWorkspacePaneRoute).toHaveBeenLastCalledWith(
      {
        kind: 'source-worktree',
        workspaceId: WORKSPACE_ID,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        routeTarget: { kind: 'git-worktree', workspaceId: WORKSPACE_ID, worktreePath: '/workspace' },
        paneTarget: { kind: 'workspace-root', workspaceId: WORKSPACE_ID },
        worktreeHead: sourceWorktree.head,
        branchName: 'main',
      },
      { kind: 'terminal', terminalSessionId: 'term-root-session' },
      { navigationGeneration: expect.any(Number) },
    )

    await userEvent.click(screen.getByText('Build server'))
    expect(commitFilesystemWorkspacePaneRoute).toHaveBeenLastCalledWith(
      {
        kind: 'linked-worktree',
        workspaceId: WORKSPACE_ID,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        routeTarget: { kind: 'git-worktree', workspaceId: WORKSPACE_ID, worktreePath: '/workspace/feature' },
        paneTarget: { kind: 'git-worktree', workspaceId: WORKSPACE_ID, worktreePath: '/workspace/feature' },
        worktreeHead: linkedWorktree.head,
        branchName: 'feature/dashboard',
      },
      { kind: 'terminal', terminalSessionId: 'term-git-session' },
      { navigationGeneration: expect.any(Number) },
    )
    expect(commitFilesystemWorkspacePaneRoute).toHaveBeenCalledTimes(2)
    expect(commitWorkspacePaneRoute).not.toHaveBeenCalled()
    expect(workspacePaneTabOpener(gitPaneTarget, WORKSPACE_RUNTIME_ID, 'terminal:term-git-session')).toBeNull()
  })

  test('settles a source terminal click through real navigation on its worktree route', async () => {
    const terminalSessionId = 'term-root-session'
    const sessions = [
      terminalSummary(terminalSessionId, 'Root shell', {
        target: { kind: 'workspace-root', workspaceId: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        presentation: { kind: 'workspace-root' },
      }),
    ]
    const sourceWorktree = createRepoWorktreeSnapshotForTest('main', '/private/workspace', {
      isSource: true,
      isPrimary: true,
    })
    seedRepoWithReadModelForTest({
      id: WORKSPACE_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branches: [createRepoBranch('main')],
      worktrees: [sourceWorktree],
      currentBranchName: 'main',
    })
    terminalProjectionHydrationStore.getState().markProjectionReady(WORKSPACE_ID, WORKSPACE_RUNTIME_ID)
    setDashboardTerminalTabsQueryData(sessions)
    const dashboardPath = `/workspace/${workspaceSlugFromId(WORKSPACE_ID)}/dashboard`
    const rawHistory = createMemoryHistory()
    rawHistory.replace(dashboardPath)
    const history = createAppHistoryPresentationHistory(rawHistory)
    const router = createRouter({
      history,
      routes: [
        {
          path: '/workspace/:workspaceSlug/dashboard',
          name: 'workspace-dashboard',
          component: { render: () => null },
        },
        {
          path: '/workspace/:workspaceSlug/worktree/:worktreeSlug',
          name: 'workspace-worktree',
          component: { render: () => null },
        },
        {
          path: '/workspace/:workspaceSlug/worktree/:worktreeSlug/terminal/:terminalSessionId',
          name: 'workspace-worktree-terminal',
          component: { render: () => null },
        },
      ],
    })
    const stopHistoryObserver = installAppHistoryPresentationObserver(router)
    await router.push(dashboardPath)
    await router.isReady()

    renderInJsdom(<RealDashboardTerminalNavigationHarness session={sessions[0]!} sourceWorktree={sourceWorktree} />, {
      global: { plugins: [router] },
    })

    await userEvent.click(screen.getByText('Root shell'))

    const terminalPath = `/workspace/${workspaceSlugFromId(WORKSPACE_ID)}/worktree/${worktreeSlugFromPath(
      sourceWorktree.path,
    )}/terminal/${terminalSessionId}`
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe(terminalPath))
    expect(
      workspacesStore.getState().selectedTerminalSessionIdByTerminalFilesystemTarget[
        formatTerminalFilesystemTargetKeyForPath(WORKSPACE_ID, WORKSPACE_ID)
      ],
    ).toBe(terminalSessionId)
    expect(
      workspacesStore.getState().selectedTerminalSessionIdByTerminalFilesystemTarget[
        formatTerminalFilesystemTargetKeyForPath(WORKSPACE_ID, sourceWorktree.path)
      ],
    ).toBeUndefined()
    await vi.waitFor(() =>
      expect(workspacesStore.getState().navigationHistoryByWorkspace[WORKSPACE_ID]).toEqual({
        backStack: [{ workspaceId: WORKSPACE_ID, route: { kind: 'dashboard' } }],
        current: {
          workspaceId: WORKSPACE_ID,
          route: {
            kind: 'worktree',
            worktreePath: sourceWorktree.path,
            workspacePaneTab: 'terminal',
            terminalSessionId,
          },
        },
        forwardStack: [],
      }),
    )
    stopHistoryObserver()
  })

  test('keeps a detached worktree terminal in the filesystem route family', async () => {
    const sessions = [
      terminalSummary('term-detached-session', 'Detached shell', {
        target: {
          kind: 'git-worktree',
          workspaceId: WORKSPACE_ID,
          workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
          root: workspaceIdForTest('goblin+file:///workspace/detached'),
        },
        presentation: { kind: 'git-worktree' },
      }),
    ]
    const detachedWorktree = {
      path: '/workspace/detached',
      head: { kind: 'detached' as const },
      headOid: '1234567890abcdef1234567890abcdef12345678',
      operation: null,
      materializedBranch: null,
      isSource: false,
      isPrimary: false,
      isLocked: false,
    }
    seedRepoWithReadModelForTest({
      id: WORKSPACE_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      worktrees: [detachedWorktree],
    })
    terminalProjectionHydrationStore.getState().markProjectionReady(WORKSPACE_ID, WORKSPACE_RUNTIME_ID)
    const commitFilesystemWorkspacePaneRoute = vi.fn(async () => true)
    const commitWorkspacePaneRoute = vi.fn<AppNavigationActions['commitWorkspacePaneRoute']>()

    renderDashboardTerminals(sessions, commitFilesystemWorkspacePaneRoute, vi.fn(), commitWorkspacePaneRoute)
    expect(screen.getByText('1234567')).toBeTruthy()
    await userEvent.click(screen.getByText('Detached shell'))

    expect(commitFilesystemWorkspacePaneRoute).toHaveBeenCalledWith(
      {
        kind: 'linked-worktree',
        workspaceId: WORKSPACE_ID,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        routeTarget: { kind: 'git-worktree', workspaceId: WORKSPACE_ID, worktreePath: '/workspace/detached' },
        paneTarget: { kind: 'git-worktree', workspaceId: WORKSPACE_ID, worktreePath: '/workspace/detached' },
        worktreeHead: { kind: 'detached' },
        branchName: null,
      },
      { kind: 'terminal', terminalSessionId: 'term-detached-session' },
      { navigationGeneration: expect.any(Number) },
    )
    expect(commitWorkspacePaneRoute).not.toHaveBeenCalled()
  })

  test('disables a terminal target when an authoritative snapshot no longer contains it', async () => {
    const sessions = [
      terminalSummary('term-missing-session', 'Missing worktree shell', {
        target: {
          kind: 'git-worktree',
          workspaceId: WORKSPACE_ID,
          workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
          root: workspaceIdForTest('goblin+file:///workspace/missing'),
        },
        presentation: { kind: 'git-worktree' },
      }),
    ]
    seedRepoWithReadModelForTest({ id: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID })
    terminalProjectionHydrationStore.getState().markProjectionReady(WORKSPACE_ID, WORKSPACE_RUNTIME_ID)

    const commitFilesystemWorkspacePaneRoute = vi.fn(async () => true)
    const commitWorkspacePaneRoute = vi.fn<AppNavigationActions['commitWorkspacePaneRoute']>()
    renderDashboardTerminals(sessions, commitFilesystemWorkspacePaneRoute, vi.fn(), commitWorkspacePaneRoute)

    expect(screen.getByText('dashboard.terminals.worktree-unavailable')).toBeTruthy()
    expect(screen.queryByText('1234567')).toBeNull()
    expect(screen.queryByText('dashboard.terminals.detached-worktree')).toBeNull()
    const row = screen.getByRole('button', { name: /Missing worktree shell/ }) as HTMLButtonElement
    expect(row.disabled).toBe(true)
    await userEvent.click(row)
    expect(commitFilesystemWorkspacePaneRoute).not.toHaveBeenCalled()
    expect(commitWorkspacePaneRoute).not.toHaveBeenCalled()
  })

  test('keeps a worktree terminal visible but disabled while snapshot authority is unavailable', async () => {
    const sessions = [
      terminalSummary('term-branch-session', 'Branch shell', {
        target: {
          kind: 'git-worktree',
          workspaceId: WORKSPACE_ID,
          workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
          root: workspaceIdForTest('goblin+file:///workspace/feature'),
        },
        presentation: { kind: 'git-worktree' },
      }),
    ]
    seedGitWorkspaceWithoutSnapshot()
    terminalProjectionHydrationStore.getState().markProjectionReady(WORKSPACE_ID, WORKSPACE_RUNTIME_ID)
    const commitFilesystemWorkspacePaneRoute = vi.fn(async () => true)
    const commitWorkspacePaneRoute = vi.fn<AppNavigationActions['commitWorkspacePaneRoute']>()

    renderDashboardTerminals(sessions, commitFilesystemWorkspacePaneRoute, vi.fn(), commitWorkspacePaneRoute)
    expect(screen.getByText('dashboard.terminals.worktree-unknown')).toBeTruthy()
    expect(screen.queryByText('1234567')).toBeNull()
    expect(screen.queryByText('dashboard.terminals.detached-worktree')).toBeNull()
    const row = screen.getByRole('button', { name: /Branch shell/ }) as HTMLButtonElement
    expect(row.disabled).toBe(true)
    await userEvent.click(row)

    expect(commitFilesystemWorkspacePaneRoute).not.toHaveBeenCalled()
    expect(commitWorkspacePaneRoute).not.toHaveBeenCalled()
    expect(toastMocks.error).not.toHaveBeenCalled()
  })

  test('marks a worktree terminal unavailable when the initial snapshot read fails', async () => {
    const sessions = [
      terminalSummary('term-branch-session', 'Branch shell', {
        target: {
          kind: 'git-worktree',
          workspaceId: WORKSPACE_ID,
          workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
          root: workspaceIdForTest('goblin+file:///workspace/feature'),
        },
        presentation: { kind: 'git-worktree' },
      }),
    ]
    seedGitWorkspaceWithoutSnapshot()
    terminalProjectionHydrationStore.getState().markProjectionReady(WORKSPACE_ID, WORKSPACE_RUNTIME_ID)
    readRepoSnapshot.mockRejectedValue(new Error('snapshot unavailable'))
    const commitFilesystemWorkspacePaneRoute = vi.fn(async () => true)

    renderDashboardTerminals(sessions, commitFilesystemWorkspacePaneRoute)

    await vi.waitFor(() => expect(screen.getByText('dashboard.terminals.worktree-unavailable')).toBeTruthy())
    expect((screen.getByRole('button', { name: /Branch shell/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(commitFilesystemWorkspacePaneRoute).not.toHaveBeenCalled()
  })

  test('keeps accepted snapshot data after a later refresh fails', async () => {
    const sessions = [
      terminalSummary('term-root-session', 'Root shell', {
        target: { kind: 'workspace-root', workspaceId: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        presentation: { kind: 'workspace-root' },
      }),
    ]
    seedRepoWithReadModelForTest({
      id: WORKSPACE_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      worktrees: [createRepoWorktreeSnapshotForTest('main', '/workspace', { isSource: true, isPrimary: true })],
      currentBranchName: 'main',
    })
    terminalProjectionHydrationStore.getState().markProjectionReady(WORKSPACE_ID, WORKSPACE_RUNTIME_ID)
    const commitFilesystemWorkspacePaneRoute = vi.fn(async () => true)
    renderDashboardTerminals(sessions, commitFilesystemWorkspacePaneRoute)
    readRepoSnapshot.mockRejectedValue(new Error('refresh unavailable'))

    await appQueryClient.refetchQueries({
      queryKey: repoSnapshotQueryKey(WORKSPACE_ID, WORKSPACE_RUNTIME_ID),
      exact: true,
    })

    const row = screen.getByRole('button', { name: /Root shell/ }) as HTMLButtonElement
    expect(row.disabled).toBe(false)
    await userEvent.click(row)
    expect(commitFilesystemWorkspacePaneRoute).toHaveBeenCalledOnce()
  })

  test('stays silent when a later navigation supersedes the branch destination', async () => {
    const sessions = [
      terminalSummary('term-branch-session', 'Branch shell', {
        target: {
          kind: 'git-worktree',
          workspaceId: WORKSPACE_ID,
          workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
          root: workspaceIdForTest('goblin+file:///workspace/feature'),
        },
        presentation: { kind: 'git-worktree' },
      }),
    ]
    seedRepoWithReadModelForTest({
      id: WORKSPACE_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branches: [createRepoBranch('feature/dashboard')],
      worktrees: [createRepoWorktreeSnapshotForTest('feature/dashboard', '/workspace/feature')],
      currentBranchName: 'feature/dashboard',
    })
    terminalProjectionHydrationStore.getState().markProjectionReady(WORKSPACE_ID, WORKSPACE_RUNTIME_ID)
    const commitFilesystemWorkspacePaneRoute = vi.fn(async () => true)
    const commitWorkspacePaneRoute = vi.fn<AppNavigationActions['commitWorkspacePaneRoute']>()

    renderDashboardTerminals(sessions, commitFilesystemWorkspacePaneRoute, vi.fn(), commitWorkspacePaneRoute)
    await userEvent.click(screen.getByText('Branch shell'))

    expect(commitFilesystemWorkspacePaneRoute).toHaveBeenCalledOnce()
    expect(commitWorkspacePaneRoute).not.toHaveBeenCalled()
    expect(toastMocks.error).not.toHaveBeenCalled()
  })

  test('keeps established sessions visible when projection recovery fails', async () => {
    const sessions = [
      terminalSummary('term-root-session', 'Root shell', {
        target: { kind: 'workspace-root', workspaceId: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        presentation: { kind: 'workspace-root' },
      }),
    ]
    seedFilesystemWorkspace()
    terminalProjectionHydrationStore
      .getState()
      .markProjectionFailed(WORKSPACE_ID, WORKSPACE_RUNTIME_ID, 'connection unavailable')

    const retryWorkspace = vi.fn()
    renderDashboardTerminals(
      sessions,
      vi.fn(async () => true),
      retryWorkspace,
    )

    expect(screen.getByText('Root shell')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('dashboard.terminals.stale')
    await userEvent.click(screen.getByText('error.try-again'))
    expect(retryWorkspace).toHaveBeenCalledWith(WORKSPACE_ID)
  })

  test('requires projection recovery before opening a stale terminal', async () => {
    const sessions = [
      terminalSummary('term-root-session', 'Root shell', {
        target: { kind: 'workspace-root', workspaceId: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        presentation: { kind: 'workspace-root' },
      }),
    ]
    seedFilesystemWorkspace()
    terminalProjectionHydrationStore
      .getState()
      .markProjectionFailed(WORKSPACE_ID, WORKSPACE_RUNTIME_ID, 'connection unavailable')
    const commitFilesystemWorkspacePaneRoute = vi.fn(async () => true)
    renderDashboardTerminals(sessions, commitFilesystemWorkspacePaneRoute)

    await userEvent.click(screen.getByText('Root shell'))

    expect(commitFilesystemWorkspacePaneRoute).not.toHaveBeenCalled()
    expect(toastMocks.warning).toHaveBeenCalledWith('dashboard.terminals.stale')
  })

  test('offers an explicit retry when initial projection recovery fails without cached sessions', async () => {
    seedFilesystemWorkspace()
    terminalProjectionHydrationStore
      .getState()
      .markProjectionFailed(WORKSPACE_ID, WORKSPACE_RUNTIME_ID, 'connection unavailable')
    const retryWorkspace = vi.fn()

    renderDashboardTerminals(
      [],
      vi.fn(async () => true),
      retryWorkspace,
    )

    expect(screen.getByRole('alert').textContent).toContain('terminal.restore-failed')
    await userEvent.click(screen.getByText('error.try-again'))
    expect(retryWorkspace).toHaveBeenCalledWith(WORKSPACE_ID)
  })

  test('fails visibly when terminal navigation is rejected', async () => {
    const sessions = [
      terminalSummary('term-root-session', 'Root shell', {
        target: { kind: 'workspace-root', workspaceId: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        presentation: { kind: 'workspace-root' },
      }),
    ]
    seedFilesystemWorkspace()
    terminalProjectionHydrationStore.getState().markProjectionReady(WORKSPACE_ID, WORKSPACE_RUNTIME_ID)
    const rootPaneTarget = { kind: 'workspace-root' as const, workspaceId: WORKSPACE_ID }
    expect(
      recordWorkspacePaneTabOpener(
        rootPaneTarget,
        WORKSPACE_RUNTIME_ID,
        'terminal:term-root-session',
        'workspace-pane:status',
      ),
    ).toBe('recorded')
    renderDashboardTerminals(
      sessions,
      vi.fn(async () => false),
    )

    await userEvent.click(screen.getByText('Root shell'))

    expect(toastMocks.error).toHaveBeenCalledWith('dashboard.terminals.open-failed')
    expect(workspacePaneTabOpener(rootPaneTarget, WORKSPACE_RUNTIME_ID, 'terminal:term-root-session')).toBe(
      'workspace-pane:status',
    )
  })

  test('surfaces a terminal navigation failure', async () => {
    const sessions = [
      terminalSummary('term-root-session', 'Root shell', {
        target: { kind: 'workspace-root', workspaceId: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        presentation: { kind: 'workspace-root' },
      }),
    ]
    seedFilesystemWorkspace()
    terminalProjectionHydrationStore.getState().markProjectionReady(WORKSPACE_ID, WORKSPACE_RUNTIME_ID)
    renderDashboardTerminals(
      sessions,
      vi.fn(async () => {
        throw new Error('navigation unavailable')
      }),
    )

    await userEvent.click(screen.getByText('Root shell'))

    expect(toastMocks.error).toHaveBeenCalledWith('dashboard.terminals.open-failed', {
      description: 'navigation unavailable',
    })
  })
})

function renderDashboardTerminals(
  sessions: WorkspaceTerminalSessionSummary[],
  commitFilesystemWorkspacePaneRoute: AppNavigationActions['commitFilesystemWorkspacePaneRoute'],
  retryWorkspace = vi.fn(),
  commitWorkspacePaneRoute: AppNavigationActions['commitWorkspacePaneRoute'] = vi.fn(async () => true),
): void {
  setDashboardTerminalTabsQueryData(sessions)
  renderInJsdom(
    <VueQueryClientScope client={appQueryClient}>
      <TerminalProjectionRecoveryScope value={{ retryWorkspace }}>
        <AppNavigationProvider
          value={appNavigationActionsForTest({ commitFilesystemWorkspacePaneRoute, commitWorkspacePaneRoute })}
        >
          <TerminalSessionReadScope value={terminalReadContext(sessions)}>
            <WorkspaceDashboardTerminals workspaceId={WORKSPACE_ID} />
          </TerminalSessionReadScope>
        </AppNavigationProvider>
      </TerminalProjectionRecoveryScope>
    </VueQueryClientScope>,
  )
}

function setDashboardTerminalTabsQueryData(sessions: WorkspaceTerminalSessionSummary[]): void {
  const tabsByTarget = new Map<
    string,
    {
      target: WorkspaceTerminalSessionSummary['base']['target']
      tabs: Array<{ type: 'terminal'; runtimeSessionId: string }>
    }
  >()
  for (const session of sessions) {
    const key = JSON.stringify(session.base.target)
    const entry = tabsByTarget.get(key) ?? { target: session.base.target, tabs: [] }
    entry.tabs.push({ type: 'terminal', runtimeSessionId: session.terminalSessionId })
    tabsByTarget.set(key, entry)
  }
  appQueryClient.setQueryData(workspacePaneTabsQueryKey(WORKSPACE_ID, WORKSPACE_RUNTIME_ID), {
    revision: 0,
    entries: [...tabsByTarget.values()],
  })
}

const RealDashboardTerminalNavigationHarness = defineComponent<{
  session: WorkspaceTerminalSessionSummary
  sourceWorktree: WorkspaceRepoWorktreeSnapshot
}>({
  name: 'RealDashboardTerminalNavigationHarness',
  props: {
    session: { type: Object as PropType<WorkspaceTerminalSessionSummary>, required: true },
    sourceWorktree: { type: Object as PropType<WorkspaceRepoWorktreeSnapshot>, required: true },
  },
  setup(props) {
    const route = useRoute()
    const routeNavigation = useAppRouteNavigation()
    const store = workspacesStore.getState()
    const navigation = createAppNavigationActions({
      currentWorkspaceId: WORKSPACE_ID,
      workspaceOrder: [WORKSPACE_ID],
      closeWorkspace: async () => ({ ok: true }),
      peekWorkspaceNavigation: store.peekWorkspaceNavigation,
      commitWorkspaceNavigation: store.commitWorkspaceNavigation,
      routeNavigation,
    })
    const routeContext = computed(() => workspaceRouteContextFromVueRoute(route))
    useWorkspaceNavigationHistory({
      routeContext: computed(() => workspaceNavigationRouteContext(routeContext.value, route.fullPath)),
    })
    const settledTerminalRoute = computed(() => {
      const context = routeContext.value
      return context?.kind === 'worktree' && context.workspacePaneRoute?.kind === 'terminal'
        ? context.workspacePaneRoute
        : null
    })
    const model = computed(() =>
      settledTerminalRoute.value
        ? createWorkspacePaneTabModel({
            location: workspacePaneLocationForWorktree(WORKSPACE_ID, WORKSPACE_RUNTIME_ID, props.sourceWorktree),
            preferredTab: 'terminal',
            tabEntries: [workspacePaneRuntimeTabEntry('terminal', props.session.terminalSessionId)],
            tabEntriesProjectionPhase: 'ready',
            runtimeTabViews: [props.session],
            runtimeTabStateByType: {
              terminal: {
                projectionPhase: 'ready',
                selectedSessionId: props.session.terminalSessionId,
              },
            },
            requestedSessionIdByRuntimeType: { terminal: props.session.terminalSessionId },
          })
        : createWorkspacePaneTabModel({
            location: null,
            workspaceId: WORKSPACE_ID,
            workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
            preferredTab: null,
            tabEntries: [],
            runtimeTabViews: [],
            runtimeTabStateByType: {},
          }),
    )
    useFilesystemWorkspacePaneRouteController({ route: () => settledTerminalRoute.value, model })
    const retryWorkspace = vi.fn()
    const readContext = terminalReadContext([props.session])

    return () => (
      <VueQueryClientScope client={appQueryClient}>
        <TerminalProjectionRecoveryScope value={{ retryWorkspace }}>
          <AppNavigationProvider value={navigation}>
            <TerminalSessionReadScope value={readContext}>
              <WorkspaceDashboardTerminals workspaceId={WORKSPACE_ID} />
            </TerminalSessionReadScope>
          </AppNavigationProvider>
        </TerminalProjectionRecoveryScope>
      </VueQueryClientScope>
    )
  },
})

function seedFilesystemWorkspace(): void {
  seedRepoShellForTest({
    id: WORKSPACE_ID,
    workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    workspaceProbe: {
      status: 'ready',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'unavailable' },
      },
      diagnostics: [],
    },
  })
}

function seedGitWorkspaceWithoutSnapshot(): void {
  seedRepoShellForTest({
    id: WORKSPACE_ID,
    workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    workspaceProbe: {
      status: 'ready',
      capabilities: {
        files: { read: true, write: true },
        terminal: { available: true },
        git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
      },
      diagnostics: [],
    },
  })
}

function terminalSummary(
  terminalSessionId: string,
  title: string,
  base: WorkspaceTerminalSessionSummary['base'],
  hasRecentOutput = false,
): WorkspaceTerminalSessionSummary {
  return {
    type: 'terminal',
    terminalFilesystemTargetKey: terminalSessionId,
    terminalSessionId,
    index: 0,
    title,
    fullTitle: title,
    processName: 'zsh',
    phase: 'open',
    selected: false,
    hasBell: false,
    hasRecentOutput,
    base,
  }
}

function terminalReadContext(sessions: WorkspaceTerminalSessionSummary[]): TerminalSessionReadContextValue {
  return {
    terminalFilesystemTargetSnapshot: () => ({
      terminalFilesystemTargetKey: '',
      selectedDescriptor: null,
      sessions: [],
      count: 0,
      bellCount: 0,
      outputActiveCount: 0,
      createPending: false,
    }),
    subscribeTerminalFilesystemTarget: () => () => {},
    workspaceBellCount: () => 0,
    subscribeWorkspaceBellCount: () => () => {},
    workspaceTerminalSessions: () => sessions,
    subscribeWorkspaceTerminalSessions: () => () => {},
    snapshot: () => ({
      phase: 'open',
      message: null,
      processName: 'zsh',
      composer: { expanded: false, mode: 'keys', draft: '', historyEntries: [] },
    }),
    subscribeSnapshot: () => () => {},
  }
}
