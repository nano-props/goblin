// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react'
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
import {
  PrimaryWindowNavigationProvider,
  type PrimaryWindowNavigationActions,
} from '#/web/primary-window-navigation.tsx'
import { useRepoSyncStore } from '#/web/stores/repo-sync.ts'
import { createPullRequest, createRepoBranch, resetReposStore, seedRepoState } from '#/web/test-utils/bridge.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { setRepoPullRequestsQueryData, setRepoSnapshotQueryData, setRepoStatusQueryData } from '#/web/repo-data-query.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'

const REPO_ID = '/tmp/repo-workspace-container-repo'

const emptyWorktreeSnapshot: TerminalWorktreeSnapshot = {
  terminalWorktreeKey: '',
  selectedDescriptor: null,
  sessions: [],
  count: 0,
  bellCount: 0,
  outputActiveCount: 0,
  pendingCreate: false,
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
  showRepoWorkspacePaneTab: vi.fn(),
  showRepoBranchWorkspacePaneTab: vi.fn(),
  openSettings: vi.fn(),
}

beforeEach(() => {
  resetReposStore()
  useRepoSyncStore.setState({ ready: new Map(), timestamps: new Map() })
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
        seedRepoState({ id: REPO_ID, branches: [], statusLoaded: true })
      })
    }).not.toThrow()
    expect(screen.getByText('branches.empty')).toBeTruthy()
  })

  test('keeps the workspace tab strip mounted and restores scroll position by branch', () => {
    const branchA = createRepoBranch('feature/a', { worktree: { path: '/tmp/repo-workspace-container-repo-a' } })
    const branchB = createRepoBranch('feature/b', { worktree: { path: '/tmp/repo-workspace-container-repo-b' } })
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [branchA, branchB],
      selectedBranch: 'feature/a',
      preferredWorkspacePaneTab: 'status',
      statusLoaded: true,
      workspacePaneTabsByBranch: {
        'feature/a': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
        'feature/b': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
      },
    })
    const { container } = render(
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
    const viewport = scrollViewport(container)
    act(() => {
      viewport.scrollLeft = 120
      viewport.dispatchEvent(new Event('scroll', { bubbles: true }))
    })

    act(() => {
      seedRepoState({
        id: REPO_ID,
        instanceId: repo.instanceId,
        branches: [branchA, branchB],
        selectedBranch: 'feature/b',
        preferredWorkspacePaneTab: 'status',
        statusLoaded: true,
        workspacePaneTabsByBranch: {
          'feature/a': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
          'feature/b': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
        },
      })
    })

    expect(scrollViewport(container)).toBe(viewport)
    expect(viewport.scrollLeft).toBe(0)

    act(() => {
      viewport.scrollLeft = 40
      viewport.dispatchEvent(new Event('scroll', { bubbles: true }))
    })

    act(() => {
      seedRepoState({
        id: REPO_ID,
        instanceId: repo.instanceId,
        branches: [branchA, branchB],
        selectedBranch: 'feature/a',
        preferredWorkspacePaneTab: 'status',
        statusLoaded: true,
        workspacePaneTabsByBranch: {
          'feature/a': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
          'feature/b': [workspacePaneStaticTabEntry('status'), workspacePaneStaticTabEntry('history')],
        },
      })
    })

    expect(scrollViewport(container)).toBe(viewport)
    expect(viewport.scrollLeft).toBe(120)
  })

  test('uses the React Query status read model for workspace presentation when available', () => {
    const worktreePath = '/tmp/repo-workspace-container-repo-a'
    const branch = createRepoBranch('feature/a', { worktree: { path: worktreePath } })
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [branch],
      selectedBranch: 'feature/a',
      preferredWorkspacePaneTab: 'status',
      statusLoaded: true,
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
              <RepoWorkspace repoId={REPO_ID} />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    expect(container.querySelector('button[aria-label="status.copy-patch-title"]')).not.toBeNull()
  })

  test('uses the React Query snapshot read model for workspace branch presentation when available', () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [],
      selectedBranch: 'feature/query',
      preferredWorkspacePaneTab: 'status',
      statusLoaded: true,
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
              <RepoWorkspace repoId={REPO_ID} />
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    expect(container.textContent).toContain('feature/query')
    expect(container.textContent).not.toContain('branches.empty')
  })

  test('uses the React Query pull request read model for the selected branch when available', () => {
    const branch = createRepoBranch('feature/pr')
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [branch],
      selectedBranch: 'feature/pr',
      preferredWorkspacePaneTab: 'status',
      statusLoaded: true,
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
              <RepoWorkspace repoId={REPO_ID} />
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
