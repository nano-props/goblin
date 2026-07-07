// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
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
  resetReposStore,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  setRepoPullRequestsQueryData,
  setRepoSnapshotQueryData,
  setRepoStatusQueryData,
} from '#/web/repo-data-query.ts'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'

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

const terminalReadContext: TerminalSessionReadContextValue = {
  terminalWorktreeSnapshot: () => emptyWorktreeSnapshot,
  subscribeTerminalWorktree: () => () => {},
  repoBellCount: () => 0,
  subscribeRepoBellCount: () => () => {},
  snapshot: () => ({ phase: 'opening', message: null, processName: 'terminal' }),
  subscribeSnapshot: () => () => {},
}

const terminalCommandContext: TerminalSessionContextValue = {
  createTerminal: vi.fn(async () => 'session-1'),
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
  showRepoBranchWorkspacePaneTab: vi.fn(),
  showRepoBranchTerminalSession: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
  openSettings: vi.fn(),
  openCreateWorktree: vi.fn(),
}

beforeEach(() => {
  resetReposStore()
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
              <RepoWorkspace repoId={REPO_ID} />
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
              <RepoWorkspace repoId={REPO_ID} currentBranchName="feature/a" />
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
                <RepoWorkspace repoId={REPO_ID} currentBranchName="feature/b" />
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
                <RepoWorkspace repoId={REPO_ID} currentBranchName="feature/a" />
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
    setRepoStatusQueryData(REPO_ID, repo.instanceId, [
      { path: worktreePath, branch: 'feature/a', isMain: false, entries: [{ x: 'M', y: ' ', path: 'changed.ts' }] },
    ])

    const { container } = render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <RepoWorkspace repoId={REPO_ID} currentBranchName="feature/a" />
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
        terminalSessionId: 'session-1',
      },
    }
    const createTerminal = vi.fn(async (base: TerminalSessionBase) => {
      const terminalSessionId = 'session-1'
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
      workspacePaneRoute: Parameters<typeof RepoWorkspace>[0]['workspacePaneRoute'],
      readContext: TerminalSessionReadContextValue = terminalReadContext,
    ) => (
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={testNavigation}>
          <TerminalSessionContext value={{ ...terminalCommandContext, createTerminal }}>
            <TerminalSessionReadContext value={readContext}>
              <RepoWorkspace repoId={REPO_ID} currentBranchName="feature/a" workspacePaneRoute={workspacePaneRoute} />
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
    expect(route.openRepoBranchTerminal).toHaveBeenCalledWith(REPO_ID, 'feature/a', 'session-1')

    rerender(
      workspace(
        { kind: 'terminal', terminalSessionId: 'session-1' },
        terminalReadContextWithSession(terminalWorktreeKey, 'session-1'),
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

  test('replaces a stale terminal route with the resolved live terminal route', async () => {
    const worktreePath = '/tmp/repo-workspace-container-repo-a'
    const branchName = 'feature/a'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(branchName, { worktree: { path: worktreePath } })],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        [branchName]: [workspacePaneStaticTabEntry('status'), workspacePaneRuntimeTabEntry('terminal', 'session-1')],
      },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.instanceId)
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, worktreePath)
    const readContext = terminalReadContextWithSession(terminalWorktreeKey, 'session-1')
    const route = routeNavigation()

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigationWithStore(route)}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={readContext}>
              <RepoWorkspace
                repoId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRoute={{ kind: 'terminal', terminalSessionId: 'missing-session' }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(route.openRepoBranchTerminal).toHaveBeenCalledWith(REPO_ID, branchName, 'session-1', {
        replace: true,
      })
      expect(useReposStore.getState().navigationHistoryByRepo[REPO_ID]).toEqual({
        current: {
          repoId: REPO_ID,
          route: {
            kind: 'branch',
            branchName,
            workspacePaneTab: 'terminal',
            terminalWorktreeKey,
            terminalSessionId: 'session-1',
          },
        },
        backStack: [],
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
        [branchName]: [workspacePaneStaticTabEntry('status'), workspacePaneRuntimeTabEntry('terminal', 'session-1')],
      },
    })
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, worktreePath)
    const readContext = terminalReadContextWithSession(terminalWorktreeKey, 'session-1')
    const route = routeNavigation()

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigationWithStore(route)}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={readContext}>
              <RepoWorkspace
                repoId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRoute={{ kind: 'terminal', terminalSessionId: 'missing-session' }}
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
  })

  test('replaces an unrenderable static route with the resolved static route', async () => {
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

    render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigationWithStore(route)}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <RepoWorkspace
                repoId={REPO_ID}
                currentBranchName={branchName}
                workspacePaneRoute={{ kind: 'static', tab: 'changes' }}
              />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(route.openRepoBranchTab).toHaveBeenCalledWith(REPO_ID, branchName, 'status', { replace: true })
      expect(useReposStore.getState().navigationHistoryByRepo[REPO_ID]).toEqual({
        current: {
          repoId: REPO_ID,
          route: {
            kind: 'branch',
            branchName,
            workspacePaneTab: 'status',
            terminalWorktreeKey: null,
            terminalSessionId: null,
          },
        },
        backStack: [],
        forwardStack: [],
      })
    })
  })

  test('uses the React Query snapshot read model for workspace branch presentation when available', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [],
      currentBranchName: 'feature/query',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/query': [workspacePaneStaticTabEntry('status')],
      },
    })
    setRepoSnapshotQueryData(REPO_ID, repo.instanceId, {
      current: 'feature/query',
      branches: [createRepoBranch('feature/query')],
    })

    const { container } = render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <RepoWorkspace repoId={REPO_ID} currentBranchName="feature/query" />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    expect(container.textContent).toContain('feature/query')
    expect(container.textContent).not.toContain('branches.empty')
  })

  test('uses the React Query pull request read model for the current branch when available', () => {
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
    setRepoPullRequestsQueryData(REPO_ID, repo.instanceId, ['feature/pr'], 'full', [
      { branch: 'feature/pr', pullRequest },
    ])

    const { container } = render(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContext}>
            <TerminalSessionReadContext value={terminalReadContext}>
              <RepoWorkspace repoId={REPO_ID} currentBranchName="feature/pr" />
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
  const snapshot: TerminalWorktreeSnapshot = {
    terminalWorktreeKey,
    selectedDescriptor: null,
    sessions: [
      {
        type: 'terminal',
        terminalSessionId,
        terminalWorktreeKey,
        index: 1,
        title: terminalSessionId,
        phase: 'open',
        selected: true,
        hasBell: false,
        hasRecentOutput: false,
      },
    ],
    count: 1,
    bellCount: 0,
    outputActiveCount: 0,
    createPending: false,
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
