// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/vue'
import { flushTestUpdates } from '#/test-utils/render.tsx'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { WorkspacePane } from '#/web/components/workspace-pane/WorkspacePane.tsx'
import type { WorkspacePaneRouteContext } from '#/web/components/workspace-pane/workspace-pane-types.ts'
import {
  TerminalSessionCommandScope,
  TerminalSessionReadScope,
} from '#/web/components/terminal/terminal-session-context.ts'
import { AppNavigationProvider } from '#/web/app-navigation.tsx'
import { terminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import {
  createBranchSnapshot,
  createRepoWorktreeSnapshotForTest,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/repo-store.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import {
  getRepoSnapshotQueryData,
  setRepoSnapshotQueryData,
  setRepoWorktreeStatusQueryData,
} from '#/web/repo-query-cache.ts'
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
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { externalAppsQueryKey } from '#/web/settings-query-cache.ts'
import { repoLogQueryKey, repoSnapshotQueryKey, repoWorktreeStatusQueryKey } from '#/web/repo-query-keys.ts'
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

function detachedWorktreeSnapshot(path: string) {
  return {
    path,
    head: { kind: 'detached' as const },
    headOid: '1111111111111111111111111111111111111111',
    operation: null,
    materializedBranch: null,
    isPrimary: false,
    isLocked: false,
  }
}

function failWorktreeStatusQuery(workspaceId: WorkspaceId, workspaceRuntimeId: string, message: string) {
  const statusQuery = appQueryClient.getQueryCache().find({
    queryKey: repoWorktreeStatusQueryKey(workspaceId, workspaceRuntimeId),
    exact: true,
  })
  if (!statusQuery) throw new Error('missing worktree-status query')
  statusQuery.setState({
    ...statusQuery.state,
    data: undefined,
    dataUpdatedAt: 0,
    status: 'error',
    error: new Error(message),
  })
}

function renderWorkspacePane(
  workspaceId: WorkspaceId,
  workspacePaneRouteContext: WorkspacePaneRouteContext,
  navigationValue = navigation,
) {
  return render(
    <VueQueryClientScope client={appQueryClient}>
      <AppNavigationProvider value={navigationValue}>
        <TerminalSessionCommandScope value={terminalCommandContext}>
          <TerminalSessionReadScope value={terminalReadContext}>
            <WorkspacePane
              workspaceId={workspaceId}
              currentBranchName={null}
              workspacePaneRouteContext={workspacePaneRouteContext}
            />
          </TerminalSessionReadScope>
        </TerminalSessionCommandScope>
      </AppNavigationProvider>
    </VueQueryClientScope>,
  )
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
    setWorkspacePaneTabsForTargetQueryData({
      kind: 'workspace-root',
      workspaceId,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      tabs: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
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

    expect(screen.getByText('tab.status')).toBeTruthy()
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

    await waitFor(() => expect(screen.getByText('tab.status')).toBeTruthy())
    expect(screen.queryByText('branches.empty')).toBeNull()
  })

  test('restores a detached worktree terminal route into the shared runtime surface', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///workspace/repo')
    const worktreePath = '/workspace/detached'
    const terminalSessionId = 'term-333333333333333333333'
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      worktrees: [detachedWorktreeSnapshot(worktreePath)],
      currentBranchName: null,
    })
    setRepoWorktreeStatusQueryData(workspaceId, repo.workspaceRuntimeId, {
      workspaceRuntimeId: repo.workspaceRuntimeId,
      status: [{ path: worktreePath, isMain: false, entries: [] }],
      loadedAt: 1,
    })
    failWorktreeStatusQuery(workspaceId, repo.workspaceRuntimeId, 'status read failed')
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

    expect(await screen.findByTestId('worktree-pane')).toBeTruthy()
    expect(screen.getByRole('tabpanel', { name: 'tab.terminal' })).toBeTruthy()
    expect(screen.queryByText('error.failed-read-repo')).toBeNull()
  })

  test('keeps worktree history open at the authoritative commit when its worktree enters a detached rebase', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///workspace/repo-rebase-transition')
    const branchName = 'feature/rebase-transition'
    const worktreePath = '/workspace/rebase-transition'
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branchSnapshots: [createBranchSnapshot(branchName)],
      worktrees: [
        createRepoWorktreeSnapshotForTest(branchName, worktreePath, {
          headOid: '1111111111111111111111111111111111111111',
        }),
      ],
      currentBranchName: branchName,
      workspacePaneTabsByBranch: {
        [branchName]: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
      },
    })

    const result = renderWorkspacePane(workspaceId, {
      kind: 'git-worktree',
      worktreePath,
      route: { kind: 'static', tab: 'history' },
    })

    expect((await screen.findByRole('tab', { name: 'tab.log' })).getAttribute('aria-selected')).toBe('true')
    await waitFor(() =>
      expect(
        queryObserverCount(
          repoLogQueryKey(
            workspaceId,
            repo.workspaceRuntimeId,
            { kind: 'commit', oid: '1111111111111111111111111111111111111111' },
            100,
            0,
          ),
        ),
      ).toBeGreaterThan(0),
    )
    const snapshot = getRepoSnapshotQueryData(workspaceId, repo.workspaceRuntimeId)
    if (!snapshot) throw new Error('missing repository snapshot')
    await flushTestUpdates(() => {
      setRepoSnapshotQueryData(workspaceId, repo.workspaceRuntimeId, {
        ...snapshot,
        worktrees: [
          {
            path: worktreePath,
            head: { kind: 'detached' },
            headOid: '2222222222222222222222222222222222222222',
            operation: { kind: 'rebase' },
            materializedBranch: branchName,
            isPrimary: false,
            isLocked: false,
          },
        ],
      })
    })

    expect((await screen.findByRole('tab', { name: 'tab.log' })).getAttribute('aria-selected')).toBe('true')
    await waitFor(() =>
      expect(
        queryObserverCount(
          repoLogQueryKey(
            workspaceId,
            repo.workspaceRuntimeId,
            { kind: 'commit', oid: '2222222222222222222222222222222222222222' },
            100,
            0,
          ),
        ),
      ).toBeGreaterThan(0),
    )
    expect(screen.queryByText('workspace-route.not-found-title')).toBeNull()
    expect(screen.queryByText('workspace-pane-tabs.empty')).toBeNull()
  })

  test('renders an unborn worktree history as empty without requesting a commit', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///workspace/repo-unborn')
    const worktreePath = '/workspace/unborn'
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      worktrees: [
        {
          ...createRepoWorktreeSnapshotForTest('main', worktreePath),
          headOid: null,
        },
      ],
      currentBranchName: null,
    })
    const target = gitWorktreeWorkspacePaneTabsTarget(workspaceId, worktreePath)
    if (!target) throw new Error('expected canonical unborn worktree fixture')
    setWorkspacePaneTabsForTargetQueryData({
      ...target,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      tabs: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
    })

    const result = renderWorkspacePane(workspaceId, {
      kind: 'git-worktree',
      worktreePath,
      route: { kind: 'static', tab: 'history' },
    })

    expect(await screen.findByRole('tabpanel', { name: 'tab.log' })).toBeTruthy()
    expect(screen.getByText('log.empty')).toBeTruthy()
    expect(screen.queryByText('branches.missing')).toBeNull()
    expect(
      appQueryClient
        .getQueryCache()
        .getAll()
        .some(
          (query) => query.queryKey[0] === 'repo-data' && query.queryKey[3] === 'log' && query.getObserversCount() > 0,
        ),
    ).toBe(false)

    await result.rerender(
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
                  route: { kind: 'static', tab: 'status' },
                }}
              />
            </TerminalSessionReadScope>
          </TerminalSessionCommandScope>
        </AppNavigationProvider>
      </VueQueryClientScope>,
    )
    expect(screen.queryByText('branch-status.signal.commit')).toBeNull()
    expect(screen.queryByRole('button', { name: 'worktree-status.open-history' })).toBeNull()
  })

  test('renders detached worktree files despite an initial status failure', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///workspace/repo-stale-detached')
    const worktreePath = '/workspace/detached-stale'
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      worktrees: [detachedWorktreeSnapshot(worktreePath)],
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
      tabs: [workspacePaneStaticTabEntry('files')],
    })
    failWorktreeStatusQuery(workspaceId, repo.workspaceRuntimeId, 'status read failed')

    renderWorkspacePane(workspaceId, {
      kind: 'git-worktree',
      worktreePath,
      route: { kind: 'static', tab: 'files' },
    })

    expect(await screen.findByTestId('worktree-pane')).toBeTruthy()
    expect(screen.getByRole('tabpanel', { name: 'tab.files' })).toBeTruthy()
    expect(screen.queryByText('status.stale-title')).toBeNull()
    expect(screen.queryByText('error.failed-read-repo')).toBeNull()
  })

  test('renders a retryable error when detached worktree status initially fails', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///workspace/repo-failed-status')
    const worktreePath = '/workspace/detached-failed-status'
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      worktrees: [detachedWorktreeSnapshot(worktreePath)],
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
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    failWorktreeStatusQuery(workspaceId, repo.workspaceRuntimeId, 'status read failed')

    renderWorkspacePane(workspaceId, {
      kind: 'git-worktree',
      worktreePath,
      route: { kind: 'static', tab: 'status' },
    })

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'error.try-again' })).toBeTruthy()
    expect(screen.getByText('111111111111')).toBeTruthy()
    expect(screen.getByText('worktree-status.changes-unavailable')).toBeTruthy()
  })

  test('keeps detached worktree target status separate from file changes', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///workspace/repo-detached-overview')
    const worktreePath = '/workspace/detached-overview'
    const worktree = {
      ...detachedWorktreeSnapshot(worktreePath),
      operation: { kind: 'rebase' as const },
      materializedBranch: 'feature/rebase',
      isLocked: true,
    }
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branchSnapshots: [createBranchSnapshot('feature/rebase')],
      worktrees: [worktree],
      currentBranchName: null,
    })
    setRepoWorktreeStatusQueryData(workspaceId, repo.workspaceRuntimeId, {
      workspaceRuntimeId: repo.workspaceRuntimeId,
      status: [
        {
          path: worktreePath,
          isMain: false,
          entries: [{ x: 'M', y: ' ', path: 'changed.ts' }],
        },
      ],
      loadedAt: 1,
    })
    const target = gitWorktreeWorkspacePaneTabsTarget(workspaceId, worktreePath)
    if (!target) throw new Error('expected canonical detached worktree fixture')
    setWorkspacePaneTabsForTargetQueryData({
      ...target,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    const commitFilesystemWorkspacePaneRoute = vi.fn(async (_target, _route, options) => {
      options?.onCommit?.()
      return true
    })

    renderWorkspacePane(
      workspaceId,
      { kind: 'git-worktree', worktreePath, route: { kind: 'static', tab: 'status' } },
      { ...navigation, commitFilesystemWorkspacePaneRoute },
    )

    expect(await screen.findByRole('tabpanel', { name: 'tab.status' })).toBeTruthy()
    expect(screen.getByText('111111111111')).toBeTruthy()
    expect(screen.getByText('feature/rebase')).toBeTruthy()
    expect(screen.getByText('worktree-state.rebase')).toBeTruthy()
    expect(screen.getByText('branch-status.worktree.locked')).toBeTruthy()
    expect(screen.queryByText('changed.ts')).toBeNull()

    screen.getByRole('button', { name: 'worktree-status.open-history' }).click()

    await waitFor(() =>
      expect(commitFilesystemWorkspacePaneRoute).toHaveBeenCalledWith(
        {
          routeTarget: { kind: 'git-worktree', workspaceId, worktreePath },
          workspaceRuntimeId: repo.workspaceRuntimeId,
        },
        { kind: 'static', tab: 'history' },
        presentationOptions(),
      ),
    )

    screen.getByRole('button', { name: 'branch-status.changes-count' }).click()

    await waitFor(() =>
      expect(commitFilesystemWorkspacePaneRoute).toHaveBeenCalledWith(
        {
          routeTarget: { kind: 'git-worktree', workspaceId, worktreePath },
          workspaceRuntimeId: repo.workspaceRuntimeId,
        },
        { kind: 'static', tab: 'changes' },
        presentationOptions(),
      ),
    )
  })

  test('renders detached worktree files only in the Changes tab', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///workspace/repo-detached-changes')
    const worktreePath = '/workspace/detached-changes'
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      worktrees: [detachedWorktreeSnapshot(worktreePath)],
      currentBranchName: null,
    })
    setRepoWorktreeStatusQueryData(workspaceId, repo.workspaceRuntimeId, {
      workspaceRuntimeId: repo.workspaceRuntimeId,
      status: [
        {
          path: worktreePath,
          isMain: false,
          entries: [{ x: 'M', y: ' ', path: 'changed.ts' }],
        },
      ],
      loadedAt: 1,
    })
    const target = gitWorktreeWorkspacePaneTabsTarget(workspaceId, worktreePath)
    if (!target) throw new Error('expected canonical detached worktree fixture')
    setWorkspacePaneTabsForTargetQueryData({
      ...target,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      tabs: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('changes')],
    })

    renderWorkspacePane(workspaceId, {
      kind: 'git-worktree',
      worktreePath,
      route: { kind: 'static', tab: 'changes' },
    })

    expect(await screen.findByRole('tabpanel', { name: 'tab.changes' })).toBeTruthy()
    expect(screen.getByLabelText('changed.ts')).toBeTruthy()
    expect(screen.queryByText('111111111111')).toBeNull()
  })

  test('surfaces a stale snapshot while keeping an authoritative detached-worktree pane visible', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///workspace/repo-stale-snapshot')
    const worktreePath = '/workspace/detached-stale-snapshot'
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      worktrees: [detachedWorktreeSnapshot(worktreePath)],
      currentBranchName: null,
    })
    const snapshotQuery = appQueryClient.getQueryCache().find({
      queryKey: repoSnapshotQueryKey(workspaceId, repo.workspaceRuntimeId),
      exact: true,
    })
    if (!snapshotQuery) throw new Error('missing repository snapshot query')
    snapshotQuery.setState({ ...snapshotQuery.state, dataUpdatedAt: Date.now() + 60_000 })
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
    renderWorkspacePane(workspaceId, {
      kind: 'git-worktree',
      worktreePath,
      route: { kind: 'static', tab: 'files' },
    })

    expect(await screen.findByTestId('worktree-pane')).toBeTruthy()
    await flushTestUpdates(() => {
      snapshotQuery.setState({
        ...snapshotQuery.state,
        status: 'error',
        error: new Error('snapshot refresh failed'),
      })
    })

    expect(screen.getByTestId('worktree-pane')).toBeTruthy()
    expect(screen.getByText('status.stale-title')).toBeTruthy()
    expect(screen.getByText(/snapshot refresh failed/)).toBeTruthy()
  })

  test('restores a saved History tab from a bare detached-worktree route', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///workspace/repo-bare-worktree')
    const worktreePath = '/workspace/detached-bare'
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      worktrees: [detachedWorktreeSnapshot(worktreePath)],
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
      tabs: [
        workspacePaneStaticTabEntry('status'),
        workspacePaneStaticTabEntry('files'),
        workspacePaneStaticTabEntry('history'),
      ],
    })
    workspacesStore.getState().setWorkspacePaneTabForTarget(target, 'history')

    renderWorkspacePane(workspaceId, { kind: 'git-worktree', worktreePath, route: null })

    expect(await screen.findByTestId('worktree-pane')).toBeTruthy()
    await flushTestUpdates(async () => await Promise.resolve())
    expect(screen.getByRole('tab', { name: 'tab.log' }).getAttribute('aria-selected')).toBe('true')
    const workspace = workspacesStore.getState().workspaces[workspaceId]
    expect(workspace && preferredWorkspacePaneTabForTarget(workspace.ui, target)).toBe('history')
  })

  test.each(['merge', 'cherry-pick', 'revert'] as const)(
    'renders attached %s operation in the worktree-aware pane',
    async (operation) => {
      const workspaceId = workspaceIdForTest(`goblin+file:///workspace/repo-${operation}`)
      const branchName = `feature/${operation}`
      const worktreePath = `/workspace/${operation}`
      const repo = seedRepoWithReadModelForTest({
        id: workspaceId,
        branchSnapshots: [createBranchSnapshot(branchName)],
        worktrees: [
          {
            ...createRepoWorktreeSnapshotForTest(branchName, worktreePath),
            operation: { kind: operation },
          },
        ],
        currentBranchName: branchName,
      })
      setRepoWorktreeStatusQueryData(workspaceId, repo.workspaceRuntimeId, {
        workspaceRuntimeId: repo.workspaceRuntimeId,
        status: [{ path: worktreePath, isMain: false, entries: [] }],
        loadedAt: 1,
      })
      const target = gitWorktreeWorkspacePaneTabsTarget(workspaceId, worktreePath)
      if (!target) throw new Error('expected canonical operation worktree fixture')
      setWorkspacePaneTabsForTargetQueryData({
        ...target,
        workspaceRuntimeId: repo.workspaceRuntimeId,
        tabs: [workspacePaneStaticTabEntry('status')],
      })

      renderWorkspacePane(workspaceId, {
        kind: 'git-worktree',
        worktreePath,
        route: { kind: 'static', tab: 'status' },
      })

      expect(await screen.findByTestId('worktree-pane')).toBeTruthy()
      expect(screen.getByText(`worktree-state.${operation}`)).toBeTruthy()
    },
  )

  test('preserves canonical bare-worktree preference across attached and rebase transitions', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///workspace/repo-bare-worktree-transition')
    const branchName = 'feature/bare-transition'
    const worktreePath = '/workspace/bare-transition'
    const attachedWorktree = createRepoWorktreeSnapshotForTest(branchName, worktreePath)
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branchSnapshots: [createBranchSnapshot(branchName)],
      worktrees: [attachedWorktree],
      currentBranchName: branchName,
    })
    const target = gitWorktreeWorkspacePaneTabsTarget(workspaceId, worktreePath)
    if (!target) throw new Error('expected canonical worktree fixture')
    setWorkspacePaneTabsForTargetQueryData({
      ...target,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      tabs: [
        workspacePaneStaticTabEntry('status'),
        workspacePaneStaticTabEntry('files'),
        workspacePaneStaticTabEntry('history'),
      ],
    })
    workspacesStore.getState().setWorkspacePaneTabForTarget(target, 'history')

    renderWorkspacePane(workspaceId, { kind: 'git-worktree', worktreePath, route: null })

    expect((await screen.findByRole('tab', { name: 'tab.log' })).getAttribute('aria-selected')).toBe('true')

    const snapshot = getRepoSnapshotQueryData(workspaceId, repo.workspaceRuntimeId)
    if (!snapshot) throw new Error('missing repository snapshot')
    await flushTestUpdates(() => {
      setRepoSnapshotQueryData(workspaceId, repo.workspaceRuntimeId, {
        ...snapshot,
        worktrees: [
          {
            ...attachedWorktree,
            head: { kind: 'detached' },
            operation: { kind: 'rebase' },
            materializedBranch: branchName,
          },
        ],
      })
    })

    expect(await screen.findByTestId('worktree-pane')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'tab.log' }).getAttribute('aria-selected')).toBe('true')
    let workspace = workspacesStore.getState().workspaces[workspaceId]
    expect(workspace && preferredWorkspacePaneTabForTarget(workspace.ui, target)).toBe('history')

    await flushTestUpdates(() => {
      setRepoSnapshotQueryData(workspaceId, repo.workspaceRuntimeId, { ...snapshot, worktrees: [attachedWorktree] })
    })

    expect((await screen.findByRole('tab', { name: 'tab.log' })).getAttribute('aria-selected')).toBe('true')
    workspace = workspacesStore.getState().workspaces[workspaceId]
    expect(workspace && preferredWorkspacePaneTabForTarget(workspace.ui, target)).toBe('history')
  })

  test('accepts an explicit History route on a detached worktree', async () => {
    const tab = 'history' as const
    const workspaceId = workspaceIdForTest('goblin+file:///workspace/repo-detached-history')
    const worktreePath = '/workspace/detached-history'
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      worktrees: [detachedWorktreeSnapshot(worktreePath)],
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
      tabs: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry(tab)],
    })

    renderWorkspacePane(workspaceId, {
      kind: 'git-worktree',
      worktreePath,
      route: { kind: 'static', tab },
    })

    expect((await screen.findByRole('tab', { name: 'tab.log' })).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tabpanel', { name: 'tab.log' })).toBeTruthy()
    expect(screen.queryByText('workspace-route.not-found-title')).toBeNull()
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
                onBackToGitWorkspaceNavigator={onBackToNavigator}
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
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: directoryWorkspaceProbe(),
    })
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
        },
        { kind: 'static', tab: 'files' },
        presentationOptions(),
      ),
    )
  })

  test('uses the workspace-root route as presentation authority and persists its valid static tab', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/plain-routed-workspace')
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: directoryWorkspaceProbe(),
    })
    setWorkspacePaneTabsForTargetQueryData({
      kind: 'workspace-root',
      workspaceId,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      tabs: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
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

    expect(screen.getByText('tab.status')).toBeTruthy()
    expect(screen.queryByText('tab.terminal')).toBeNull()
  })
})
