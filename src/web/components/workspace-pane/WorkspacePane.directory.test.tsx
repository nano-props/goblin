// @vitest-environment jsdom

import { act, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { WorkspacePane } from '#/web/components/workspace-pane/WorkspacePane.tsx'
import {
  TerminalSessionContext,
  TerminalSessionReadContext,
} from '#/web/components/terminal/terminal-session-context.ts'
import { PrimaryWindowNavigationProvider } from '#/web/primary-window-navigation.tsx'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { seedRepoWithReadModelForTest } from '#/web/test-utils/repo-store.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
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
import { useHostInfoStore } from '#/web/stores/host-info.ts'
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
  useIsCompactUi: () => responsiveMocks.compact,
}))

beforeEach(() => {
  responsiveMocks.compact = false
})

describe('WorkspacePane directory workspaces', () => {
  test('renders a remote non-Git workspace with canonical Status, Files, and Terminal targets', async () => {
    const workspaceId = workspaceIdForTest('goblin+ssh://example/srv/workspace')
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: directoryWorkspaceProbe(),
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(workspaceId, repo.workspaceRuntimeId)
    const commitWorkspaceRootTerminalSession = vi.fn(async () => true)
    const terminalCreate = Promise.withResolvers<string>()
    const createTerminal = vi.fn(async () => await terminalCreate.promise)
    const deferredTerminalCommandContext = terminalSessionContextForTest({
      ...terminalCommandContext,
      createTerminal,
      createTerminalWithAdmission: createTerminalWithAdmissionForContextTest(createTerminal),
    })

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={{ ...navigation, commitWorkspaceRootTerminalSession }}>
          <TerminalSessionContext value={deferredTerminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={workspaceId}
                workspacePaneRouteContext={{ kind: 'workspace-root', route: { kind: 'static', tab: 'files' } }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    expect(screen.getByText('tab.files')).toBeTruthy()
    expect(screen.getByText('tab.status')).toBeTruthy()
    expect(screen.queryByText('branches.empty')).toBeNull()
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

  test('renders shared external app actions for a local non-Git workspace', () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/filesystem-toolbar-workspace')
    seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: directoryWorkspaceProbe(),
    })
    primaryWindowQueryClient.setQueryData(externalAppsQueryKey(), {
      terminal: {
        available: true,
        appAvailability: { ghostty: true, terminal: true, windowsTerminal: false },
        detectedAt: 1,
      },
      editor: { available: true, appAvailability: { vscode: true }, detectedAt: 1 },
    })
    useHostInfoStore.setState({
      snapshot: { homeDir: '/Users/tester', platform: 'darwin', hostname: 'test-host', pid: 1 },
      status: 'ready',
      error: null,
    })

    const { container } = render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={workspaceId}
                workspacePaneRouteContext={{ kind: 'workspace-root', route: { kind: 'static', tab: 'files' } }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    expect(container.querySelector('[data-testid="workspace-open-externally-menu-primary"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="workspace-open-externally-menu-trigger"]')).not.toBeNull()
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
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={workspaceId}
                currentBranchName={null}
                workspacePaneRouteContext={{ kind: 'workspace-root', route: null }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    expect(screen.getByText('tab.files')).toBeTruthy()
    act(() => {
      useWorkspacesStore.setState((state) => {
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
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext
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
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
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
    const statusQuery = primaryWindowQueryClient.getQueryCache().find({
      queryKey: repoWorktreeStatusQueryKey(workspaceId, repo.workspaceRuntimeId),
      exact: true,
    })
    if (!statusQuery) throw new Error('missing worktree-status query')
    statusQuery.setState({ ...statusQuery.state, status: 'error', error: new Error('status refresh failed') })

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={workspaceId}
                currentBranchName={null}
                workspacePaneRouteContext={{
                  kind: 'git-worktree',
                  worktreePath,
                  route: { kind: 'static', tab: 'files' },
                }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
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
    useWorkspacesStore.getState().setWorkspacePaneTabForTarget(target, 'files')

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={workspaceId}
                currentBranchName={null}
                workspacePaneRouteContext={{ kind: 'git-worktree', worktreePath, route: null }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    expect(await screen.findByTestId('detached-worktree-pane')).toBeTruthy()
    await act(async () => await Promise.resolve())
    expect(screen.getByRole('tab', { name: 'tab.files' }).getAttribute('aria-selected')).toBe('true')
    const workspace = useWorkspacesStore.getState().workspaces[workspaceId]
    expect(workspace && preferredWorkspacePaneTabForTarget(workspace.ui, target)).toBe('files')
  })

  test('uses the shared compact workspace toolbar back action for a non-Git workspace', () => {
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
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={workspaceId}
                workspacePaneRouteContext={{ kind: 'routed', route: null }}
                onBackToBranchNavigator={onBackToNavigator}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    screen.getByRole('button', { name: 'workspace.back-to-workspace-navigator' }).click()
    expect(onBackToNavigator).toHaveBeenCalledOnce()
  })

  test('renders directory overview data in the non-Git Status tab without a Git projection', () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/plain-status-workspace')
    seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: directoryWorkspaceProbe(),
    })
    const repo = useWorkspacesStore.getState().workspaces[workspaceId]!
    useWorkspacesStore
      .getState()
      .setWorkspacePaneTabForTarget({ kind: 'workspace-root', workspaceId: workspaceId }, 'status')
    primaryWindowQueryClient.setQueryData(workspaceDirectoryOverviewQueryKey(workspaceId, repo.workspaceRuntimeId), {
      topLevelFileCount: 7,
      topLevelDirectoryCount: 3,
      totalSizeBytes: 2048,
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
    expect(screen.getByText('2.0 KB')).toBeTruthy()
  })

  test('marks an unavailable directory size for attention while leaving ordinary counts neutral', () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/plain-status-unavailable-size')
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: directoryWorkspaceProbe(),
    })
    useWorkspacesStore.getState().setWorkspacePaneTabForTarget({ kind: 'workspace-root', workspaceId }, 'status')
    primaryWindowQueryClient.setQueryData(workspaceDirectoryOverviewQueryKey(workspaceId, repo.workspaceRuntimeId), {
      topLevelFileCount: 1,
      topLevelDirectoryCount: 2,
      totalSizeBytes: null,
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

    const unavailableSize = screen.getByText('—').closest('[role="listitem"]')
    expect(unavailableSize?.querySelector('svg')?.parentElement?.className).toContain('text-attention')
    expect(
      screen.getByText('1').closest('[role="listitem"]')?.querySelector('svg')?.parentElement?.className,
    ).toContain('text-muted-foreground')
  })

  test('opens Files from the working-directory row in a non-Git Status tab', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/plain-status-files-workspace')
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: directoryWorkspaceProbe(),
    })
    useWorkspacesStore.getState().setWorkspacePaneTabForTarget({ kind: 'workspace-root', workspaceId }, 'status')
    primaryWindowQueryClient.setQueryData(workspaceDirectoryOverviewQueryKey(workspaceId, repo.workspaceRuntimeId), {
      topLevelFileCount: 1,
      topLevelDirectoryCount: 2,
      totalSizeBytes: 3,
    })
    const commitFilesystemWorkspacePaneRoute = vi.fn(async (_target, _route, options) => {
      options?.onCommit?.()
      return true
    })

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={{ ...navigation, commitFilesystemWorkspacePaneRoute }}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane workspaceId={workspaceId} workspacePaneRouteContext={{ kind: 'routed', route: null }} />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
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
    useWorkspacesStore.getState().setWorkspacePaneTabForTarget({ kind: 'workspace-root', workspaceId }, 'status')

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={workspaceId}
                workspacePaneRouteContext={{ kind: 'workspace-root', route: { kind: 'static', tab: 'files' } }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    expect(screen.getByRole('tab', { name: 'tab.files' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'tab.status' }).getAttribute('aria-selected')).toBe('false')
    await waitFor(() => {
      const workspace = useWorkspacesStore.getState().workspaces[workspaceId]
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
    useWorkspacesStore.getState().setWorkspacePaneTabForTarget({ kind: 'workspace-root', workspaceId }, 'status')

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={workspaceId}
                workspacePaneRouteContext={{ kind: 'workspace-root', route: null }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    await act(async () => await Promise.resolve())
    expect(screen.getByRole('tab', { name: 'tab.status' }).getAttribute('aria-selected')).toBe('true')
    const workspace = useWorkspacesStore.getState().workspaces[workspaceId]
    expect(workspace && preferredWorkspacePaneTabForTarget(workspace.ui, { kind: 'workspace-root', workspaceId })).toBe(
      'status',
    )
  })

  test('does not expose a terminal surface when the workspace capability is unavailable', () => {
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

    expect(screen.getByText('tab.files')).toBeTruthy()
    expect(screen.queryByText('tab.terminal')).toBeNull()
  })
})
