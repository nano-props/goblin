// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BranchWorkspaceContent } from '#/web/components/branch-workspace/BranchWorkspaceContent.tsx'
import { getSelectedBranchWorkspacePresentation } from '#/web/components/branch-workspace/model.ts'
import { TerminalSessionReadContext } from '#/web/components/terminal/terminal-session-context.ts'
import type { TerminalSessionReadContextValue, WorktreeTerminalSnapshot } from '#/web/components/terminal/types.ts'
import {
  createBranchSnapshot,
  createRepoBranch,
  resetReposStore,
  seedRepoState,
} from '#/web/stores/repos/test-utils.ts'

const repoClientMocks = vi.hoisted(() => ({
  getRepositoryLog: vi.fn(),
}))

vi.mock('#/web/repo-client.ts', () => ({
  getRepositoryLog: repoClientMocks.getRepositoryLog,
}))

const REPO_ID = '/tmp/gbl-branch-workspace-content-repo'

let container: HTMLDivElement | null = null
let root: Root | null = null
const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeEach(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  resetReposStore()
  repoClientMocks.getRepositoryLog.mockResolvedValue([])
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
  repoClientMocks.getRepositoryLog.mockReset()
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false
})

describe('BranchWorkspaceContent', () => {
  test('renders copy patch as a changes-tab toolbar action', () => {
    const onCopyPatch = vi.fn()
    const worktreePath = '/tmp/changes-worktree'
    const repo = seedRepoState({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/changes', {
          worktree: { path: worktreePath, summary: { dirty: true, changeCount: 1 } },
        }),
      ],
      selectedBranch: 'feature/changes',
      workspacePaneView: 'changes',
      openBranchWorkspacePaneViews: ['status'],
      statusLoaded: true,
      status: [
        {
          path: worktreePath,
          branch: 'feature/changes',
          isMain: false,
          entries: [{ x: 'M', y: ' ', path: 'src/example.ts' }],
        },
      ],
    })
    const detail = getSelectedBranchWorkspacePresentation(repo)
    const changesWorkspaceView = {
      type: 'changes' as const,
      id: 'changes' as const,
      key: 'changes' as const,
      worktreeTerminalKey: `${REPO_ID}\0${worktreePath}`,
      worktreePath,
      displayOrder: 0,
    }
    const changesWorktreeSnapshot: WorktreeTerminalSnapshot = {
      ...emptyWorktreeSnapshot,
      worktreeTerminalKey: `${REPO_ID}\0${worktreePath}`,
      staticWorkspacePaneViews: [changesWorkspaceView],
      workspacePaneViews: [changesWorkspaceView],
    }
    const readContext: TerminalSessionReadContextValue = {
      ...emptyTerminalReadContext,
      worktreeSnapshot: () => changesWorktreeSnapshot,
    }

    act(() => {
      root!.render(
        <TerminalSessionReadContext.Provider value={readContext}>
          <BranchWorkspaceContent
            repo={repo}
            detail={detail}
            workspacePaneId="workspace"
            copyPatchAction={{
              label: 'status.copy-patch',
              title: 'status.copy-patch-title',
              ariaLabel: 'status.copy-patch-title',
              disabled: false,
              visible: true,
              onSelect: onCopyPatch,
            }}
          />
        </TerminalSessionReadContext.Provider>,
      )
    })

    expect(container?.querySelector('#workspace-changes-panel')).not.toBeNull()
    expect(container?.textContent).toContain('tab.changes-with-count')
    expect(container?.textContent).toContain('status.copy-patch')

    const copyButton = container?.querySelector<HTMLButtonElement>('button[aria-label="status.copy-patch-title"]')
    expect(copyButton).not.toBeNull()
    act(() => {
      copyButton!.click()
    })
    expect(onCopyPatch).toHaveBeenCalledTimes(1)
  })

  test('renders branch status for a selected branch without a worktree', () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [
        createRepoBranch('feature/no-worktree', {
          tracking: 'origin/feature/no-worktree',
          lastCommitHash: 'abc1234',
          lastCommitMessage: 'Update placeholder branch',
          lastCommitAuthor: 'Example Author',
          lastCommitDate: '2026-01-01T00:00:00.000Z',
        }),
      ],
      selectedBranch: 'feature/no-worktree',
      workspacePaneView: 'status',
    })
    const detail = getSelectedBranchWorkspacePresentation(repo)

    act(() => {
      root!.render(
        <TerminalSessionReadContext.Provider value={emptyTerminalReadContext}>
          <BranchWorkspaceContent repo={repo} detail={detail} workspacePaneId="workspace" />
        </TerminalSessionReadContext.Provider>,
      )
    })

    expect(container?.querySelector('#workspace-status-panel')).not.toBeNull()
    expect(container?.textContent).toContain('feature/no-worktree')
    expect(container?.textContent).toContain('branch-status.worktree.none')
    expect(container?.textContent).not.toContain('workspace-pane-views.empty')
  })

  test('shows the workspace empty state when the status tab is closed', () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [
        createRepoBranch('feature/no-worktree', {
          tracking: 'origin/feature/no-worktree',
          lastCommitHash: 'abc1234',
          lastCommitMessage: 'Update placeholder branch',
          lastCommitAuthor: 'Example Author',
          lastCommitDate: '2026-01-01T00:00:00.000Z',
        }),
      ],
      selectedBranch: 'feature/no-worktree',
      workspacePaneView: 'status',
      openBranchWorkspacePaneViews: [],
    })
    const detail = getSelectedBranchWorkspacePresentation(repo)

    act(() => {
      root!.render(
        <TerminalSessionReadContext.Provider value={emptyTerminalReadContext}>
          <BranchWorkspaceContent repo={repo} detail={detail} workspacePaneId="workspace" />
        </TerminalSessionReadContext.Provider>,
      )
    })

    expect(container?.querySelector('#workspace-status-panel')).toBeNull()
    expect(container?.textContent).toContain('workspace-pane-views.empty')
  })

  test('does not render history on a branch that did not open it', async () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/a'), createRepoBranch('feature/b')],
      selectedBranch: 'feature/b',
      workspacePaneView: 'history',
      openBranchWorkspacePaneViewsByBranch: {
        'feature/a': ['status', 'history'],
      },
    })
    const detail = getSelectedBranchWorkspacePresentation(repo)

    act(() => {
      root!.render(
        <TerminalSessionReadContext.Provider value={emptyTerminalReadContext}>
          <BranchWorkspaceContent repo={repo} detail={detail} workspacePaneId="workspace" />
        </TerminalSessionReadContext.Provider>,
      )
    })
    await flushAsyncWork()

    expect(container?.querySelector('#workspace-status-panel')).not.toBeNull()
    expect(container?.querySelector('#workspace-history-panel')).toBeNull()
    expect(repoClientMocks.getRepositoryLog).not.toHaveBeenCalled()
  })

  test('renders branch history as one-line short-hash log entries', async () => {
    repoClientMocks.getRepositoryLog.mockResolvedValue([
      {
        hash: '78c150a000000000000000000000000000000000',
        shortHash: '78c150a',
        refs: 'HEAD -> fix/w-tab, origin/main, origin/fix/w-tab, origin/HEAD, main',
        message: 'Fix branch navigator name truncation',
        author: 'Example Author',
        date: '2026-06-21T00:00:00.000Z',
      },
    ])
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/history')],
      selectedBranch: 'feature/history',
      workspacePaneView: 'history',
      openBranchWorkspacePaneViews: ['status', 'history'],
    })
    const detail = getSelectedBranchWorkspacePresentation(repo)

    act(() => {
      root!.render(
        <TerminalSessionReadContext.Provider value={emptyTerminalReadContext}>
          <BranchWorkspaceContent repo={repo} detail={detail} workspacePaneId="workspace" />
        </TerminalSessionReadContext.Provider>,
      )
    })
    await flushAsyncWork()

    expect(repoClientMocks.getRepositoryLog).toHaveBeenCalledWith(
      REPO_ID,
      'feature/history',
      expect.objectContaining({ count: 50 }),
    )
    const row = container?.querySelector(
      'li[title="78c150a (HEAD -> fix/w-tab, origin/main, origin/fix/w-tab, origin/HEAD, main) Fix branch navigator name truncation"]',
    )
    expect(row).not.toBeNull()
    expect(row?.className).not.toContain('grid')
    expect(row?.className).toContain('font-mono')
    expect(row?.className).toContain('text-sm')
    expect(row?.className).not.toContain('h-7')
    expect(row?.className).toContain('px-1.5')
    expect(row?.textContent).toContain('78c150a')
    expect(row?.textContent).toContain('(HEAD -> fix/w-tab, origin/main, origin/fix/w-tab, origin/HEAD, main)')
    expect(row?.textContent).toContain('Fix branch navigator name truncation')
    expect(row?.querySelector('span.block')?.className).toContain('truncate')
    expect(row?.querySelector('[data-history-log-hash=""]')?.getAttribute('style')).toContain(
      '--color-terminal-ansi-yellow',
    )
    expect(row?.querySelector('[data-history-log-ref-token="HEAD"]')?.getAttribute('style')).toContain(
      '--color-terminal-ansi-blue',
    )
    expect(row?.querySelector('[data-history-log-ref-token="fix/w-tab"]')?.getAttribute('style')).toContain(
      '--color-terminal-ansi-green',
    )
    expect(row?.querySelector('[data-history-log-ref-token="origin/main"]')?.getAttribute('style')).toContain(
      '--color-terminal-ansi-red',
    )
    expect(row?.querySelector('[data-history-log-message=""]')?.textContent).toBe(
      'Fix branch navigator name truncation',
    )
  })

  test('labels worktree history fallback panels with the matching fallback tab id', async () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/history', { worktree: { path: '/tmp/history-worktree' } })],
      selectedBranch: 'feature/history',
      workspacePaneView: 'history',
      openBranchWorkspacePaneViews: ['status', 'history'],
    })
    const detail = getSelectedBranchWorkspacePresentation(repo)

    act(() => {
      root!.render(
        <TerminalSessionReadContext.Provider value={emptyTerminalReadContext}>
          <BranchWorkspaceContent repo={repo} detail={detail} workspacePaneId="workspace" />
        </TerminalSessionReadContext.Provider>,
      )
    })
    await flushAsyncWork()

    expect(container?.querySelector('#workspace-history-panel')?.getAttribute('aria-labelledby')).toBe(
      'workspace-workspace-pane-view-1',
    )
  })

  test('shows an error state when branch history cannot be read', async () => {
    repoClientMocks.getRepositoryLog.mockRejectedValue(new Error('error.failed-read-repo'))
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/history')],
      selectedBranch: 'feature/history',
      workspacePaneView: 'history',
      openBranchWorkspacePaneViews: ['history'],
    })
    const detail = getSelectedBranchWorkspacePresentation(repo)

    act(() => {
      root!.render(
        <TerminalSessionReadContext.Provider value={emptyTerminalReadContext}>
          <BranchWorkspaceContent repo={repo} detail={detail} workspacePaneId="workspace" />
        </TerminalSessionReadContext.Provider>,
      )
    })
    await flushAsyncWork()

    expect(container?.textContent).toContain('error.failed-read-repo')
    expect(container?.textContent).not.toContain('log.empty-for-branch')
  })
})

const emptyWorktreeSnapshot: WorktreeTerminalSnapshot = {
  worktreeTerminalKey: '',
  selectedDescriptor: null,
  sessions: [],
  staticWorkspacePaneViews: [],
  workspacePaneViews: [],
  count: 0,
  bellCount: 0,
  pendingCreate: false,
}

const emptyTerminalReadContext: TerminalSessionReadContextValue = {
  worktreeSnapshot: () => emptyWorktreeSnapshot,
  subscribeWorktree: () => () => {},
  snapshot: () => ({ phase: 'opening', message: null, processName: 'terminal' }),
  subscribeSnapshot: () => () => {},
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve()
  })
}
