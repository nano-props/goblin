// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/vue'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { WorkspacePane } from '#/web/components/workspace-pane/WorkspacePane.tsx'
import {
  TerminalSessionCommandScope,
  TerminalSessionReadScope,
} from '#/web/components/terminal/terminal-session-context.ts'
import { AppNavigationProvider } from '#/web/app-navigation.tsx'
import { terminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { seedRepoWithReadModelForTest } from '#/web/test-utils/repo-store.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { setRepoWorktreeStatusQueryData } from '#/web/repo-query-cache.ts'
import { workspaceDirectoryOverviewQueryKey } from '#/web/workspace-directory-overview-query.ts'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/test-utils/workspace-pane-tabs.ts'
import {
  createTerminalWithAdmissionForContextTest,
  terminalSessionContextForTest,
} from '#/web/test-utils/terminal-session-context.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { gitWorktreeWorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { externalAppsQueryKey } from '#/web/settings-query-cache.ts'
import { repoWorktreeStatusQueryKey } from '#/web/repo-query-keys.ts'
import { hostInfoStore } from '#/web/stores/host-info.ts'
import {
  directoryWorkspaceProbe,
  navigation,
  presentationOptions,
  render,
  terminalCommandContext,
  terminalReadContext,
  terminalReadContextWithSession,
} from '#/web/test-utils/workspace-pane.tsx'

const responsiveMocks = vi.hoisted(() => ({ compact: false }))
vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useIsCompactUi: () => ({
    get value() {
      return responsiveMocks.compact
    },
  }),
}))

beforeEach(() => {
  responsiveMocks.compact = false
})

function queryObserverCount(queryKey: readonly unknown[]): number {
  return appQueryClient.getQueryCache().find({ queryKey, exact: true })?.getObserversCount() ?? 0
}

describe('WorkspacePane directory workspaces', () => {
  test('renders a remote non-Git workspace with canonical Status, Files, and Terminal targets', async () => {
    const workspaceId = workspaceIdForTest('goblin+ssh://example/srv/workspace')
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: directoryWorkspaceProbe(),
    })
    terminalProjectionHydrationStore.getState().markProjectionReady(workspaceId, repo.workspaceRuntimeId)
    const commitWorkspaceRootTerminalSession = vi.fn(async () => true)
    const terminalCreate = Promise.withResolvers<string>()
    const createTerminal = vi.fn(async () => await terminalCreate.promise)
    const deferredTerminalCommandContext = terminalSessionContextForTest({
      ...terminalCommandContext,
      createTerminal,
      createTerminalWithAdmission: createTerminalWithAdmissionForContextTest(createTerminal),
    })

    render(
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={{ ...navigation, commitWorkspaceRootTerminalSession }}>
          <TerminalSessionCommandScope value={deferredTerminalCommandContext}>
            <TerminalSessionReadScope value={terminalReadContext}>
              <WorkspacePane
                workspaceId={workspaceId}
                workspacePaneRouteContext={{ kind: 'workspace-root', route: { kind: 'static', tab: 'files' } }}
              />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )

    expect(screen.getByText('tab.files')).toBeTruthy()
    expect(screen.getByText('tab.status')).toBeTruthy()
    expect(screen.queryByText('branches.empty')).toBeNull()
    expect(queryObserverCount(workspaceDirectoryOverviewQueryKey(workspaceId, repo.workspaceRuntimeId))).toBe(0)
    const newTerminalButton = screen.getByRole('button', { name: 'terminal.new' }) as HTMLButtonElement
    await waitFor(() => expect(newTerminalButton.disabled).toBe(false))
    newTerminalButton.click()
    await waitFor(() => {
      expect(deferredTerminalCommandContext.createTerminalWithAdmission).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.objectContaining({ kind: 'workspace-root', workspaceId }),
          presentation: { kind: 'workspace-root' },
        }),
        undefined,
      )
    })
    expect(commitWorkspaceRootTerminalSession).not.toHaveBeenCalled()
    terminalCreate.resolve('term-111111111111111111111')
    await waitFor(() =>
      expect(commitWorkspaceRootTerminalSession).toHaveBeenCalledWith(
        workspaceId,
        repo.workspaceRuntimeId,
        'term-111111111111111111111',
        expect.objectContaining({ navigationGeneration: expect.any(Number) }),
      ),
    )
  })

  test('renders shared external app actions for a local non-Git workspace', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/filesystem-toolbar-workspace')
    seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: directoryWorkspaceProbe(),
    })
    appQueryClient.setQueryData(externalAppsQueryKey(), {
      terminal: {
        available: true,
        appAvailability: { ghostty: true, terminal: true, windowsTerminal: false },
        detectedAt: 1,
      },
      editor: { available: true, appAvailability: { vscode: true }, detectedAt: 1 },
    })
    hostInfoStore.setState({
      snapshot: { homeDir: '/Users/tester', platform: 'darwin', hostname: 'test-host', pid: 1 },
      status: 'ready',
      error: null,
    })

    const { container } = render(
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigation}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope value={terminalReadContext}>
              <WorkspacePane
                workspaceId={workspaceId}
                workspacePaneRouteContext={{ kind: 'workspace-root', route: { kind: 'static', tab: 'files' } }}
              />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )

    expect(container.querySelector('[data-testid="workspace-external-app-launcher-primary"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="workspace-external-app-launcher-trigger"]')).not.toBeNull()
  })

  test('keeps the selected workspace-root pane when Git capability becomes available', async () => {
    const workspaceId = workspaceIdForTest('goblin+ssh://example/workspace')
    seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: directoryWorkspaceProbe(),
    })

    render(
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigation}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope value={terminalReadContext}>
              <WorkspacePane
                workspaceId={workspaceId}
                currentBranchName={null}
                workspacePaneRouteContext={{ kind: 'workspace-root', route: null }}
              />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )

    expect(screen.getByText('tab.files')).toBeTruthy()
    await flushTestUpdates(() => {
      workspacesStore.setState((state) => {
        const repo = state.workspaces[workspaceId]
        if (!repo) return state
        return {
          workspaces: {
            ...state.workspaces,
            [workspaceId]: {
              ...repo,
              workspaceProbe: {
                status: 'ready',
                capabilities: {
                  files: { read: true, write: true },
                  terminal: { available: true },
                  git: { status: 'available', worktrees: true, pullRequests: { provider: 'none' } },
                },
                diagnostics: [],
              },
            },
          },
        }
      })
    })

    await waitFor(() => expect(screen.getByText('tab.files')).toBeTruthy())
    expect(screen.queryByText('branches.empty')).toBeNull()
  })

  test('restores a detached worktree terminal route into the shared runtime surface', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///workspace/repo')
    const worktreePath = '/workspace/detached'
    const terminalSessionId = 'term-333333333333333333333'
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
    })
    setRepoWorktreeStatusQueryData(workspaceId, repo.workspaceRuntimeId, {
      workspaceRuntimeId: repo.workspaceRuntimeId,
      status: [{ path: worktreePath, isMain: false, entries: [] }],
      loadedAt: 1,
    })
    const target = gitWorktreeWorkspacePaneTabsTarget(workspaceId, worktreePath)
    if (!target) throw new Error('expected canonical detached worktree fixture')
    setWorkspacePaneTabsForTargetQueryData({
      ...target,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      tabs: [workspacePaneRuntimeTabEntry('terminal', terminalSessionId)],
    })
    const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKeyForPath(workspaceId, worktreePath)

    render(
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigation}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope
              value={terminalReadContextWithSession(terminalFilesystemTargetKey, terminalSessionId)}
            >
              <WorkspacePane
                workspaceId={workspaceId}
                currentBranchName={null}
                workspacePaneRouteContext={{
                  kind: 'git-worktree',
                  worktreePath,
                  route: { kind: 'terminal', terminalSessionId },
                }}
              />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )

    expect(await screen.findByTestId('detached-worktree-pane')).toBeTruthy()
    expect(screen.getByRole('tabpanel', { name: 'tab.terminal' })).toBeTruthy()
  })

  test('keeps a detached-worktree pane visible after a background status failure', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///workspace/repo-stale-detached')
    const worktreePath = '/workspace/detached-stale'
    const repo = seedRepoWithReadModelForTest({ id: workspaceId, branches: [], currentBranchName: null })
    setRepoWorktreeStatusQueryData(workspaceId, repo.workspaceRuntimeId, {
      workspaceRuntimeId: repo.workspaceRuntimeId,
      status: [{ path: worktreePath, isMain: false, entries: [] }],
      loadedAt: 1,
    })
    const target = gitWorktreeWorkspacePaneTabsTarget(workspaceId, worktreePath)
    if (!target) throw new Error('expected canonical detached worktree fixture')
    setWorkspacePaneTabsForTargetQueryData({
      ...target,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      tabs: [workspacePaneStaticTabEntry('files')],
    })
    const statusQuery = appQueryClient.getQueryCache().find({
      queryKey: repoWorktreeStatusQueryKey(workspaceId, repo.workspaceRuntimeId),
      exact: true,
    })
    if (!statusQuery) throw new Error('missing worktree-status query')
    statusQuery.setState({ ...statusQuery.state, status: 'error', error: new Error('status refresh failed') })

    render(
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigation}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope value={terminalReadContext}>
              <WorkspacePane
                workspaceId={workspaceId}
                currentBranchName={null}
                workspacePaneRouteContext={{
                  kind: 'git-worktree',
                  worktreePath,
                  route: { kind: 'static', tab: 'files' },
                }}
              />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )

    expect(await screen.findByTestId('detached-worktree-pane')).toBeTruthy()
    expect(screen.getByText('status.stale-title')).toBeTruthy()
    expect(screen.getByText(/status refresh failed/)).toBeTruthy()
  })

  test('keeps the saved detached-worktree preference on a bare filesystem route', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///workspace/repo-bare-worktree')
    const worktreePath = '/workspace/detached-bare'
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
    })
    setRepoWorktreeStatusQueryData(workspaceId, repo.workspaceRuntimeId, {
      workspaceRuntimeId: repo.workspaceRuntimeId,
      status: [{ path: worktreePath, isMain: false, entries: [] }],
      loadedAt: 1,
    })
    const target = gitWorktreeWorkspacePaneTabsTarget(workspaceId, worktreePath)
    if (!target) throw new Error('expected canonical detached worktree fixture')
    setWorkspacePaneTabsForTargetQueryData({
      ...target,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      tabs: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
    })
    workspacesStore.getState().setWorkspacePaneTabForTarget(target, 'files')

    render(
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigation}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope value={terminalReadContext}>
              <WorkspacePane
                workspaceId={workspaceId}
                currentBranchName={null}
                workspacePaneRouteContext={{ kind: 'git-worktree', worktreePath, route: null }}
              />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )

    expect(await screen.findByTestId('detached-worktree-pane')).toBeTruthy()
    await flushTestUpdates(async () => await Promise.resolve())
    expect(screen.getByRole('tab', { name: 'tab.files' }).getAttribute('aria-selected')).toBe('true')
    const workspace = workspacesStore.getState().workspaces[workspaceId]
    expect(workspace && preferredWorkspacePaneTabForTarget(workspace.ui, target)).toBe('files')
  })

  test('uses the shared compact workspace toolbar back action for a non-Git workspace', async () => {
    responsiveMocks.compact = true
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/plain-compact-workspace')
    seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: directoryWorkspaceProbe(),
    })
    const onBackToNavigator = vi.fn()

    render(
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigation}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope value={terminalReadContext}>
              <WorkspacePane
                workspaceId={workspaceId}
                workspacePaneRouteContext={{ kind: 'routed', route: null }}
                onBackToBranchNavigator={onBackToNavigator}
              />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )

    screen.getByRole('button', { name: 'workspace.back-to-workspace-navigator' }).click()
    expect(onBackToNavigator).toHaveBeenCalledOnce()
  })

  test('renders directory overview data in the non-Git Status tab without a Git projection', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/plain-status-workspace')
    seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: directoryWorkspaceProbe(),
    })
    const repo = workspacesStore.getState().workspaces[workspaceId]!
    workspacesStore
      .getState()
      .setWorkspacePaneTabForTarget({ kind: 'workspace-root', workspaceId: workspaceId }, 'status')
    appQueryClient.setQueryData(workspaceDirectoryOverviewQueryKey(workspaceId, repo.workspaceRuntimeId), {
      topLevelFileCount: 7,
      topLevelDirectoryCount: 3,
      lastModifiedAt: '2023-11-14T22:13:20.000Z',
    })

    render(
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigation}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope value={terminalReadContext}>
              <WorkspacePane workspaceId={workspaceId} workspacePaneRouteContext={{ kind: 'routed', route: null }} />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )

    expect(screen.getByRole('tab', { name: 'tab.status' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('list')).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getByText('dashboard.directory.working-directory')).toBeTruthy()
    expect(screen.queryByText('branch-status.signal.worktree')).toBeNull()
    const workingDirectoryLink = screen.getByText('/tmp/plain-status-workspace')
    expect(workingDirectoryLink).toBeTruthy()
    expect(workingDirectoryLink.closest('[role="listitem"]')?.querySelector('svg')?.parentElement?.className).toContain(
      'text-brand-text',
    )
    expect(screen.getByText('7')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    const lastModifiedRow = screen.getByText('dashboard.directory.last-modified').closest('[role="listitem"]')
    const lastModifiedValue = lastModifiedRow?.querySelector<HTMLElement>('[title]')
    expect(lastModifiedValue?.textContent).toBe(lastModifiedValue?.title)
    expect(lastModifiedValue?.textContent).toMatch(/ ago$/u)
    expect(lastModifiedValue?.className).toContain('truncate')
    expect(queryObserverCount(workspaceDirectoryOverviewQueryKey(workspaceId, repo.workspaceRuntimeId))).toBe(1)
  })

  test('opens Files from the working-directory row in a non-Git Status tab', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/plain-status-files-workspace')
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: directoryWorkspaceProbe(),
    })
    workspacesStore.getState().setWorkspacePaneTabForTarget({ kind: 'workspace-root', workspaceId }, 'status')
    appQueryClient.setQueryData(workspaceDirectoryOverviewQueryKey(workspaceId, repo.workspaceRuntimeId), {
      topLevelFileCount: 1,
      topLevelDirectoryCount: 2,
      lastModifiedAt: '2023-11-14T22:13:20.000Z',
    })
    const commitFilesystemWorkspacePaneRoute = vi.fn(async (_target, _route, options) => {
      options?.onCommit?.()
      return true
    })

    render(
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={{ ...navigation, commitFilesystemWorkspacePaneRoute }}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope value={terminalReadContext}>
              <WorkspacePane workspaceId={workspaceId} workspacePaneRouteContext={{ kind: 'routed', route: null }} />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )

    screen.getByRole('button', { name: 'dashboard.directory.open-files' }).click()

    await waitFor(() =>
      expect(commitFilesystemWorkspacePaneRoute).toHaveBeenCalledWith(
        {
          routeTarget: { kind: 'workspace-root', workspaceId },
          workspaceRuntimeId: repo.workspaceRuntimeId,
          authority: { kind: 'workspace-runtime' },
        },
        { kind: 'static', tab: 'files' },
        presentationOptions(),
      ),
    )
  })

  test('uses the workspace-root route as presentation authority and persists its valid static tab', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/plain-routed-workspace')
    seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: directoryWorkspaceProbe(),
    })
    workspacesStore.getState().setWorkspacePaneTabForTarget({ kind: 'workspace-root', workspaceId }, 'status')

    render(
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigation}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope value={terminalReadContext}>
              <WorkspacePane
                workspaceId={workspaceId}
                workspacePaneRouteContext={{ kind: 'workspace-root', route: { kind: 'static', tab: 'files' } }}
              />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )

    expect(screen.getByRole('tab', { name: 'tab.files' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'tab.status' }).getAttribute('aria-selected')).toBe('false')
    await waitFor(() => {
      const workspace = workspacesStore.getState().workspaces[workspaceId]
      expect(
        workspace &&
          preferredWorkspacePaneTabForTarget(workspace.ui, {
            kind: 'workspace-root',
            workspaceId,
          }),
      ).toBe('files')
    })
  })

  test('keeps the saved workspace-root preference on a bare filesystem route', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/plain-bare-workspace')
    seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: directoryWorkspaceProbe(),
    })
    workspacesStore.getState().setWorkspacePaneTabForTarget({ kind: 'workspace-root', workspaceId }, 'status')

    render(
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigation}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope value={terminalReadContext}>
              <WorkspacePane
                workspaceId={workspaceId}
                workspacePaneRouteContext={{ kind: 'workspace-root', route: null }}
              />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )

    await flushTestUpdates(async () => await Promise.resolve())
    expect(screen.getByRole('tab', { name: 'tab.status' }).getAttribute('aria-selected')).toBe('true')
    const workspace = workspacesStore.getState().workspaces[workspaceId]
    expect(workspace && preferredWorkspacePaneTabForTarget(workspace.ui, { kind: 'workspace-root', workspaceId })).toBe(
      'status',
    )
  })

  test('does not expose a terminal surface when the workspace capability is unavailable', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/terminal-unavailable-workspace')
    seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: directoryWorkspaceProbe({
        filesWritable: false,
        terminalAvailable: false,
      }),
    })

    render(
      <VueQueryClientScope client={appQueryClient}>
        <AppNavigationProvider value={navigation}>
          <TerminalSessionCommandScope value={terminalCommandContext}>
            <TerminalSessionReadScope value={terminalReadContext}>
              <WorkspacePane workspaceId={workspaceId} workspacePaneRouteContext={{ kind: 'routed', route: null }} />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )

    expect(screen.getByText('tab.files')).toBeTruthy()
    expect(screen.queryByText('tab.terminal')).toBeNull()
  })
})
