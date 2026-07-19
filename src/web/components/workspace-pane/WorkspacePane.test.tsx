// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { WorkspacePane } from '#/web/components/workspace-pane/WorkspacePane.tsx'
import { gitWorktreePaneFilesystemTarget } from '#/web/workspace-pane/workspace-pane-filesystem-target.ts'
import {
  EMPTY_TERMINAL_SNAPSHOT,
  EMPTY_TERMINAL_WORKTREE_SNAPSHOT,
  TerminalSessionContext,
  TerminalSessionReadContext,
} from '#/web/components/terminal/terminal-session-context.ts'
import type {
  TerminalSessionContextValue,
  TerminalSessionReadContextValue,
  TerminalWorktreeSnapshot,
} from '#/web/components/terminal/types.ts'
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
import { createPrimaryWindowNavigationActions } from '#/web/primary-window-navigation-actions.ts'
import type { PrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import {
  createPullRequest,
  createBranchSnapshot,
  installWorkspacePaneTabsTestBridge,
  resetWorkspacesStore,
  seedRepoReadModelQueryData,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  repoWorktreeStatusQueryKey,
  setRepoProjectionQueryData,
  setRepoWorktreeStatusQueryData,
  workspaceDirectoryOverviewQueryKey,
} from '#/web/repo-data-query.ts'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { nextWorkspacePaneTabEntryAfterClose } from '#/web/workspace-pane/workspace-pane-tab-model.ts'
import { formatTerminalWorktreeKeyForPath } from '#/shared/terminal-worktree-key.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/test-utils/workspace-pane-tabs.ts'
import {
  createTerminalWithAdmissionForContextTest,
  terminalSessionContextForTest,
} from '#/web/test-utils/terminal-session-context.ts'
import { setTerminalSessionCommandBridgeForTest } from '#/web/test-utils/terminal-session-command-bridge.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import type { WorkspacePaneRoute } from '#/web/App.tsx'
import { resetWorkspacePaneActionQueueForTest } from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { runCloseWorkspacePaneTabCommand } from '#/web/commands/workspace-commands.ts'
import { recordWorkspacePaneTabOpener, workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { workspacePaneTabTargetForBranch } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { gitWorktreeWorkspacePaneTabsTarget } from '#/shared/workspace-pane-tabs-target.ts'
import {
  observedWorkspacePaneRouteCommitForTest,
  seedInitialObservedWorkspacePaneRouteForTest,
} from '#/web/test-utils/workspace-pane-navigation.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const responsiveMocks = vi.hoisted(() => ({ compact: false }))
vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useIsCompactUi: () => responsiveMocks.compact,
}))

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/repo-workspace-container-repo')
const presentationOptions = (options: { replace?: boolean } = {}) =>
  expect.objectContaining({ ...options, presentationToken: expect.any(Object) })

const terminalReadContext: TerminalSessionReadContextValue = {
  terminalWorktreeSnapshot: () => EMPTY_TERMINAL_WORKTREE_SNAPSHOT,
  subscribeTerminalWorktree: () => () => {},
  workspaceBellCount: () => 0,
  subscribeWorkspaceBellCount: () => () => {},
  snapshot: () => EMPTY_TERMINAL_SNAPSHOT,
  subscribeSnapshot: () => () => {},
}

const terminalCommandContext: TerminalSessionContextValue = terminalSessionContextForTest({
  createTerminal: vi.fn(async () => 'term-111111111111111111111'),
  registerHost: vi.fn(),
  unregisterHost: vi.fn(),
  selectTerminal: vi.fn(),
  scrollToBottom: vi.fn(),
  scrollLines: vi.fn(),
  clearBell: vi.fn(() => false),
  closeTerminalByDescriptor: vi.fn(async () => true),
  attach: vi.fn(),
  detach: vi.fn(),
  restart: vi.fn(),
  isTerminalFocusTarget: vi.fn(() => false),
  findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
  findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
  clearSearch: vi.fn(),
  writeInput: vi.fn(),
  takeover: vi.fn(async () => true),
  focusTerminal: vi.fn(),
})

const navigation: PrimaryWindowNavigationActions = {
  currentWorkspacePaneRoute: () => undefined,
  activateWorkspace: vi.fn(),
  closeWorkspace: vi.fn(),
  cycleWorkspace: vi.fn(),
  selectRepoBranch: vi.fn(),
  showRepoBranchEmptyWorkspacePane: () => true,
  showRepoBranchWorkspacePaneTab: vi.fn(),
  showRepoBranchTerminalSession: vi.fn(),
  commitWorkspacePaneRoute: vi.fn(() => false),
  goBack: vi.fn(),
  goForward: vi.fn(),
  openSettings: vi.fn(),
  openCreateWorktree: vi.fn(),
}

let workspacePaneTabsTestBridge: ReturnType<typeof installWorkspacePaneTabsTestBridge>

beforeEach(() => {
  responsiveMocks.compact = false
  resetWorkspacePaneActionQueueForTest()
  primaryWindowQueryClient.clear()
  resetWorkspacesStore()
  workspacePaneTabsTestBridge = installWorkspacePaneTabsTestBridge()
  useTerminalProjectionHydrationStore.setState({ hydrationByWorkspace: new Map(), refreshedAtByWorkspace: new Map() })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function directoryWorkspaceProbe(name: string, options: { filesWritable?: boolean; terminalAvailable?: boolean } = {}) {
  return {
    status: 'ready' as const,
    name,
    capabilities: {
      files: { read: true as const, write: options.filesWritable ?? true },
      terminal: { available: options.terminalAvailable ?? true },
      git: { status: 'unavailable' as const },
    },
    diagnostics: [],
  }
}

function gitWorktreeFilesystemTarget(repo: WorkspaceState, rootPath: string, branchName: string) {
  if (repo.capability.kind !== 'git') throw new Error('expected Git workspace fixture')
  return gitWorktreePaneFilesystemTarget({
    workspaceId: repo.id,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    worktreePath: rootPath,
    head: { kind: 'branch', branchName },
    capabilities: repo.capability.probe.capabilities,
  })
}

describe('WorkspacePane', () => {
  test('renders a remote non-Git workspace with canonical Status, Files, and Terminal targets', async () => {
    const workspaceId = workspaceIdForTest('goblin+ssh://example/srv/workspace')
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: directoryWorkspaceProbe('plain-workspace'),
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(workspaceId, repo.workspaceRuntimeId)

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
    expect(screen.getByText('tab.status')).toBeTruthy()
    expect(screen.queryByText('branches.empty')).toBeNull()
    const newTerminalButton = screen.getByRole('button', { name: 'terminal.new' }) as HTMLButtonElement
    await waitFor(() => expect(newTerminalButton.disabled).toBe(false))
    newTerminalButton.click()
    await waitFor(() => {
      expect(terminalCommandContext.createTerminalWithAdmission).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.objectContaining({ kind: 'workspace-root', workspaceId }),
          presentation: { kind: 'workspace-root' },
        }),
        undefined,
      )
    })
  })

  test('keeps the selected workspace-root pane when Git capability becomes available', async () => {
    const workspaceId = workspaceIdForTest('goblin+ssh://example/workspace')
    seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: directoryWorkspaceProbe('remote-workspace'),
    })

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={workspaceId}
                currentBranchName={null}
                workspacePaneRouteContext={{ kind: 'workspace-root' }}
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
                name: 'remote-workspace',
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
    const terminalWorktreeKey = formatTerminalWorktreeKeyForPath(workspaceId, worktreePath)

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContextWithSession(terminalWorktreeKey, terminalSessionId)}>
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

  test('uses the shared compact workspace toolbar back action for a non-Git workspace', () => {
    responsiveMocks.compact = true
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/plain-compact-workspace')
    seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: directoryWorkspaceProbe('plain-compact-workspace'),
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

    screen.getByRole('button', { name: 'workspace.back-to-branch-navigator' }).click()
    expect(onBackToNavigator).toHaveBeenCalledOnce()
  })

  test('renders directory overview data in the non-Git Status tab without a Git projection', () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/plain-status-workspace')
    seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: directoryWorkspaceProbe('plain-status-workspace'),
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
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('7')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('2.0 KB')).toBeTruthy()
  })

  test('does not expose a terminal surface when the workspace capability is unavailable', () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/files-only-workspace')
    seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: directoryWorkspaceProbe('files-only-workspace', {
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

  test('selects an existing workspace-root terminal after Files without a route transition', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/plain-terminal-workspace')
    const terminalSessionId = 'term-333333333333333333333'
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: directoryWorkspaceProbe('plain-terminal-workspace'),
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
    const terminalWorktreeKey = formatTerminalWorktreeKeyForPath(workspaceId, workspaceId)
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
    const workspaceTerminalReadContext = terminalReadContextWithSession(terminalWorktreeKey, terminalSessionId)
    const resetTerminalCommandBridge = setTerminalSessionCommandBridgeForTest({
      terminalWorktreeSnapshot: workspaceTerminalReadContext.terminalWorktreeSnapshot,
      createTerminal: terminalCommandContext.createTerminal,
      selectTerminal: terminalCommandContext.selectTerminal,
      closeTerminalByDescriptor,
    })
    const showWorkspaceRootPaneTab = vi.fn<NonNullable<PrimaryWindowNavigationActions['showWorkspaceRootPaneTab']>>(
      (_repoId, presentation, options) => {
        if (presentation.kind === 'terminal') {
          useWorkspacesStore.getState().setSelectedTerminal(terminalWorktreeKey, presentation.terminalSessionId)
        }
        useWorkspacesStore
          .getState()
          .setWorkspacePaneTabForTarget(
            { kind: 'workspace-root', workspaceId: workspaceId },
            presentation.kind === 'terminal' ? 'terminal' : presentation.tab,
          )
        options?.onCommit?.()
        return true
      },
    )
    const workspaceNavigation: PrimaryWindowNavigationActions = {
      ...navigation,
      showWorkspaceRootPaneTab,
    }

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={workspaceNavigation}>
          <TerminalSessionContext value={workspaceTerminalCommands}>
            <TerminalSessionReadContext value={workspaceTerminalReadContext}>
              <WorkspacePane workspaceId={workspaceId} workspacePaneRouteContext={{ kind: 'workspace-root' }} />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    expect(screen.getByRole('tabpanel', { name: 'tab.files' })).toBeTruthy()
    const terminalTab = screen.getByRole('tab', { name: terminalSessionId })
    act(() => terminalTab.click())

    expect(showWorkspaceRootPaneTab).toHaveBeenCalled()

    await waitFor(() => expect(screen.getByRole('tabpanel', { name: 'tab.terminal' })).toBeTruthy())
    expect(useWorkspacesStore.getState().selectedTerminalSessionIdByTerminalWorktree[terminalWorktreeKey]).toBe(
      terminalSessionId,
    )

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

  test('renders the shared empty pane when every workspace-root tab is closed', () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/empty-plain-workspace')
    const repo = seedRepoWithReadModelForTest({
      id: workspaceId,
      branches: [],
      currentBranchName: null,
      workspaceProbe: directoryWorkspaceProbe('empty-plain-workspace'),
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
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [],
      currentBranchName: null,
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

  test('shows a retryable error when the initial worktree status read fails', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('main')],
      currentBranchName: 'main',
    })
    primaryWindowQueryClient.removeQueries({ queryKey: repoWorktreeStatusQueryKey(REPO_ID, repo.workspaceRuntimeId) })
    await expect(
      primaryWindowQueryClient.fetchQuery({
        queryKey: repoWorktreeStatusQueryKey(REPO_ID, repo.workspaceRuntimeId),
        queryFn: async () => {
          throw new Error('status failed')
        },
        retry: false,
      }),
    ).rejects.toThrow('status failed')

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName="main"
                workspacePaneRouteContext={{ kind: 'routed', route: null }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('error.failed-read-repo')).toBeTruthy()
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'error.try-again' })).toBeTruthy()
    expect(screen.queryByTestId('repo-workspace-skeleton')).toBeNull()
  })

  test('can render after the repo appears without changing hook order', () => {
    const { container } = render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane workspaceId={REPO_ID} workspacePaneRouteContext={{ kind: 'routed', route: null }} />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    expect(() => {
      act(() => {
        seedRepoWithReadModelForTest({ id: REPO_ID, branches: [] })
      })
    }).not.toThrow()
    expect(screen.getByText('branches.empty')).toBeTruthy()
  })

  test('keeps the workspace tab strip mounted and restores scroll position by branch', () => {
    const branchA = createBranchSnapshot('feature/a', { worktree: { path: '/tmp/repo-workspace-container-repo-a' } })
    const branchB = createBranchSnapshot('feature/b', { worktree: { path: '/tmp/repo-workspace-container-repo-b' } })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [branchA, branchB],
      currentBranchName: 'feature/a',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/a': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
        'feature/b': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
      },
    })
    const { container, rerender } = render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName="feature/a"
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'status' } }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )
    const viewport = scrollViewport(container)
    act(() => {
      viewport.scrollLeft = 120
      viewport.dispatchEvent(new Event('scroll', { bubbles: true }))
    })

    act(() => {
      rerender(
        <QueryClientProvider client={primaryWindowQueryClient}>
          <PrimaryWindowNavigationProvider value={navigation}>
            <TerminalSessionContext value={terminalCommandContext}>
              <TerminalSessionReadContext value={terminalReadContext}>
                <WorkspacePane
                  workspaceId={REPO_ID}
                  currentBranchName="feature/b"
                  workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'status' } }}
                />
              </TerminalSessionReadContext>
            </TerminalSessionContext>
          </PrimaryWindowNavigationProvider>
        </QueryClientProvider>,
      )
    })

    expect(scrollViewport(container)).toBe(viewport)
    expect(viewport.scrollLeft).toBe(0)

    act(() => {
      viewport.scrollLeft = 40
      viewport.dispatchEvent(new Event('scroll', { bubbles: true }))
    })

    act(() => {
      rerender(
        <QueryClientProvider client={primaryWindowQueryClient}>
          <PrimaryWindowNavigationProvider value={navigation}>
            <TerminalSessionContext value={terminalCommandContext}>
              <TerminalSessionReadContext value={terminalReadContext}>
                <WorkspacePane
                  workspaceId={REPO_ID}
                  currentBranchName="feature/a"
                  workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'status' } }}
                />
              </TerminalSessionReadContext>
            </TerminalSessionContext>
          </PrimaryWindowNavigationProvider>
        </QueryClientProvider>,
      )
    })

    expect(scrollViewport(container)).toBe(viewport)
    expect(viewport.scrollLeft).toBe(120)
  })

  test('uses the React Query status read model for workspace presentation when available', () => {
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
    })
    seedRepoReadModelQueryData(repo, {
      branches: [branch],
      currentBranch: 'feature/a',
      status: [
        { path: worktreePath, branch: 'feature/a', isMain: false, entries: [{ x: 'M', y: ' ', path: 'changed.ts' }] },
      ],
    })

    const { container } = render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName="feature/a"
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'status' } }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    expect(container.querySelector('button[aria-label="status.copy-patch-title"]')).not.toBeNull()
  })

  test('keeps the last accepted status visible after a background refresh fails', () => {
    const worktreePath = '/tmp/repo-workspace-container-repo-stale'
    const branch = createBranchSnapshot('feature/stale', { worktree: { path: worktreePath } })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [branch],
      currentBranchName: 'feature/stale',
      preferredWorkspacePaneTab: 'changes',
      workspacePaneTabsByBranch: {
        'feature/stale': [workspacePaneStaticTabEntry('changes')],
      },
      status: [
        {
          path: worktreePath,
          branch: 'feature/stale',
          isMain: false,
          entries: [{ x: 'M', y: ' ', path: 'changed.ts' }],
        },
      ],
    })
    const statusQuery = primaryWindowQueryClient.getQueryCache().find({
      queryKey: repoWorktreeStatusQueryKey(REPO_ID, repo.workspaceRuntimeId),
      exact: true,
    })!
    statusQuery.setState({ ...statusQuery.state, status: 'error', error: new Error('status failed') })

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName="feature/stale"
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'changes' } }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    expect(screen.getByLabelText('changed.ts')).toBeTruthy()
    expect(screen.getByText('status.stale-title')).toBeTruthy()
    expect(screen.getByText(/status failed/)).toBeTruthy()
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
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    const terminalWorktreeKey = formatTerminalWorktreeKeyForPath(REPO_ID, worktreePath)
    const statusEntry = {
      workspaceId: REPO_ID,
      route: {
        kind: 'branch' as const,
        branchName: 'feature/a',
        workspacePaneTab: 'status' as const,
        terminalWorktreeKey,
        terminalSessionId: null,
      },
    }
    const terminalEntry = {
      workspaceId: REPO_ID,
      route: {
        kind: 'branch' as const,
        branchName: 'feature/a',
        workspacePaneTab: 'terminal' as const,
        terminalWorktreeKey,
        terminalSessionId: 'term-111111111111111111111',
      },
    }
    let terminalCreated = false
    const terminalListeners = new Set<() => void>()
    const createdTerminalReadContext = terminalReadContextWithSession(terminalWorktreeKey, 'term-111111111111111111111')
    const readContext: TerminalSessionReadContextValue = {
      ...terminalReadContext,
      terminalWorktreeSnapshot: (key) =>
        terminalCreated ? createdTerminalReadContext.terminalWorktreeSnapshot(key) : EMPTY_TERMINAL_WORKTREE_SNAPSHOT,
      subscribeTerminalWorktree: (_key, listener) => {
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
      useWorkspacesStore.getState().setSelectedTerminal(terminalWorktreeKey, terminalSessionId)
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
      await new Promise((resolve) => setTimeout(resolve, 0))
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
        terminalReadContextWithSession(terminalWorktreeKey, 'term-111111111111111111111'),
      ),
    )

    await waitFor(() => {
      expect(useWorkspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]?.backStack).toEqual([statusEntry])
      expect(useWorkspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]?.current).toEqual(terminalEntry)
    })

    act(() => {
      testNavigation.goBack(REPO_ID)
    })

    expect(route.openRepoBranchTab).toHaveBeenCalledWith(REPO_ID, 'feature/a', 'status', presentationOptions())
  })

  test('replaces a stale terminal route with the bare branch route', async () => {
    const worktreePath = '/tmp/repo-workspace-container-repo-a'
    const branchName = 'feature/a'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot(branchName, { worktree: { path: worktreePath } })],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        [branchName]: [
          workspacePaneStaticTabEntry('status'),
          workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
        ],
      },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    const terminalWorktreeKey = formatTerminalWorktreeKeyForPath(REPO_ID, worktreePath)
    const readContext = terminalReadContextWithSession(terminalWorktreeKey, 'term-111111111111111111111')
    const route = routeNavigation()
    const expectedCurrentEntry = {
      workspaceId: REPO_ID,
      route: {
        kind: 'branch' as const,
        branchName,
        workspacePaneTab: null,
        terminalWorktreeKey,
        terminalSessionId: null,
      },
    }
    vi.mocked(route.openRepoBranch).mockImplementation(() => {
      expect(useWorkspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]?.current).toEqual(expectedCurrentEntry)
      return true
    })

    const { container } = render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigationWithStore(route)}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={readContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRouteContext={{
                  kind: 'routed',
                  route: { kind: 'terminal', terminalSessionId: 'missing-session' },
                }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    expect(container.textContent).toContain('workspace-pane-tabs.empty')
    await waitFor(() => {
      expect(route.openRepoBranch).toHaveBeenCalledWith(REPO_ID, branchName, presentationOptions({ replace: true }))
      expect(route.openRepoBranchTerminal).not.toHaveBeenCalled()
      expect(useWorkspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]).toEqual({
        current: expectedCurrentEntry,
        backStack: [],
        forwardStack: [],
      })
    })
  })

  test('syncs a routed terminal session into the projection-owned terminal selection', async () => {
    const worktreePath = '/tmp/repo-workspace-container-repo-a'
    const branchName = 'feature/a'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot(branchName, { worktree: { path: worktreePath } })],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        [branchName]: [
          workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
          workspacePaneRuntimeTabEntry('terminal', 'term-222222222222222222222'),
        ],
      },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    const terminalWorktreeKey = formatTerminalWorktreeKeyForPath(REPO_ID, worktreePath)
    useWorkspacesStore.getState().setSelectedTerminal(terminalWorktreeKey, 'term-111111111111111111111')
    const route = routeNavigation()

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigationWithStore(route)}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext
              value={terminalReadContextWithSessions(terminalWorktreeKey, [
                'term-111111111111111111111',
                'term-222222222222222222222',
              ])}
            >
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRouteContext={{
                  kind: 'routed',
                  route: { kind: 'terminal', terminalSessionId: 'term-222222222222222222222' },
                }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(useWorkspacesStore.getState().selectedTerminalSessionIdByTerminalWorktree[terminalWorktreeKey]).toBe(
        'term-222222222222222222222',
      )
    })
    expect(route.openRepoBranchTerminal).not.toHaveBeenCalled()
  })

  test('does not sync a routed terminal session before terminal projection verifies the route', async () => {
    const worktreePath = '/tmp/repo-workspace-container-repo-a'
    const branchName = 'feature/a'
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot(branchName, { worktree: { path: worktreePath } })],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        [branchName]: [
          workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
          workspacePaneRuntimeTabEntry('terminal', 'term-222222222222222222222'),
        ],
      },
    })
    const terminalWorktreeKey = formatTerminalWorktreeKeyForPath(REPO_ID, worktreePath)
    useWorkspacesStore.getState().setSelectedTerminal(terminalWorktreeKey, 'term-222222222222222222222')
    const route = routeNavigation()

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigationWithStore(route)}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext
              value={terminalReadContextWithSessions(terminalWorktreeKey, [
                'term-111111111111111111111',
                'term-222222222222222222222',
              ])}
            >
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRouteContext={{
                  kind: 'routed',
                  route: { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
                }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(route.openRepoBranchTerminal).not.toHaveBeenCalled()
    expect(useWorkspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]).toBeUndefined()
    expect(useWorkspacesStore.getState().selectedTerminalSessionIdByTerminalWorktree[terminalWorktreeKey]).toBe(
      'term-222222222222222222222',
    )
  })

  test('preserves existing app history when canonicalizing a stale terminal route from another page', async () => {
    const worktreePath = '/tmp/repo-workspace-container-repo-a'
    const branchName = 'feature/a'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot(branchName, { worktree: { path: worktreePath } })],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        [branchName]: [
          workspacePaneStaticTabEntry('status'),
          workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
        ],
      },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    useWorkspacesStore.getState().recordWorkspaceNavigation({ workspaceId: REPO_ID, route: { kind: 'dashboard' } })
    const terminalWorktreeKey = formatTerminalWorktreeKeyForPath(REPO_ID, worktreePath)
    const route = routeNavigation()

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigationWithStore(route)}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext
              value={terminalReadContextWithSession(terminalWorktreeKey, 'term-111111111111111111111')}
            >
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRouteContext={{
                  kind: 'routed',
                  route: { kind: 'terminal', terminalSessionId: 'missing-session' },
                }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(route.openRepoBranch).toHaveBeenCalledWith(REPO_ID, branchName, presentationOptions({ replace: true }))
      expect(route.openRepoBranchTerminal).not.toHaveBeenCalled()
      expect(useWorkspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]).toEqual({
        current: {
          workspaceId: REPO_ID,
          route: {
            kind: 'branch',
            branchName,
            workspacePaneTab: null,
            terminalWorktreeKey,
            terminalSessionId: null,
          },
        },
        backStack: [{ workspaceId: REPO_ID, route: { kind: 'dashboard' } }],
        forwardStack: [],
      })
    })
  })

  test('does not replace a missing terminal route while terminal projection is pending', async () => {
    const worktreePath = '/tmp/repo-workspace-container-repo-a'
    const branchName = 'feature/a'
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot(branchName, { worktree: { path: worktreePath } })],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        [branchName]: [
          workspacePaneStaticTabEntry('status'),
          workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
          workspacePaneRuntimeTabEntry('terminal', 'term-222222222222222222222'),
        ],
      },
    })
    const terminalWorktreeKey = formatTerminalWorktreeKeyForPath(REPO_ID, worktreePath)
    useWorkspacesStore.getState().setSelectedTerminal(terminalWorktreeKey, 'term-222222222222222222222')
    const readContext = terminalReadContextWithSessions(
      terminalWorktreeKey,
      ['term-111111111111111111111', 'term-222222222222222222222'],
      'term-222222222222222222222',
    )
    const route = routeNavigation()

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigationWithStore(route)}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={readContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRouteContext={{
                  kind: 'routed',
                  route: { kind: 'terminal', terminalSessionId: 'missing-session' },
                }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(route.openRepoBranchTerminal).not.toHaveBeenCalled()
    expect(useWorkspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]).toBeUndefined()
    expect(useWorkspacesStore.getState().selectedTerminalSessionIdByTerminalWorktree[terminalWorktreeKey]).toBe(
      'term-222222222222222222222',
    )
  })

  test('does not reconcile a stale terminal route while terminal creation is pending', async () => {
    const worktreePath = '/tmp/repo-workspace-container-repo-a'
    const branchName = 'feature/a'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot(branchName, { worktree: { path: worktreePath } })],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        [branchName]: [
          workspacePaneStaticTabEntry('status'),
          workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
        ],
      },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    const terminalWorktreeKey = formatTerminalWorktreeKeyForPath(REPO_ID, worktreePath)
    const route = routeNavigation()

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigationWithStore(route)}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext
              value={terminalReadContextWithSessions(
                terminalWorktreeKey,
                ['term-111111111111111111111'],
                'term-111111111111111111111',
                {
                  createPending: true,
                },
              )}
            >
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRouteContext={{
                  kind: 'routed',
                  route: { kind: 'terminal', terminalSessionId: 'missing-session' },
                }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(route.openRepoBranchTerminal).not.toHaveBeenCalled()
    expect(route.openRepoBranch).not.toHaveBeenCalled()
    expect(useWorkspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]).toBeUndefined()
  })

  test('syncs a routed static tab after the branch projection appears', async () => {
    const branchName = 'feature/cold-route'

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigationWithStore()}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'history' } }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    act(() => {
      seedRepoWithReadModelForTest({
        id: REPO_ID,
        branchSnapshots: [createBranchSnapshot(branchName)],
        currentBranchName: branchName,
        preferredWorkspacePaneTab: 'status',
        workspacePaneTabsByBranch: {
          [branchName]: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
        },
      })
    })

    await waitFor(() => {
      const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
      expect(
        repo &&
          preferredWorkspacePaneTabForTarget(repo.ui, {
            kind: 'git-branch' as const,
            workspaceId: REPO_ID,
            branchName,
          }),
      ).toBe('history')
    })
  })

  test('syncs a routed bare branch as an empty workspace pane preference', async () => {
    const branchName = 'feature/empty-route'
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot(branchName)],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        [branchName]: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
      },
    })

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigationWithStore()}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRouteContext={{ kind: 'routed', route: null }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
      expect(
        repo &&
          preferredWorkspacePaneTabForTarget(repo.ui, {
            kind: 'git-branch' as const,
            workspaceId: REPO_ID,
            branchName,
          }),
      ).toBeNull()
    })
  })

  test('uses the persisted workspace pane tab when the pane has no active route context', () => {
    const branchName = 'feature/inactive-route'
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot(branchName, { worktree: { path: '/tmp/repo-workspace-inactive-worktree' } }),
      ],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        [branchName]: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })
    const route = routeNavigation()

    const { container } = render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigationWithStore(route)}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRouteContext={{ kind: 'inactive' }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    expect(container.textContent).not.toContain('workspace-pane-tabs.empty')
    expect(container.querySelector('[id$="-files-panel"]')).not.toBeNull()
    expect(route.openRepoBranch).not.toHaveBeenCalled()
  })

  test('returns from the files tab to status when files is opened from the status panel', async () => {
    const branchName = 'feature/status-files'
    const worktreePath = '/tmp/repo-workspace-status-files'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot(branchName, { worktree: { path: worktreePath } })],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        [branchName]: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })
    expect(
      recordWorkspacePaneTabOpener(
        {
          kind: 'git-worktree',
          workspaceId: REPO_ID,
          worktreePath,
        },
        repo.workspaceRuntimeId,
        'workspace-pane:files',
        'workspace-pane:status',
      ),
    ).toBe('recorded')

    function RoutedWorkspaceHarness() {
      const [route, setRoute] = useState<WorkspacePaneRoute | null>({ kind: 'static', tab: 'status' })
      const navigationWithRoute = useMemo<PrimaryWindowNavigationActions>(() => {
        const showRepoBranchEmptyWorkspacePane: PrimaryWindowNavigationActions['showRepoBranchEmptyWorkspacePane'] = (
          workspaceId,
          nextBranch,
        ) => {
          useWorkspacesStore.getState().setWorkspacePaneTab(workspaceId, nextBranch, null)
          setRoute(null)
          return true
        }
        const showRepoBranchWorkspacePaneTab: PrimaryWindowNavigationActions['showRepoBranchWorkspacePaneTab'] = (
          workspaceId,
          nextBranch,
          tab,
        ) => {
          useWorkspacesStore.getState().setWorkspacePaneTab(workspaceId, nextBranch, tab)
          setRoute({ kind: 'static', tab })
          return true
        }
        seedInitialObservedWorkspacePaneRouteForTest()
        const routedNavigation: PrimaryWindowNavigationActions = {
          ...navigation,
          showRepoBranchEmptyWorkspacePane,
          showRepoBranchWorkspacePaneTab,
          showRepoBranchTerminalSession: () => false,
          commitWorkspacePaneRoute: () => false,
        }
        routedNavigation.commitWorkspacePaneRoute = observedWorkspacePaneRouteCommitForTest(routedNavigation, {
          observeAcceptedRoute: () => {},
        })
        return routedNavigation
      }, [])
      const routeLabel = route?.kind === 'static' ? route.tab : route?.kind === 'terminal' ? 'terminal' : 'empty'
      return (
        <PrimaryWindowNavigationProvider value={navigationWithRoute}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <div data-testid="workspace-route">{routeLabel}</div>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRouteContext={{ kind: 'routed', route }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      )
    }

    const { container } = render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <RoutedWorkspaceHarness />
      </QueryClientProvider>,
    )

    const pathButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === worktreePath,
    )
    expect(pathButton).not.toBeNull()

    act(() => {
      pathButton?.click()
    })

    await waitFor(() => {
      expect(screen.getByTestId('workspace-route').textContent).toBe('files')
    })
    const paneTarget = {
      kind: 'git-worktree' as const,
      workspaceId: REPO_ID,
      worktreePath,
    }
    expect(workspacePaneTabOpener(paneTarget, repo.workspaceRuntimeId, 'workspace-pane:files')).toBe(
      'workspace-pane:status',
    )
    const closeTarget = workspacePaneTabTargetForBranch(REPO_ID, branchName, {
      workspacePaneRoute: { kind: 'static', tab: 'files' },
    })
    expect(closeTarget?.tabs.map((tab) => tab.identity)).toEqual(['workspace-pane:status', 'workspace-pane:files'])
    expect(
      closeTarget
        ? nextWorkspacePaneTabEntryAfterClose(
            closeTarget.tabEntries,
            'workspace-pane:files',
            workspacePaneTabOpener(paneTarget, repo.workspaceRuntimeId, 'workspace-pane:files'),
          )?.type
        : null,
    ).toBe('status')

    const filesTab = container.querySelector('[data-workspace-pane-tab-tooltip-id="workspace-pane:files"]')
    const filesCloseButton = filesTab
      ? Array.from(filesTab.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
          (button.getAttribute('aria-label') ?? '').includes('workspace-pane-tabs.close-named'),
        )
      : null
    expect(filesCloseButton).not.toBeNull()

    act(() => {
      filesCloseButton?.click()
    })

    await waitFor(() => {
      expect(screen.getByTestId('workspace-route').textContent).toBe('status')
    })
  })

  test('defers stale static route replacement while active tab close is pending', async () => {
    const branchName = 'feature/close-route-race'
    const worktreePath = '/tmp/close-route-race-worktree'
    const route = routeNavigation()
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot(branchName, { worktree: { path: worktreePath } })],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        [branchName]: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })
    const actions = navigationWithStore(route)
    let resolveCommit!: (tabs: Array<ReturnType<typeof workspacePaneStaticTabEntry>>) => void
    let resolveCommitStarted!: () => void
    const commitStarted = new Promise<void>((resolve) => {
      resolveCommitStarted = resolve
    })
    installWorkspacePaneTabsTestBridge({
      updateWorkspaceTabs: () => {
        resolveCommitStarted()
        return new Promise((resolve) => {
          resolveCommit = resolve
        })
      },
    })

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={actions}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'files' } }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )
    const filesHistoryEntry = {
      workspaceId: REPO_ID,
      route: {
        kind: 'branch' as const,
        branchName,
        workspacePaneTab: 'files' as const,
        terminalWorktreeKey: formatTerminalWorktreeKeyForPath(REPO_ID, worktreePath),
        terminalSessionId: null,
      },
    }
    await waitFor(() => {
      expect(useWorkspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]?.current).toEqual(filesHistoryEntry)
    })
    vi.mocked(route.openRepoBranch).mockClear()
    vi.mocked(route.openRepoBranchTab).mockClear()

    const closePromise = runCloseWorkspacePaneTabCommand({
      workspaceId: REPO_ID,
      target: {
        kind: 'git-worktree',
        workspacePaneRoute: { kind: 'static', tab: 'files' },
        filesystemTarget: gitWorktreeFilesystemTarget(repo, worktreePath, branchName),
      },
      navigation: actions,
    })
    await commitStarted

    act(() => {
      setWorkspacePaneTabsForTargetQueryData({
        workspaceId: REPO_ID,
        workspaceRuntimeId: repo.workspaceRuntimeId,
        branchName,
        worktreePath,
        tabs: [workspacePaneStaticTabEntry('status')],
      })
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(route.openRepoBranch).not.toHaveBeenCalled()
    expect(route.openRepoBranchTab).not.toHaveBeenCalled()
    expect(useWorkspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]?.current).toEqual(filesHistoryEntry)

    resolveCommit([workspacePaneStaticTabEntry('status')])

    await expect(closePromise).resolves.toBe(true)
    expect(route.openRepoBranchTab).toHaveBeenCalledWith(REPO_ID, branchName, 'status', presentationOptions())
  })

  test('reports a successful close and reconciles after close-back navigation rejects', async () => {
    const branchName = 'feature/close-route-rejected'
    const worktreePath = '/tmp/close-route-rejected-worktree'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot(branchName, { worktree: { path: worktreePath } })],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: {
        [branchName]: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })
    const route = routeNavigation()
    vi.mocked(route.openRepoBranchTab).mockImplementation(() => {
      throw new Error('navigation rejected')
    })
    const actions = navigationWithStore(route)

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={actions}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'files' } }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )
    vi.mocked(route.openRepoBranch).mockClear()

    await expect(
      runCloseWorkspacePaneTabCommand({
        workspaceId: REPO_ID,
        target: {
          kind: 'git-worktree',
          workspacePaneRoute: { kind: 'static', tab: 'files' },
          filesystemTarget: gitWorktreeFilesystemTarget(repo, worktreePath, branchName),
        },
        navigation: actions,
      }),
    ).resolves.toBe(true)

    await waitFor(() => {
      expect(route.openRepoBranch).toHaveBeenCalledWith(REPO_ID, branchName, presentationOptions({ replace: true }))
    })
  })

  test('replaces an unrenderable static route with the bare branch route', async () => {
    const branchName = 'feature/no-worktree'
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot(branchName)],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'changes',
      workspacePaneTabsByBranch: {
        [branchName]: [workspacePaneStaticTabEntry('status')],
      },
    })
    const route = routeNavigation()

    const { container } = render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigationWithStore(route)}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'changes' } }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    expect(container.textContent).toContain('workspace-pane-tabs.empty')
    await waitFor(() => {
      expect(route.openRepoBranch).toHaveBeenCalledWith(REPO_ID, branchName, presentationOptions({ replace: true }))
      expect(route.openRepoBranchTab).not.toHaveBeenCalled()
      expect(useWorkspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]).toEqual({
        current: {
          workspaceId: REPO_ID,
          route: {
            kind: 'branch',
            branchName,
            workspacePaneTab: null,
            terminalWorktreeKey: null,
            terminalSessionId: null,
          },
        },
        backStack: [],
        forwardStack: [],
      })
    })
  })

  test('replaces an unrenderable route with the bare branch route when the pane is empty', async () => {
    const branchName = 'feature/empty-pane'
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot(branchName)],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        [branchName]: [],
      },
    })
    const route = routeNavigation()

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigationWithStore(route)}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'changes' } }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(route.openRepoBranch).toHaveBeenCalledWith(REPO_ID, branchName, presentationOptions({ replace: true }))
      expect(route.openRepoBranchTab).not.toHaveBeenCalled()
      expect(useWorkspacesStore.getState().navigationHistoryByWorkspace[REPO_ID]).toEqual({
        current: {
          workspaceId: REPO_ID,
          route: {
            kind: 'branch',
            branchName,
            workspacePaneTab: null,
            terminalWorktreeKey: null,
            terminalSessionId: null,
          },
        },
        backStack: [],
        forwardStack: [],
      })
      const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
      expect(
        repo &&
          preferredWorkspacePaneTabForTarget(repo.ui, {
            kind: 'git-branch' as const,
            workspaceId: REPO_ID,
            branchName,
          }),
      ).toBe('status')
    })
  })

  test('uses the React Query projection read model for workspace branch presentation when available', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [],
      currentBranchName: 'feature/query',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/query': [workspacePaneStaticTabEntry('status')],
      },
    })
    seedRepoReadModelQueryData(repo, {
      branches: [createBranchSnapshot('feature/query')],
      currentBranch: 'feature/query',
    })

    const { container } = render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName="feature/query"
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'status' } }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    expect(container.textContent).toContain('feature/query')
    expect(container.textContent).not.toContain('branches.empty')
  })

  test('uses the React Query projection for the current branch pull request when available', () => {
    const branch = createBranchSnapshot('feature/pr')
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [branch],
      currentBranchName: 'feature/pr',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/pr': [workspacePaneStaticTabEntry('status')],
      },
    })
    const pullRequest = createPullRequest(42, { headRefName: 'feature/pr' })
    setRepoProjectionQueryData(REPO_ID, repo.workspaceRuntimeId, 'feature/pr', 'full', {
      snapshot: { current: 'feature/pr', branches: [branch] },
      pullRequests: [{ branch: 'feature/pr', pullRequest }],
      operations: { operations: [], loadedAt: 123 },
      requested: { branch: 'feature/pr', pullRequestMode: 'full' },
      loadedAt: 123,
    })

    const { container } = render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <WorkspacePane
                workspaceId={REPO_ID}
                currentBranchName="feature/pr"
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'status' } }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    expect(container.querySelector('[data-pull-request-link=""]')).not.toBeNull()
  })
})

function scrollViewport(container: HTMLElement): HTMLDivElement {
  const viewport = container.querySelector<HTMLDivElement>('[data-radix-scroll-area-viewport]')
  if (!viewport) throw new Error('missing workspace tab strip scroll viewport')
  return viewport
}

function terminalReadContextWithSession(
  terminalWorktreeKey: string,
  terminalSessionId: string,
): TerminalSessionReadContextValue {
  return terminalReadContextWithSessions(terminalWorktreeKey, [terminalSessionId], terminalSessionId)
}

function terminalReadContextWithSessions(
  terminalWorktreeKey: string,
  terminalSessionIds: readonly string[],
  selectedTerminalSessionId: string | null = terminalSessionIds[0] ?? null,
  options: { createPending?: boolean } = {},
): TerminalSessionReadContextValue {
  const snapshot: TerminalWorktreeSnapshot = {
    terminalWorktreeKey,
    selectedDescriptor: null,
    sessions: terminalSessionIds.map((terminalSessionId, index) => ({
      type: 'terminal',
      terminalSessionId,
      terminalWorktreeKey,
      index: index + 1,
      title: terminalSessionId,
      phase: 'open',
      selected: terminalSessionId === selectedTerminalSessionId,
      hasBell: false,
      hasRecentOutput: false,
    })),
    count: terminalSessionIds.length,
    bellCount: 0,
    outputActiveCount: 0,
    createPending: options.createPending ?? false,
  }
  return {
    ...terminalReadContext,
    terminalWorktreeSnapshot: (key) => (key === terminalWorktreeKey ? snapshot : EMPTY_TERMINAL_WORKTREE_SNAPSHOT),
  }
}

function navigationWithStore(
  routeNavigationOverrides: PrimaryWindowRouteNavigation = routeNavigation(),
): PrimaryWindowNavigationActions {
  seedInitialObservedWorkspacePaneRouteForTest()
  const store = useWorkspacesStore.getState()
  const navigation = createPrimaryWindowNavigationActions({
    currentWorkspaceId: REPO_ID,
    workspaceOrder: [REPO_ID],
    closeWorkspace: store.closeWorkspace,
    peekWorkspaceNavigation: store.peekWorkspaceNavigation,
    commitWorkspaceNavigation: store.commitWorkspaceNavigation,
    routeNavigation: routeNavigationOverrides,
  })
  const commitRoute = navigation.commitWorkspacePaneRoute
  navigation.commitWorkspacePaneRoute = observedWorkspacePaneRouteCommitForTest(navigation, { commitRoute })
  return navigation
}

function routeNavigation(): PrimaryWindowRouteNavigation {
  return {
    workspaceSlugForId: vi.fn(() => 'repo-workspace-container-repo'),
    currentWorkspacePaneRoute: () => undefined,
    openHome: vi.fn(),
    openSettings: vi.fn(),
    closeSettings: vi.fn(),
    openWorkspaceNavigator: vi.fn(),
    openWorkspaceDashboard: vi.fn(),
    openWorkspaceRootPane: vi.fn(),
    openRepoBranch: vi.fn((_repoId, _branchName, options) => {
      options?.onCommit?.()
      return true
    }),
    openRepoBranchTab: vi.fn((_repoId, _branchName, _tab, options) => {
      options?.onCommit?.()
      return true
    }),
    openRepoBranchTerminal: vi.fn((_repoId, _branchName, _sessionId, options) => {
      options?.onCommit?.()
      return true
    }),
    openRepoWorktree: vi.fn((_repoId, _worktreePath, options) => {
      options?.onCommit?.()
      return true
    }),
    openRepoNewWorktree: vi.fn(),
    cancelRepoNewWorktree: vi.fn(),
  }
}
