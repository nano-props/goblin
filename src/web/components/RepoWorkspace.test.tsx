// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoWorkspace } from '#/web/components/RepoWorkspace.tsx'
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
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import {
  PrimaryWindowNavigationProvider,
  type PrimaryWindowNavigationActions,
} from '#/web/primary-window-navigation.tsx'
import { createPrimaryWindowNavigationActions } from '#/web/primary-window-navigation-actions.ts'
import type { PrimaryWindowRouteNavigation } from '#/web/primary-window-route-navigation.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  createPullRequest,
  createRepoBranch,
  installWorkspacePaneTabsTestBridge,
  resetReposStore,
  seedRepoReadModelQueryData,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { repoWorktreeStatusQueryKey, setRepoProjectionQueryData } from '#/web/repo-data-query.ts'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { nextRepoWorkspaceTabAfterClose } from '#/web/workspace-pane/repo-workspace-tab-model.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/test-utils/workspace-pane-tabs.ts'
import {
  createTerminalWithAdmissionForContextTest,
  terminalSessionContextForTest,
} from '#/web/test-utils/terminal-session-context.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/repos/workspace-pane-preferences.ts'
import type { RepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import { resetWorkspacePaneActionQueueForTest } from '#/web/workspace-pane/workspace-pane-action-queue.ts'
import { runCloseWorkspacePaneTabCommand } from '#/web/commands/workspace-commands.ts'
import { recordWorkspacePaneTabOpener, workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { workspacePaneTabTargetForBranch } from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import {
  observedWorkspacePaneRouteCommitForTest,
  seedInitialObservedWorkspacePaneRouteForTest,
} from '#/web/test-utils/workspace-pane-navigation.ts'

const responsiveMocks = vi.hoisted(() => ({ compact: false }))
vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useIsCompactUi: () => responsiveMocks.compact,
}))

const REPO_ID = '/tmp/repo-workspace-container-repo'
const presentationOptions = (options: { replace?: boolean } = {}) =>
  expect.objectContaining({ ...options, presentationToken: expect.any(Object) })

const terminalReadContext: TerminalSessionReadContextValue = {
  terminalWorktreeSnapshot: () => EMPTY_TERMINAL_WORKTREE_SNAPSHOT,
  subscribeTerminalWorktree: () => () => {},
  repoBellCount: () => 0,
  subscribeRepoBellCount: () => () => {},
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
  showWorkspaceFiles: vi.fn(),
  currentRepoBranchWorkspacePaneRoute: () => undefined,
  activateRepo: vi.fn(),
  closeRepo: vi.fn(),
  cycleRepo: vi.fn(),
  selectRepoBranch: vi.fn(),
  showRepoBranchEmptyWorkspacePane: () => true,
  showRepoBranchWorkspacePaneTab: vi.fn(),
  showRepoBranchTerminalSession: vi.fn(),
  commitRepoBranchWorkspacePaneRoute: vi.fn(() => false),
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
  resetReposStore()
  workspacePaneTabsTestBridge = installWorkspacePaneTabsTestBridge()
  useTerminalProjectionHydrationStore.setState({ hydrationByRepo: new Map(), refreshedAtByRepo: new Map() })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RepoWorkspace', () => {
  test('renders a non-Git workspace directly as a Files surface', async () => {
    const workspaceId = 'goblin+file:///tmp/plain-workspace'
    seedRepoWithReadModelForTest({ id: workspaceId, branches: [], currentBranchName: null })
    useReposStore.setState((state) => ({
      repos: {
        ...state.repos,
        [workspaceId]: {
          ...state.repos[workspaceId]!,
          workspaceProbe: {
            status: 'ready',
            name: 'plain-workspace',
            capabilities: {
              files: { read: true, write: true },
              terminal: { available: true },
              git: { status: 'unavailable' },
            },
            diagnostics: [],
          },
        },
      },
    }))

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <RepoWorkspace
                repoId={workspaceId}
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'history' } }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    expect(screen.getByText('tab.files')).toBeTruthy()
    expect(screen.queryByText('branches.empty')).toBeNull()
    await waitFor(() => {
      expect(navigation.showWorkspaceFiles).toHaveBeenCalledWith(workspaceId, { replace: true })
    })
  })

  test('forwards compact missing-branch recovery to the workspace navigation callback', () => {
    responsiveMocks.compact = true
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [],
      currentBranchName: null,
    })
    const onBackToBranchNavigator = vi.fn()

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <RepoWorkspace
                repoId={REPO_ID}
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
      branches: [createRepoBranch('main')],
      currentBranchName: 'main',
    })
    primaryWindowQueryClient.removeQueries({ queryKey: repoWorktreeStatusQueryKey(REPO_ID, repo.repoRuntimeId) })
    await expect(
      primaryWindowQueryClient.fetchQuery({
        queryKey: repoWorktreeStatusQueryKey(REPO_ID, repo.repoRuntimeId),
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
              <RepoWorkspace
                repoId={REPO_ID}
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
              <RepoWorkspace repoId={REPO_ID} workspacePaneRouteContext={{ kind: 'routed', route: null }} />
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
    const branchA = createRepoBranch('feature/a', { worktree: { path: '/tmp/repo-workspace-container-repo-a' } })
    const branchB = createRepoBranch('feature/b', { worktree: { path: '/tmp/repo-workspace-container-repo-b' } })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branchA, branchB],
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
              <RepoWorkspace
                repoId={REPO_ID}
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
                <RepoWorkspace
                  repoId={REPO_ID}
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
                <RepoWorkspace
                  repoId={REPO_ID}
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
    const branch = createRepoBranch('feature/a', { worktree: { path: worktreePath } })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
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
              <RepoWorkspace
                repoId={REPO_ID}
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
    const branch = createRepoBranch('feature/stale', { worktree: { path: worktreePath } })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
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
      queryKey: repoWorktreeStatusQueryKey(REPO_ID, repo.repoRuntimeId),
      exact: true,
    })!
    statusQuery.setState({ ...statusQuery.state, status: 'error', error: new Error('status failed') })

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <RepoWorkspace
                repoId={REPO_ID}
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
    const branch = createRepoBranch('feature/a', { worktree: { path: worktreePath } })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
      currentBranchName: 'feature/a',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/a': [workspacePaneStaticTabEntry('status')],
      },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.repoRuntimeId)
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, worktreePath)
    const statusEntry = {
      repoId: REPO_ID,
      route: {
        kind: 'branch' as const,
        branchName: 'feature/a',
        workspacePaneTab: 'status' as const,
        terminalWorktreeKey,
        terminalSessionId: null,
      },
    }
    const terminalEntry = {
      repoId: REPO_ID,
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
      workspacePaneTabsTestBridge.addRuntimeTab({
        repoRoot: base.repoRoot,
        repoRuntimeId: base.repoRuntimeId!,
        branchName: base.branch,
        worktreePath: base.worktreePath,
        terminalSessionId,
      })
      terminalCreated = true
      for (const listener of terminalListeners) listener()
      useReposStore.getState().setSelectedTerminal(terminalWorktreeKey, terminalSessionId)
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
      workspacePaneRoute: RepoBranchWorkspacePaneRoute | null,
      nextReadContext: TerminalSessionReadContextValue = readContext,
    ) => (
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={testNavigation}>
          <TerminalSessionContext value={commandContext}>
            <TerminalSessionReadContext value={nextReadContext}>
              <RepoWorkspace
                repoId={REPO_ID}
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
      expect(useReposStore.getState().navigationHistoryByRepo[REPO_ID]?.current).toEqual(statusEntry)
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
      expect(useReposStore.getState().navigationHistoryByRepo[REPO_ID]?.backStack).toEqual([statusEntry])
      expect(useReposStore.getState().navigationHistoryByRepo[REPO_ID]?.current).toEqual(terminalEntry)
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
      branches: [createRepoBranch(branchName, { worktree: { path: worktreePath } })],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        [branchName]: [
          workspacePaneStaticTabEntry('status'),
          workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
        ],
      },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.repoRuntimeId)
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, worktreePath)
    const readContext = terminalReadContextWithSession(terminalWorktreeKey, 'term-111111111111111111111')
    const route = routeNavigation()
    const expectedCurrentEntry = {
      repoId: REPO_ID,
      route: {
        kind: 'branch' as const,
        branchName,
        workspacePaneTab: null,
        terminalWorktreeKey,
        terminalSessionId: null,
      },
    }
    vi.mocked(route.openRepoBranch).mockImplementation(() => {
      expect(useReposStore.getState().navigationHistoryByRepo[REPO_ID]?.current).toEqual(expectedCurrentEntry)
      return true
    })

    const { container } = render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigationWithStore(route)}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={readContext}>
              <RepoWorkspace
                repoId={REPO_ID}
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
      expect(useReposStore.getState().navigationHistoryByRepo[REPO_ID]).toEqual({
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
      branches: [createRepoBranch(branchName, { worktree: { path: worktreePath } })],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        [branchName]: [
          workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
          workspacePaneRuntimeTabEntry('terminal', 'term-222222222222222222222'),
        ],
      },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.repoRuntimeId)
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, worktreePath)
    useReposStore.getState().setSelectedTerminal(terminalWorktreeKey, 'term-111111111111111111111')
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
              <RepoWorkspace
                repoId={REPO_ID}
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
      expect(useReposStore.getState().selectedTerminalSessionIdByTerminalWorktree[terminalWorktreeKey]).toBe(
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
      branches: [createRepoBranch(branchName, { worktree: { path: worktreePath } })],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        [branchName]: [
          workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
          workspacePaneRuntimeTabEntry('terminal', 'term-222222222222222222222'),
        ],
      },
    })
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, worktreePath)
    useReposStore.getState().setSelectedTerminal(terminalWorktreeKey, 'term-222222222222222222222')
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
              <RepoWorkspace
                repoId={REPO_ID}
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
    expect(useReposStore.getState().navigationHistoryByRepo[REPO_ID]).toBeUndefined()
    expect(useReposStore.getState().selectedTerminalSessionIdByTerminalWorktree[terminalWorktreeKey]).toBe(
      'term-222222222222222222222',
    )
  })

  test('preserves existing app history when canonicalizing a stale terminal route from another page', async () => {
    const worktreePath = '/tmp/repo-workspace-container-repo-a'
    const branchName = 'feature/a'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(branchName, { worktree: { path: worktreePath } })],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        [branchName]: [
          workspacePaneStaticTabEntry('status'),
          workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
        ],
      },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.repoRuntimeId)
    useReposStore.getState().recordWorkspaceNavigation({ repoId: REPO_ID, route: { kind: 'dashboard' } })
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, worktreePath)
    const route = routeNavigation()

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigationWithStore(route)}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext
              value={terminalReadContextWithSession(terminalWorktreeKey, 'term-111111111111111111111')}
            >
              <RepoWorkspace
                repoId={REPO_ID}
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
      expect(useReposStore.getState().navigationHistoryByRepo[REPO_ID]).toEqual({
        current: {
          repoId: REPO_ID,
          route: {
            kind: 'branch',
            branchName,
            workspacePaneTab: null,
            terminalWorktreeKey,
            terminalSessionId: null,
          },
        },
        backStack: [{ repoId: REPO_ID, route: { kind: 'dashboard' } }],
        forwardStack: [],
      })
    })
  })

  test('does not replace a missing terminal route while terminal projection is pending', async () => {
    const worktreePath = '/tmp/repo-workspace-container-repo-a'
    const branchName = 'feature/a'
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(branchName, { worktree: { path: worktreePath } })],
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
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, worktreePath)
    useReposStore.getState().setSelectedTerminal(terminalWorktreeKey, 'term-222222222222222222222')
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
              <RepoWorkspace
                repoId={REPO_ID}
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
    expect(useReposStore.getState().navigationHistoryByRepo[REPO_ID]).toBeUndefined()
    expect(useReposStore.getState().selectedTerminalSessionIdByTerminalWorktree[terminalWorktreeKey]).toBe(
      'term-222222222222222222222',
    )
  })

  test('does not reconcile a stale terminal route while terminal creation is pending', async () => {
    const worktreePath = '/tmp/repo-workspace-container-repo-a'
    const branchName = 'feature/a'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(branchName, { worktree: { path: worktreePath } })],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        [branchName]: [
          workspacePaneStaticTabEntry('status'),
          workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
        ],
      },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.repoRuntimeId)
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, worktreePath)
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
              <RepoWorkspace
                repoId={REPO_ID}
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
    expect(useReposStore.getState().navigationHistoryByRepo[REPO_ID]).toBeUndefined()
  })

  test('syncs a routed static tab after the branch projection appears', async () => {
    const branchName = 'feature/cold-route'

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigationWithStore()}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <RepoWorkspace
                repoId={REPO_ID}
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
        branches: [createRepoBranch(branchName)],
        currentBranchName: branchName,
        preferredWorkspacePaneTab: 'status',
        workspacePaneTabsByBranch: {
          [branchName]: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
        },
      })
    })

    await waitFor(() => {
      const repo = useReposStore.getState().repos[REPO_ID]
      expect(
        repo &&
          preferredWorkspacePaneTabForTarget(repo.ui, {
            repoRoot: REPO_ID,
            branchName,
            worktreePath: null,
          }),
      ).toBe('history')
    })
  })

  test('syncs a routed bare branch as an empty workspace pane preference', async () => {
    const branchName = 'feature/empty-route'
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(branchName)],
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
              <RepoWorkspace
                repoId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRouteContext={{ kind: 'routed', route: null }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      const repo = useReposStore.getState().repos[REPO_ID]
      expect(
        repo &&
          preferredWorkspacePaneTabForTarget(repo.ui, {
            repoRoot: REPO_ID,
            branchName,
            worktreePath: null,
          }),
      ).toBeNull()
    })
  })

  test('uses the persisted workspace pane tab when the pane has no active route context', () => {
    const branchName = 'feature/inactive-route'
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(branchName, { worktree: { path: '/tmp/repo-workspace-inactive-worktree' } })],
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
              <RepoWorkspace
                repoId={REPO_ID}
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
      branches: [createRepoBranch(branchName, { worktree: { path: worktreePath } })],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        [branchName]: [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('files')],
      },
    })
    expect(
      recordWorkspacePaneTabOpener(
        REPO_ID,
        repo.repoRuntimeId,
        branchName,
        'workspace-pane:files',
        'workspace-pane:status',
      ),
    ).toBe('recorded')

    function RoutedWorkspaceHarness() {
      const [route, setRoute] = useState<RepoBranchWorkspacePaneRoute | null>({ kind: 'static', tab: 'status' })
      const navigationWithRoute = useMemo<PrimaryWindowNavigationActions>(() => {
        const showRepoBranchEmptyWorkspacePane: PrimaryWindowNavigationActions['showRepoBranchEmptyWorkspacePane'] = (
          repoId,
          nextBranch,
        ) => {
          useReposStore.getState().setWorkspacePaneTab(repoId, nextBranch, null)
          setRoute(null)
          return true
        }
        const showRepoBranchWorkspacePaneTab: PrimaryWindowNavigationActions['showRepoBranchWorkspacePaneTab'] = (
          repoId,
          nextBranch,
          tab,
        ) => {
          useReposStore.getState().setWorkspacePaneTab(repoId, nextBranch, tab)
          setRoute({ kind: 'static', tab })
          return true
        }
        seedInitialObservedWorkspacePaneRouteForTest()
        const routedNavigation: PrimaryWindowNavigationActions = {
          ...navigation,
          showRepoBranchEmptyWorkspacePane,
          showRepoBranchWorkspacePaneTab,
          showRepoBranchTerminalSession: () => false,
          commitRepoBranchWorkspacePaneRoute: () => false,
        }
        routedNavigation.commitRepoBranchWorkspacePaneRoute = observedWorkspacePaneRouteCommitForTest(
          routedNavigation,
          { observeAcceptedRoute: () => {} },
        )
        return routedNavigation
      }, [])
      const routeLabel = route?.kind === 'static' ? route.tab : route?.kind === 'terminal' ? 'terminal' : 'empty'
      return (
        <PrimaryWindowNavigationProvider value={navigationWithRoute}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <div data-testid="workspace-route">{routeLabel}</div>
              <RepoWorkspace
                repoId={REPO_ID}
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
    expect(workspacePaneTabOpener(REPO_ID, repo.repoRuntimeId, branchName, 'workspace-pane:files')).toBe(
      'workspace-pane:status',
    )
    const closeTarget = workspacePaneTabTargetForBranch(REPO_ID, branchName, {
      workspacePaneRoute: { kind: 'static', tab: 'files' },
    })
    expect(closeTarget?.tabs.map((tab) => tab.identity)).toEqual(['workspace-pane:status', 'workspace-pane:files'])
    expect(
      closeTarget
        ? nextRepoWorkspaceTabAfterClose(
            closeTarget.tabs,
            'workspace-pane:files',
            workspacePaneTabOpener(REPO_ID, repo.repoRuntimeId, branchName, 'workspace-pane:files'),
          )?.identity
        : null,
    ).toBe('workspace-pane:status')

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
      branches: [createRepoBranch(branchName, { worktree: { path: worktreePath } })],
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
              <RepoWorkspace
                repoId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRouteContext={{ kind: 'routed', route: { kind: 'static', tab: 'files' } }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )
    const filesHistoryEntry = {
      repoId: REPO_ID,
      route: {
        kind: 'branch' as const,
        branchName,
        workspacePaneTab: 'files' as const,
        terminalWorktreeKey: formatTerminalWorktreeKey(REPO_ID, worktreePath),
        terminalSessionId: null,
      },
    }
    await waitFor(() => {
      expect(useReposStore.getState().navigationHistoryByRepo[REPO_ID]?.current).toEqual(filesHistoryEntry)
    })
    vi.mocked(route.openRepoBranch).mockClear()
    vi.mocked(route.openRepoBranchTab).mockClear()

    const closePromise = runCloseWorkspacePaneTabCommand({
      repoId: REPO_ID,
      branchName,
      workspacePaneRoute: { kind: 'static', tab: 'files' },
      navigation: actions,
    })
    await commitStarted

    act(() => {
      setWorkspacePaneTabsForTargetQueryData({
        repoRoot: REPO_ID,
        repoRuntimeId: repo.repoRuntimeId,
        branchName,
        worktreePath,
        tabs: [workspacePaneStaticTabEntry('status')],
      })
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(route.openRepoBranch).not.toHaveBeenCalled()
    expect(route.openRepoBranchTab).not.toHaveBeenCalled()
    expect(useReposStore.getState().navigationHistoryByRepo[REPO_ID]?.current).toEqual(filesHistoryEntry)

    resolveCommit([workspacePaneStaticTabEntry('status')])

    await expect(closePromise).resolves.toBe(true)
    expect(route.openRepoBranchTab).toHaveBeenCalledWith(REPO_ID, branchName, 'status', presentationOptions())
  })

  test('reconciles a closed active tab after close-back navigation rejects', async () => {
    const branchName = 'feature/close-route-rejected'
    const worktreePath = '/tmp/close-route-rejected-worktree'
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(branchName, { worktree: { path: worktreePath } })],
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
              <RepoWorkspace
                repoId={REPO_ID}
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
        repoId: REPO_ID,
        branchName,
        workspacePaneRoute: { kind: 'static', tab: 'files' },
        navigation: actions,
      }),
    ).resolves.toBe(false)

    await waitFor(() => {
      expect(route.openRepoBranch).toHaveBeenCalledWith(REPO_ID, branchName, presentationOptions({ replace: true }))
    })
  })

  test('replaces an unrenderable static route with the bare branch route', async () => {
    const branchName = 'feature/no-worktree'
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(branchName)],
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
              <RepoWorkspace
                repoId={REPO_ID}
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
      expect(useReposStore.getState().navigationHistoryByRepo[REPO_ID]).toEqual({
        current: {
          repoId: REPO_ID,
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
      branches: [createRepoBranch(branchName)],
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
              <RepoWorkspace
                repoId={REPO_ID}
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
      expect(useReposStore.getState().navigationHistoryByRepo[REPO_ID]).toEqual({
        current: {
          repoId: REPO_ID,
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
      const repo = useReposStore.getState().repos[REPO_ID]
      expect(
        repo &&
          preferredWorkspacePaneTabForTarget(repo.ui, {
            repoRoot: REPO_ID,
            branchName,
            worktreePath: null,
          }),
      ).toBe('status')
    })
  })

  test('uses the React Query projection read model for workspace branch presentation when available', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [],
      currentBranchName: 'feature/query',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/query': [workspacePaneStaticTabEntry('status')],
      },
    })
    seedRepoReadModelQueryData(repo, {
      branches: [createRepoBranch('feature/query')],
      currentBranch: 'feature/query',
    })

    const { container } = render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <RepoWorkspace
                repoId={REPO_ID}
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
    const branch = createRepoBranch('feature/pr')
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
      currentBranchName: 'feature/pr',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/pr': [workspacePaneStaticTabEntry('status')],
      },
    })
    const pullRequest = createPullRequest(42, { headRefName: 'feature/pr' })
    setRepoProjectionQueryData(REPO_ID, repo.repoRuntimeId, 'feature/pr', 'full', {
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
              <RepoWorkspace
                repoId={REPO_ID}
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
  const store = useReposStore.getState()
  const navigation = createPrimaryWindowNavigationActions({
    currentRepoId: REPO_ID,
    order: [REPO_ID],
    closeRepo: store.closeRepo,
    peekWorkspaceNavigation: store.peekWorkspaceNavigation,
    commitWorkspaceNavigation: store.commitWorkspaceNavigation,
    routeNavigation: routeNavigationOverrides,
  })
  const commitRoute = navigation.commitRepoBranchWorkspacePaneRoute
  navigation.commitRepoBranchWorkspacePaneRoute = observedWorkspacePaneRouteCommitForTest(navigation, { commitRoute })
  return navigation
}

function routeNavigation(): PrimaryWindowRouteNavigation {
  return {
    repoSlugForId: vi.fn(() => 'repo-workspace-container-repo'),
    currentRepoBranchWorkspacePaneRoute: () => undefined,
    openHome: vi.fn(),
    openSettings: vi.fn(),
    closeSettings: vi.fn(),
    openRepoRoot: vi.fn(),
    openRepoDashboard: vi.fn(),
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
    openRepoNewWorktree: vi.fn(),
    cancelRepoNewWorktree: vi.fn(),
  }
}
