// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BranchWorkspaceContent } from '#/web/components/branch-workspace/BranchWorkspaceContent.tsx'
import { getSelectedBranchWorkspacePresentation } from '#/web/components/branch-workspace/model.ts'
import {
  TerminalSessionContext,
  TerminalSessionReadContext,
} from '#/web/components/terminal/terminal-session-context.ts'
import type {
  TerminalSessionContextValue,
  TerminalSessionSummary,
  TerminalSessionReadContextValue,
  WorktreeTerminalSnapshot,
} from '#/web/components/terminal/types.ts'
import {
  createBranchSnapshot,
  createRepoBranch,
  resetReposStore,
  seedRepoState,
} from '#/web/stores/repos/test-utils.ts'
import { useRepoSyncStore } from '#/web/stores/repo-sync.ts'
import type { WorkspacePaneStaticViewType } from '#/shared/workspace-pane.ts'
import { workspacePaneStaticTabOrderEntry, workspacePaneTerminalTabOrderEntry } from '#/shared/workspace-pane.ts'

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
  useRepoSyncStore.setState({ ready: new Map(), timestamps: new Map() })
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
  function changesReadContext(worktreePath: string): TerminalSessionReadContextValue {
    // Build the snapshot once and reuse the same reference — returning a
    // fresh object on every call makes zustand / useSyncExternalStore
    // believe the store changed and triggers an infinite render loop.
    const changesWorktreeSnapshot: WorktreeTerminalSnapshot = {
      ...emptyWorktreeSnapshot,
      worktreeTerminalKey: `${REPO_ID}\0${worktreePath}`,
    }
    return {
      ...emptyTerminalReadContext,
      worktreeSnapshot: () => changesWorktreeSnapshot,
    }
  }

  test('renders copy patch as a floating widget in the changes tab', () => {
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
      preferredWorkspacePaneView: 'changes',
      workspacePaneTabOrderByBranch: {
        'feature/changes': [staticEntry('status'), staticEntry('changes')],
      },
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
    const readContext = changesReadContext(worktreePath)

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
    expect(container?.querySelector('.goblin-changes-tab__copy-patch')).not.toBeNull()
    expect(container?.textContent).toContain('status.copy-patch')

    const copyButton = container?.querySelector<HTMLButtonElement>('button[aria-label="status.copy-patch-title"]')
    expect(copyButton).not.toBeNull()
    act(() => {
      copyButton!.click()
    })
    expect(onCopyPatch).toHaveBeenCalledTimes(1)
  })

  test('shows a check affordance after copy patch onSelect resolves to true, then reverts', async () => {
    vi.useFakeTimers()
    const worktreePath = '/tmp/copy-success-worktree'
    const repo = seedRepoState({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/copy-success', {
          worktree: { path: worktreePath, summary: { dirty: true, changeCount: 1 } },
        }),
      ],
      selectedBranch: 'feature/copy-success',
      preferredWorkspacePaneView: 'changes',
      workspacePaneTabOrderByBranch: {
        'feature/copy-success': [staticEntry('status'), staticEntry('changes')],
      },
      statusLoaded: true,
      status: [
        {
          path: worktreePath,
          branch: 'feature/copy-success',
          isMain: false,
          entries: [{ x: 'M', y: ' ', path: 'src/example.ts' }],
        },
      ],
    })
    const detail = getSelectedBranchWorkspacePresentation(repo)
    const readContext = changesReadContext(worktreePath)
    const onCopyPatch = vi.fn().mockResolvedValue(true)

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

    const copyButton = container?.querySelector<HTMLButtonElement>('button[aria-label="status.copy-patch-title"]')!
    expect(copyButton).not.toBeNull()

    await act(async () => {
      copyButton.click()
      await vi.runOnlyPendingTimersAsync()
    })

    expect(container?.textContent).toContain('status.copy-patch-success')

    act(() => {
      vi.advanceTimersByTime(1500)
    })

    expect(container?.textContent).not.toContain('status.copy-patch-success')
    vi.useRealTimers()
  })

  test('does not show the check affordance when copy patch onSelect resolves to false', async () => {
    const worktreePath = '/tmp/copy-fail-worktree'
    const repo = seedRepoState({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/copy-fail', {
          worktree: { path: worktreePath, summary: { dirty: true, changeCount: 1 } },
        }),
      ],
      selectedBranch: 'feature/copy-fail',
      preferredWorkspacePaneView: 'changes',
      workspacePaneTabOrderByBranch: {
        'feature/copy-fail': [staticEntry('status'), staticEntry('changes')],
      },
      statusLoaded: true,
      status: [
        {
          path: worktreePath,
          branch: 'feature/copy-fail',
          isMain: false,
          entries: [{ x: 'M', y: ' ', path: 'src/example.ts' }],
        },
      ],
    })
    const detail = getSelectedBranchWorkspacePresentation(repo)
    const readContext = changesReadContext(worktreePath)
    const onCopyPatch = vi.fn().mockResolvedValue(false)

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

    const copyButton = container?.querySelector<HTMLButtonElement>('button[aria-label="status.copy-patch-title"]')!
    await act(async () => {
      copyButton.click()
      await Promise.resolve()
    })

    expect(container?.textContent).not.toContain('status.copy-patch-success')
  })

  test('does not invoke onSelect while action.busy is true', () => {
    const worktreePath = '/tmp/copy-busy-worktree'
    const repo = seedRepoState({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/copy-busy', {
          worktree: { path: worktreePath, summary: { dirty: true, changeCount: 1 } },
        }),
      ],
      selectedBranch: 'feature/copy-busy',
      preferredWorkspacePaneView: 'changes',
      workspacePaneTabOrderByBranch: {
        'feature/copy-busy': [staticEntry('status'), staticEntry('changes')],
      },
      statusLoaded: true,
      status: [
        {
          path: worktreePath,
          branch: 'feature/copy-busy',
          isMain: false,
          entries: [{ x: 'M', y: ' ', path: 'src/example.ts' }],
        },
      ],
    })
    const detail = getSelectedBranchWorkspacePresentation(repo)
    const readContext = changesReadContext(worktreePath)
    const onCopyPatch = vi.fn().mockResolvedValue(true)

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
              busy: true,
              visible: true,
              onSelect: onCopyPatch,
            }}
          />
        </TerminalSessionReadContext.Provider>,
      )
    })

    const copyButton = container?.querySelector<HTMLButtonElement>('button[aria-label="status.copy-patch-title"]')!
    expect(copyButton.getAttribute('aria-busy')).toBe('true')
    expect(copyButton.hasAttribute('disabled')).toBe(true)

    act(() => {
      copyButton.click()
    })

    expect(onCopyPatch).not.toHaveBeenCalled()
  })

  test('hides the copy patch float widget when the worktree has no changes', () => {
    const worktreePath = '/tmp/clean-worktree'
    const repo = seedRepoState({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/clean', {
          worktree: { path: worktreePath, summary: { dirty: false, changeCount: 0 } },
        }),
      ],
      selectedBranch: 'feature/clean',
      preferredWorkspacePaneView: 'changes',
      workspacePaneTabOrderByBranch: {
        'feature/clean': [staticEntry('status'), staticEntry('changes')],
      },
      statusLoaded: true,
      status: [{ path: worktreePath, branch: 'feature/clean', isMain: false, entries: [] }],
    })
    const detail = getSelectedBranchWorkspacePresentation(repo)
    const readContext = changesReadContext(worktreePath)

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
              onSelect: vi.fn(),
            }}
          />
        </TerminalSessionReadContext.Provider>,
      )
    })

    expect(container?.querySelector('.goblin-changes-tab__copy-patch')).toBeNull()
  })

  test('hides the copy patch float widget when copyPatchAction.visible is false', () => {
    const worktreePath = '/tmp/visibility-worktree'
    const repo = seedRepoState({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/hidden', {
          worktree: { path: worktreePath, summary: { dirty: true, changeCount: 1 } },
        }),
      ],
      selectedBranch: 'feature/hidden',
      preferredWorkspacePaneView: 'changes',
      workspacePaneTabOrderByBranch: {
        'feature/hidden': [staticEntry('status'), staticEntry('changes')],
      },
      statusLoaded: true,
      status: [
        {
          path: worktreePath,
          branch: 'feature/hidden',
          isMain: false,
          entries: [{ x: 'M', y: ' ', path: 'src/example.ts' }],
        },
      ],
    })
    const detail = getSelectedBranchWorkspacePresentation(repo)
    const readContext = changesReadContext(worktreePath)

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
              visible: false,
              onSelect: vi.fn(),
            }}
          />
        </TerminalSessionReadContext.Provider>,
      )
    })

    expect(container?.querySelector('.goblin-changes-tab__copy-patch')).toBeNull()
  })

  test('hides the copy patch float widget when status is stale and errored, but keeps the StaleStatusNotice', () => {
    const worktreePath = '/tmp/stale-worktree'
    const repo = seedRepoState({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/stale', {
          worktree: { path: worktreePath, summary: { dirty: true, changeCount: 1 } },
        }),
      ],
      selectedBranch: 'feature/stale',
      preferredWorkspacePaneView: 'changes',
      workspacePaneTabOrderByBranch: {
        'feature/stale': [staticEntry('status'), staticEntry('changes')],
      },
      statusLoaded: true,
      status: [
        {
          path: worktreePath,
          branch: 'feature/stale',
          isMain: false,
          entries: [{ x: 'M', y: ' ', path: 'src/example.ts' }],
        },
      ],
    })
    // `getSelectedBranchWorkspacePresentation` reads from `repo.resources.status`
    // directly, so marking the resource stale+errored on a clone is enough
    // to drive `statusStale && statusError` in BranchChangesTab.
    const staleRepo: typeof repo = {
      ...repo,
      resources: {
        ...repo.resources,
        status: {
          ...repo.resources.status,
          stale: true,
          error: 'error.failed-read-repo',
        },
      },
    }
    const detail = getSelectedBranchWorkspacePresentation(staleRepo)
    const readContext = changesReadContext(worktreePath)

    act(() => {
      root!.render(
        <TerminalSessionReadContext.Provider value={readContext}>
          <BranchWorkspaceContent
            repo={staleRepo}
            detail={detail}
            workspacePaneId="workspace"
            copyPatchAction={{
              label: 'status.copy-patch',
              title: 'status.copy-patch-title',
              ariaLabel: 'status.copy-patch-title',
              disabled: false,
              visible: true,
              onSelect: vi.fn(),
            }}
          />
        </TerminalSessionReadContext.Provider>,
      )
    })

    expect(container?.querySelector('.goblin-changes-tab__copy-patch')).toBeNull()
    // The stale notice should still be visible — the widget is hidden
    // specifically to avoid overlapping it.
    expect(container?.textContent).toContain('status.stale-title')
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
      preferredWorkspacePaneView: 'status',
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
      preferredWorkspacePaneView: 'status',
      workspacePaneTabOrderByBranch: { 'feature/no-worktree': [] },
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

  test('does not render status for a worktree-scoped preference on a branch without a worktree', () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      selectedBranch: 'feature/no-worktree',
      preferredWorkspacePaneView: 'terminal',
      workspacePaneTabOrderByBranch: { 'feature/no-worktree': [staticEntry('status')] },
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
    expect(container?.querySelector('#workspace-terminal-panel')).toBeNull()
    expect(container?.textContent).toContain('workspace-pane-views.empty')
  })

  test('does not render status when terminal is preferred but sync confirms no terminal tabs', () => {
    const worktreePath = '/tmp/terminal-empty-worktree'
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/terminal-empty', { worktree: { path: worktreePath } })],
      selectedBranch: 'feature/terminal-empty',
      preferredWorkspacePaneView: 'terminal',
      workspacePaneTabOrderByBranch: { 'feature/terminal-empty': [staticEntry('status')] },
    })
    useRepoSyncStore.getState().markReady(REPO_ID, repo.instanceToken)
    const detail = getSelectedBranchWorkspacePresentation(repo)

    act(() => {
      root!.render(
        <TerminalSessionReadContext.Provider value={emptyTerminalReadContext}>
          <BranchWorkspaceContent repo={repo} detail={detail} workspacePaneId="workspace" />
        </TerminalSessionReadContext.Provider>,
      )
    })

    expect(container?.querySelector('#workspace-status-panel')).toBeNull()
    expect(container?.querySelector('#workspace-terminal-panel')).toBeNull()
    expect(container?.textContent).toContain('workspace-pane-views.empty')
  })

  test('mounts the terminal slot while terminal creation is pending with no sessions', () => {
    const worktreePath = '/tmp/terminal-pending-worktree'
    const worktreeKey = `${REPO_ID}\0${worktreePath}`
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/terminal-pending', { worktree: { path: worktreePath } })],
      selectedBranch: 'feature/terminal-pending',
      preferredWorkspacePaneView: 'terminal',
      workspacePaneTabOrderByBranch: { 'feature/terminal-pending': [staticEntry('status')] },
    })
    useRepoSyncStore.getState().markReady(REPO_ID, repo.instanceToken)
    const detail = getSelectedBranchWorkspacePresentation(repo)
    const registerHost = vi.fn()
    const worktreeSnapshot: WorktreeTerminalSnapshot = {
      ...emptyWorktreeSnapshot,
      worktreeTerminalKey: worktreeKey,
      pendingCreate: true,
    }
    const readContext: TerminalSessionReadContextValue = {
      ...emptyTerminalReadContext,
      worktreeSnapshot: () => worktreeSnapshot,
    }

    act(() => {
      root!.render(
        <TerminalSessionContext.Provider value={terminalCommandContextWith({ registerHost })}>
          <TerminalSessionReadContext.Provider value={readContext}>
            <BranchWorkspaceContent repo={repo} detail={detail} workspacePaneId="workspace" />
          </TerminalSessionReadContext.Provider>
        </TerminalSessionContext.Provider>,
      )
    })

    const panel = container?.querySelector('#workspace-terminal-panel')
    expect(panel).not.toBeNull()
    expect(panel?.getAttribute('aria-label')).toBe('terminal.opening')
    expect(panel?.hasAttribute('aria-labelledby')).toBe(false)
    expect(container?.querySelector('.goblin-terminal-slot__host')).not.toBeNull()
    expect(container?.textContent).toContain('terminal.opening')
    expect(container?.textContent).not.toContain('workspace-pane-views.empty')
    expect(registerHost).toHaveBeenCalledWith(worktreeKey, expect.any(HTMLDivElement))
  })

  test('renders terminal loading without a create CTA while initial terminal sync is unresolved', () => {
    const worktreePath = '/tmp/terminal-loading-worktree'
    const worktreeKey = `${REPO_ID}\0${worktreePath}`
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/terminal-loading', { worktree: { path: worktreePath } })],
      selectedBranch: 'feature/terminal-loading',
      preferredWorkspacePaneView: 'terminal',
      workspacePaneTabOrderByBranch: { 'feature/terminal-loading': [staticEntry('status')] },
    })
    const detail = getSelectedBranchWorkspacePresentation(repo)
    const createTerminal = vi.fn(async () => 'terminal-1')
    const registerHost = vi.fn()
    const worktreeSnapshot: WorktreeTerminalSnapshot = {
      ...emptyWorktreeSnapshot,
      worktreeTerminalKey: worktreeKey,
      pendingCreate: false,
    }
    const readContext: TerminalSessionReadContextValue = {
      ...emptyTerminalReadContext,
      worktreeSnapshot: () => worktreeSnapshot,
    }

    act(() => {
      root!.render(
        <TerminalSessionContext.Provider value={terminalCommandContextWith({ createTerminal, registerHost })}>
          <TerminalSessionReadContext.Provider value={readContext}>
            <BranchWorkspaceContent repo={repo} detail={detail} workspacePaneId="workspace" />
          </TerminalSessionReadContext.Provider>
        </TerminalSessionContext.Provider>,
      )
    })

    const panel = container?.querySelector('#workspace-terminal-panel')
    expect(panel).not.toBeNull()
    expect(panel?.getAttribute('aria-label')).toBe('terminal.loading')
    expect(panel?.hasAttribute('aria-labelledby')).toBe(false)
    expect(container?.textContent).toContain('terminal.loading')
    expect(container?.textContent).not.toContain('terminal.new')
    expect(container?.querySelector('.goblin-terminal-slot__empty-cta')).toBeNull()
    expect(createTerminal).not.toHaveBeenCalled()
    expect(registerHost).toHaveBeenCalledWith(worktreeKey, expect.any(HTMLDivElement))
  })

  test('labels terminal panels from the unified tab order, not runtime session order', () => {
    const worktreePath = '/tmp/terminal-reordered-worktree'
    const worktreeKey = `${REPO_ID}\0${worktreePath}`
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/terminal-reordered', { worktree: { path: worktreePath } })],
      selectedBranch: 'feature/terminal-reordered',
      preferredWorkspacePaneView: 'terminal',
      workspacePaneTabOrderByBranch: {
        'feature/terminal-reordered': [terminalEntry('t2'), staticEntry('status'), terminalEntry('t1')],
      },
    })
    useRepoSyncStore.getState().markReady(REPO_ID, repo.instanceToken)
    const detail = getSelectedBranchWorkspacePresentation(repo)
    const registerHost = vi.fn()
    const worktreeSnapshot: WorktreeTerminalSnapshot = {
      ...emptyWorktreeSnapshot,
      worktreeTerminalKey: worktreeKey,
      sessions: [terminalSession('t1', 1, false, worktreeKey), terminalSession('t2', 2, true, worktreeKey)],
      count: 2,
    }
    const readContext: TerminalSessionReadContextValue = {
      ...emptyTerminalReadContext,
      worktreeSnapshot: () => worktreeSnapshot,
    }

    act(() => {
      root!.render(
        <TerminalSessionContext.Provider value={terminalCommandContextWith({ registerHost })}>
          <TerminalSessionReadContext.Provider value={readContext}>
            <BranchWorkspaceContent repo={repo} detail={detail} workspacePaneId="workspace" />
          </TerminalSessionReadContext.Provider>
        </TerminalSessionContext.Provider>,
      )
    })

    expect(container?.querySelector('#workspace-terminal-panel')?.getAttribute('aria-labelledby')).toBe(
      'workspace-workspace-pane-view',
    )
    expect(registerHost).toHaveBeenCalledWith(worktreeKey, expect.any(HTMLDivElement))
  })

  test('does not select another tab when the preferred branch tab is closed', async () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/a'), createRepoBranch('feature/b')],
      selectedBranch: 'feature/b',
      preferredWorkspacePaneView: 'history',
      workspacePaneTabOrderByBranch: {
        'feature/a': [staticEntry('status'), staticEntry('history')],
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

    expect(container?.querySelector('#workspace-status-panel')).toBeNull()
    expect(container?.querySelector('#workspace-history-panel')).toBeNull()
    expect(container?.textContent).toContain('workspace-pane-views.empty')
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
      preferredWorkspacePaneView: 'history',
      workspacePaneTabOrderByBranch: { 'feature/history': [staticEntry('status'), staticEntry('history')] },
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

  test('labels worktree history panels with the branch-owned tab id', async () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/history', { worktree: { path: '/tmp/history-worktree' } })],
      selectedBranch: 'feature/history',
      preferredWorkspacePaneView: 'history',
      workspacePaneTabOrderByBranch: { 'feature/history': [staticEntry('status'), staticEntry('history')] },
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
      'workspace-history-tab',
    )
  })

  test('shows an error state when branch history cannot be read', async () => {
    repoClientMocks.getRepositoryLog.mockRejectedValue(new Error('error.failed-read-repo'))
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/history')],
      selectedBranch: 'feature/history',
      preferredWorkspacePaneView: 'history',
      workspacePaneTabOrderByBranch: { 'feature/history': [staticEntry('history')] },
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

function terminalCommandContextWith(overrides: Partial<TerminalSessionContextValue> = {}): TerminalSessionContextValue {
  return {
    createTerminal: vi.fn(async () => 'terminal-1'),
    registerHost: vi.fn(),
    unregisterHost: vi.fn(),
    selectTerminal: vi.fn(),
    scrollToBottom: vi.fn(),
    scrollLines: vi.fn(),
    clearBell: vi.fn(() => false),
    closeTerminalByDescriptor: vi.fn(),
    attach: vi.fn(),
    detach: vi.fn(),
    restart: vi.fn(),
    isTerminalFocusTarget: vi.fn(() => false),
    findNext: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
    findPrevious: vi.fn(() => ({ resultIndex: -1, resultCount: 0, found: false })),
    clearSearch: vi.fn(),
    writeInput: vi.fn(),
    takeover: vi.fn(async () => true),
    serialize: vi.fn(() => ''),
    ...overrides,
  }
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve()
  })
}

function staticEntry(type: WorkspacePaneStaticViewType) {
  return workspacePaneStaticTabOrderEntry(type)
}

function terminalEntry(id: string) {
  return workspacePaneTerminalTabOrderEntry(id)
}

function terminalSession(
  key: string,
  index: number,
  selected: boolean,
  worktreeTerminalKey: string,
): TerminalSessionSummary {
  return {
    type: 'terminal',
    id: key,
    key,
    worktreeTerminalKey,
    terminalId: key,
    index,
    displayOrder: index,
    title: key,
    phase: 'open',
    selected,
    hasBell: false,
  }
}
