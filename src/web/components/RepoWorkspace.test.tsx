// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoWorkspace } from '#/web/components/RepoWorkspace.tsx'
import {
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
import { setRepoProjectionQueryData } from '#/web/repo-data-query.ts'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/repos/workspace-pane-preferences.ts'
import type { RepoBranchWorkspacePaneRoute } from '#/web/App.tsx'

const REPO_ID = '/tmp/repo-workspace-container-repo'

const emptyWorktreeSnapshot: TerminalWorktreeSnapshot = {
  terminalWorktreeKey: '',
  selectedDescriptor: null,
  sessions: [],
  count: 0,
  bellCount: 0,
  outputActiveCount: 0,
  createPending: false,
}

const emptyTerminalSnapshot = { phase: 'opening' as const, message: null, processName: 'terminal' }

const terminalReadContext: TerminalSessionReadContextValue = {
  terminalWorktreeSnapshot: () => emptyWorktreeSnapshot,
  subscribeTerminalWorktree: () => () => {},
  repoBellCount: () => 0,
  subscribeRepoBellCount: () => () => {},
  snapshot: () => emptyTerminalSnapshot,
  subscribeSnapshot: () => () => {},
}

const terminalCommandContext: TerminalSessionContextValue = {
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
}

const navigation: PrimaryWindowNavigationActions = {
  activateRepo: vi.fn(),
  closeRepo: vi.fn(),
  cycleRepo: vi.fn(),
  selectRepoBranch: vi.fn(),
  showRepoBranchEmptyWorkspacePane: () => true,
  showRepoBranchWorkspacePaneTab: vi.fn(),
  showRepoBranchTerminalSession: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
  openSettings: vi.fn(),
  openCreateWorktree: vi.fn(),
}

beforeEach(() => {
  primaryWindowQueryClient.clear()
  resetReposStore()
  installWorkspacePaneTabsTestBridge()
  useTerminalProjectionHydrationStore.setState({ hydrationByRepo: new Map(), refreshedAtByRepo: new Map() })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RepoWorkspace', () => {
  test('can render after the repo appears without changing hook order', () => {
    render(
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
    seedRepoWithReadModelForTest({
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
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.instanceId)
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
    const createTerminal = vi.fn(async (base: TerminalSessionBase) => {
      const terminalSessionId = 'term-111111111111111111111'
      setWorkspacePaneTabsForTargetQueryData({
        repoRoot: base.repoRoot,
        repoInstanceId: base.repoInstanceId!,
        branchName: base.branch,
        worktreePath: base.worktreePath,
        tabs: [workspacePaneStaticTabEntry('status'), workspacePaneRuntimeTabEntry('terminal', terminalSessionId)],
      })
      useReposStore.getState().setSelectedTerminal(terminalWorktreeKey, terminalSessionId)
      return terminalSessionId
    })
    const route = routeNavigation()
    const testNavigation = navigationWithStore(route)

    const workspace = (
      workspacePaneRoute: RepoBranchWorkspacePaneRoute | null,
      readContext: TerminalSessionReadContextValue = terminalReadContext,
    ) => (
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={testNavigation}>
          <TerminalSessionContext value={{ ...terminalCommandContext, createTerminal }}>
            <TerminalSessionReadContext value={readContext}>
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
    expect(route.openRepoBranchTerminal).toHaveBeenCalledWith(REPO_ID, 'feature/a', 'term-111111111111111111111')

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

    expect(route.openRepoBranchTab).toHaveBeenCalledWith(REPO_ID, 'feature/a', 'status')
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
        [branchName]: [workspacePaneStaticTabEntry('status'), workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111')],
      },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.instanceId)
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
      expect(route.openRepoBranch).toHaveBeenCalledWith(REPO_ID, branchName, { replace: true })
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
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.instanceId)
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, worktreePath)
    useReposStore.getState().setSelectedTerminal(terminalWorktreeKey, 'term-111111111111111111111')
    const route = routeNavigation()

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigationWithStore(route)}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext
              value={terminalReadContextWithSessions(terminalWorktreeKey, ['term-111111111111111111111', 'term-222222222222222222222'])}
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
              value={terminalReadContextWithSessions(terminalWorktreeKey, ['term-111111111111111111111', 'term-222222222222222222222'])}
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
    expect(useReposStore.getState().selectedTerminalSessionIdByTerminalWorktree[terminalWorktreeKey]).toBe('term-222222222222222222222')
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
        [branchName]: [workspacePaneStaticTabEntry('status'), workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111')],
      },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.instanceId)
    useReposStore.getState().recordWorkspaceNavigation({ repoId: REPO_ID, route: { kind: 'dashboard' } })
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, worktreePath)
    const route = routeNavigation()

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigationWithStore(route)}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContextWithSession(terminalWorktreeKey, 'term-111111111111111111111')}>
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
      expect(route.openRepoBranch).toHaveBeenCalledWith(REPO_ID, branchName, { replace: true })
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
    const readContext = terminalReadContextWithSessions(terminalWorktreeKey, ['term-111111111111111111111', 'term-222222222222222222222'], 'term-222222222222222222222')
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
    expect(useReposStore.getState().selectedTerminalSessionIdByTerminalWorktree[terminalWorktreeKey]).toBe('term-222222222222222222222')
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
        [branchName]: [workspacePaneStaticTabEntry('status'), workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111')],
      },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.instanceId)
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, worktreePath)
    const route = routeNavigation()

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigationWithStore(route)}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext
              value={terminalReadContextWithSessions(terminalWorktreeKey, ['term-111111111111111111111'], 'term-111111111111111111111', {
                createPending: true,
              })}
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
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(branchName, { worktree: { path: worktreePath } })],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        [branchName]: [workspacePaneStaticTabEntry('status')],
      },
    })

    function RoutedWorkspaceHarness() {
      const [route, setRoute] = useState<RepoBranchWorkspacePaneRoute | null>({ kind: 'static', tab: 'status' })
      const navigationWithRoute = useMemo<PrimaryWindowNavigationActions>(
        () => ({
          ...navigation,
          showRepoBranchEmptyWorkspacePane: (repoId, nextBranch) => {
            useReposStore.getState().setWorkspacePaneTab(repoId, nextBranch, null)
            setRoute(null)
            return true
          },
          showRepoBranchWorkspacePaneTab: (repoId, nextBranch, tab) => {
            useReposStore.getState().setWorkspacePaneTab(repoId, nextBranch, tab)
            setRoute({ kind: 'static', tab })
            return true
          },
          showRepoBranchTerminalSession: () => false,
        }),
        [],
      )
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
      expect(route.openRepoBranch).toHaveBeenCalledWith(REPO_ID, branchName, { replace: true })
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
      expect(route.openRepoBranch).toHaveBeenCalledWith(REPO_ID, branchName, { replace: true })
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
    setRepoProjectionQueryData(REPO_ID, repo.instanceId, 'feature/pr', 'full', {
      snapshot: { current: 'feature/pr', branches: [branch] },
      status: [],
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
    terminalWorktreeSnapshot: (key) => (key === terminalWorktreeKey ? snapshot : emptyWorktreeSnapshot),
  }
}

function navigationWithStore(
  routeNavigationOverrides: PrimaryWindowRouteNavigation = routeNavigation(),
): PrimaryWindowNavigationActions {
  const store = useReposStore.getState()
  return createPrimaryWindowNavigationActions({
    currentRepoId: REPO_ID,
    order: [REPO_ID],
    closeRepo: store.closeRepo,
    goBackInWorkspaceNavigation: store.goBackInWorkspaceNavigation,
    goForwardInWorkspaceNavigation: store.goForwardInWorkspaceNavigation,
    routeNavigation: routeNavigationOverrides,
  })
}

function routeNavigation(): PrimaryWindowRouteNavigation {
  return {
    repoSlugForId: vi.fn(() => 'repo-workspace-container-repo'),
    openHome: vi.fn(),
    openSettings: vi.fn(),
    closeSettings: vi.fn(),
    openRepoRoot: vi.fn(),
    openRepoDashboard: vi.fn(),
    openRepoBranch: vi.fn(),
    openRepoBranchTab: vi.fn(),
    openRepoBranchTerminal: vi.fn(),
    openRepoNewWorktree: vi.fn(),
    cancelRepoNewWorktree: vi.fn(),
  }
}
