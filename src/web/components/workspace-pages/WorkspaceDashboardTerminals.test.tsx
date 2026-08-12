// @vitest-environment jsdom

import { cleanup, screen } from '@testing-library/vue'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { AppNavigationProvider } from '#/web/app-navigation.tsx'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'
import { TerminalSessionReadScope } from '#/web/components/terminal/terminal-session-context.ts'
import { WorkspaceDashboardTerminals } from '#/web/components/workspace-pages/WorkspaceDashboardTerminals.tsx'
import type {
  TerminalSessionReadContextValue,
  WorkspaceTerminalSessionSummary,
} from '#/web/components/terminal/types.ts'
import { terminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import {
  provideTerminalProjectionRecoveryActions,
  type TerminalProjectionRecoveryActions,
} from '#/web/runtime/terminal-projection-recovery-context.ts'
import { appNavigationActionsForTest } from '#/web/test-utils/app-navigation.ts'
import {
  createRepoBranch,
  resetWorkspacesStore,
  seedRepoShellForTest,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/repo-store.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'
import { workspacePaneTabsQueryKey } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { recordWorkspacePaneTabOpener, workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace')
const WORKSPACE_RUNTIME_ID = 'repo-runtime-dashboard'
const toastMocks = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn() }))

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

afterEach(() => {
  cleanup()
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
          presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'feature/dashboard' } },
        },
        true,
      ),
    ]
    seedRepoWithReadModelForTest({
      id: WORKSPACE_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branches: [
        createRepoBranch('feature/dashboard', {
          worktree: { path: '/workspace/feature', isPrimary: false, isLocked: false },
        }),
      ],
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
        routeTarget: { kind: 'workspace-root', workspaceId: WORKSPACE_ID },
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        authority: { kind: 'workspace-runtime' },
      },
      { kind: 'terminal', terminalSessionId: 'term-root-session' },
      { navigationGeneration: expect.any(Number) },
    )

    await userEvent.click(screen.getByText('Build server'))
    expect(commitWorkspacePaneRoute).toHaveBeenLastCalledWith(
      WORKSPACE_ID,
      'feature/dashboard',
      { kind: 'terminal', terminalSessionId: 'term-git-session' },
      expect.objectContaining({ navigationGeneration: expect.any(Number) }),
    )
    expect(commitFilesystemWorkspacePaneRoute).toHaveBeenCalledOnce()
    expect(workspacePaneTabOpener(gitPaneTarget, WORKSPACE_RUNTIME_ID, 'terminal:term-git-session')).toBeNull()
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
        presentation: { kind: 'git-worktree', head: { kind: 'detached' } },
      }),
    ]
    seedRepoWithReadModelForTest({ id: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID })
    terminalProjectionHydrationStore.getState().markProjectionReady(WORKSPACE_ID, WORKSPACE_RUNTIME_ID)
    const commitFilesystemWorkspacePaneRoute = vi.fn(async () => true)
    const commitWorkspacePaneRoute = vi.fn<AppNavigationActions['commitWorkspacePaneRoute']>()

    renderDashboardTerminals(sessions, commitFilesystemWorkspacePaneRoute, vi.fn(), commitWorkspacePaneRoute)
    await userEvent.click(screen.getByText('Detached shell'))

    expect(commitFilesystemWorkspacePaneRoute).toHaveBeenCalledWith(
      {
        routeTarget: {
          kind: 'git-worktree',
          workspaceId: WORKSPACE_ID,
          worktreePath: '/workspace/detached',
        },
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        authority: { kind: 'detached-worktree' },
      },
      { kind: 'terminal', terminalSessionId: 'term-detached-session' },
      { navigationGeneration: expect.any(Number) },
    )
    expect(commitWorkspacePaneRoute).not.toHaveBeenCalled()
  })

  test('fails visibly when a branch terminal target is not available yet', async () => {
    const sessions = [
      terminalSummary('term-branch-session', 'Branch shell', {
        target: {
          kind: 'git-worktree',
          workspaceId: WORKSPACE_ID,
          workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
          root: workspaceIdForTest('goblin+file:///workspace/feature'),
        },
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'feature/dashboard' } },
      }),
    ]
    seedRepoShellForTest({ id: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID })
    terminalProjectionHydrationStore.getState().markProjectionReady(WORKSPACE_ID, WORKSPACE_RUNTIME_ID)
    const commitWorkspacePaneRoute = vi.fn<AppNavigationActions['commitWorkspacePaneRoute']>()

    renderDashboardTerminals(
      sessions,
      vi.fn(async () => true),
      vi.fn(),
      commitWorkspacePaneRoute,
    )
    await userEvent.click(screen.getByText('Branch shell'))

    expect(commitWorkspacePaneRoute).not.toHaveBeenCalled()
    expect(toastMocks.error).toHaveBeenCalledWith('dashboard.terminals.open-failed')
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
        presentation: { kind: 'git-worktree', head: { kind: 'branch', branchName: 'feature/dashboard' } },
      }),
    ]
    seedRepoWithReadModelForTest({
      id: WORKSPACE_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      branches: [
        createRepoBranch('feature/dashboard', {
          worktree: { path: '/workspace/feature', isPrimary: false, isLocked: false },
        }),
      ],
      currentBranchName: 'feature/dashboard',
    })
    terminalProjectionHydrationStore.getState().markProjectionReady(WORKSPACE_ID, WORKSPACE_RUNTIME_ID)
    const commitWorkspacePaneRoute = vi.fn<AppNavigationActions['commitWorkspacePaneRoute']>(async () => true)

    renderDashboardTerminals(
      sessions,
      vi.fn(async () => true),
      vi.fn(),
      commitWorkspacePaneRoute,
    )
    await userEvent.click(screen.getByText('Branch shell'))

    expect(commitWorkspacePaneRoute).toHaveBeenCalledOnce()
    expect(toastMocks.error).not.toHaveBeenCalled()
  })

  test('keeps established sessions visible when projection recovery fails', async () => {
    const sessions = [
      terminalSummary('term-root-session', 'Root shell', {
        target: { kind: 'workspace-root', workspaceId: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
        presentation: { kind: 'workspace-root' },
      }),
    ]
    seedRepoShellForTest({ id: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID })
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
    seedRepoShellForTest({ id: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID })
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
    seedRepoShellForTest({ id: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID })
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
    seedRepoShellForTest({ id: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID })
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
    seedRepoShellForTest({ id: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID })
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
