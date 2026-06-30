// @vitest-environment jsdom

import type { ComponentProps } from 'react'
import { act, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoWorkspaceContent } from '#/web/components/repo-workspace/RepoWorkspaceContent.tsx'
import { BranchActionSurfaceContext } from '#/web/components/repo-workspace/branch-action-surface-context.ts'
import { getSelectedRepoWorkspacePresentation } from '#/web/components/repo-workspace/model.ts'
import { useRepoWorkspaceTabModel } from '#/web/components/repo-workspace/use-repo-workspace-tab-model.ts'
import type { BranchCopyPatchAction } from '#/web/hooks/branch-action-state.ts'
import {
  TerminalSessionContext,
  TerminalSessionReadContext,
} from '#/web/components/terminal/terminal-session-context.ts'
import type {
  TerminalSessionContextValue,
  TerminalSessionSummary,
  TerminalSessionReadContextValue,
  TerminalWorktreeSnapshot,
} from '#/web/components/terminal/types.ts'
import { createBranchSnapshot, createRepoBranch, resetReposStore, seedRepoState } from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useRepoSyncStore } from '#/web/stores/repo-sync.ts'
import type { WorkspacePaneStaticTabType } from '#/shared/workspace-pane.ts'
import { workspacePaneStaticTabOrderEntry, workspacePaneTerminalTabOrderEntry } from '#/shared/workspace-pane.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import {
  PrimaryWindowNavigationProvider,
  type PrimaryWindowNavigationActions,
} from '#/web/primary-window-navigation.tsx'

const repoClientMocks = vi.hoisted(() => ({
  getRepoLog: vi.fn(),
  openRepoUrl: vi.fn(),
}))
const filetreeClientMocks = vi.hoisted(() => ({
  getRepositoryTree: vi.fn(),
  getRepositoryFileViewer: vi.fn(),
}))
vi.mock('#/web/repo-client.ts', () => ({
  getRepoLog: repoClientMocks.getRepoLog,
  openRepoUrl: repoClientMocks.openRepoUrl,
}))
vi.mock('#/web/filetree-client.ts', () => ({
  getRepositoryTree: filetreeClientMocks.getRepositoryTree,
  getRepositoryFileViewer: filetreeClientMocks.getRepositoryFileViewer,
}))
const REPO_ID = '/tmp/gbl-repo-workspace-content-repo'

type RepoWorkspaceContentHarnessProps = Omit<ComponentProps<typeof RepoWorkspaceContent>, 'workspacePaneTabModel'>

function RepoWorkspaceContentHarness(props: RepoWorkspaceContentHarnessProps) {
  const workspacePaneTabModel = useRepoWorkspaceTabModel(props.repo, props.detail)
  return <RepoWorkspaceContent {...props} workspacePaneTabModel={workspacePaneTabModel} />
}

beforeEach(() => {
  resetReposStore()
  useRepoSyncStore.setState({ ready: new Map(), timestamps: new Map() })
  repoClientMocks.getRepoLog.mockResolvedValue([])
  repoClientMocks.openRepoUrl.mockResolvedValue({ ok: true, message: '' })
  filetreeClientMocks.getRepositoryTree.mockResolvedValue({ nodes: [], truncated: false })
  filetreeClientMocks.getRepositoryFileViewer.mockResolvedValue({ viewer: 'bat', shell: 'posix' })
})

describe('RepoWorkspaceContent', () => {
  // The status tab pulls `copyPatchAction` from the action surface
  // context. Surface it directly so the test can drive it without
  // mounting the whole `useBranchActionItems` machinery.
  function branchActionSurfaceWithCopyPatch(
    copyPatchAction: Pick<BranchCopyPatchAction, 'label' | 'title' | 'disabled' | 'visible' | 'onSelect'>,
  ) {
    return {
      mainItems: [],
      destructiveItems: [],
      copyPatchAction,
    }
  }

  // Tests that don't care about the patch button still need a
  // surface in scope — the status tab calls useBranchActionSurface
  // unconditionally so it can decide whether to render its row.
  function defaultBranchActionSurface() {
    return branchActionSurfaceWithCopyPatch({
      label: 'status.copy-patch',
      title: 'status.copy-patch-title',
      disabled: false,
      visible: false,
      onSelect: () => false,
    })
  }

  test('renders the changes row with the copy patch action in the status tab when the worktree is dirty', () => {
    const onCopyPatch = vi.fn()
    const worktreePath = '/tmp/changes-worktree'
    const repo = seedRepoState({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/changes', {
          worktree: { path: worktreePath, summary: { dirty: true, changeCount: 4 } },
        }),
      ],
      selectedBranch: 'feature/changes',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabOrderByBranch: {
        'feature/changes': [staticEntry('status'), staticEntry('changes')],
      },
      statusLoaded: true,
      status: [
        {
          path: worktreePath,
          branch: 'feature/changes',
          isMain: false,
          entries: [
            { x: 'M', y: ' ', path: 'src/a.ts' },
            { x: 'M', y: ' ', path: 'src/b.ts' },
            { x: 'M', y: ' ', path: 'src/c.ts' },
            { x: 'M', y: ' ', path: 'src/d.ts' },
          ],
        },
      ],
    })
    const detail = getSelectedRepoWorkspacePresentation(repo)

    const { container } = renderInJsdom(
      <TerminalSessionReadContext.Provider value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext.Provider
          value={branchActionSurfaceWithCopyPatch({
            label: 'status.copy-patch',
            title: 'status.copy-patch-title',
            disabled: false,
            visible: true,
            onSelect: onCopyPatch,
          })}
        >
          <RepoWorkspaceContentHarness repo={repo} detail={detail} workspacePaneId="workspace" />
        </BranchActionSurfaceContext.Provider>
      </TerminalSessionReadContext.Provider>,
    )

    expect(container.querySelector('#workspace-status-panel')).not.toBeNull()
    expect(container.textContent).toContain('branch-status.changes-count')
    expect(container.textContent).toContain('branch-status.signal.changes')

    const copyButton = container.querySelector<HTMLButtonElement>('button[aria-label="status.copy-patch-title"]')
    expect(copyButton).not.toBeNull()
    // The button is now icon-only (no visible text), mirroring CopyButton.
    expect(copyButton!.textContent?.trim()).toBe('')
    act(() => {
      copyButton!.click()
    })
    expect(onCopyPatch).toHaveBeenCalledTimes(1)
  })

  test('flashes the check affordance when copy patch onSelect resolves to true, then reverts', async () => {
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
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabOrderByBranch: {
        'feature/copy-success': [staticEntry('status')],
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
    const detail = getSelectedRepoWorkspacePresentation(repo)
    const onCopyPatch = vi.fn().mockResolvedValue(true)

    const { container } = renderInJsdom(
      <TerminalSessionReadContext.Provider value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext.Provider
          value={branchActionSurfaceWithCopyPatch({
            label: 'status.copy-patch',
            title: 'status.copy-patch-title',
            disabled: false,
            visible: true,
            onSelect: onCopyPatch,
          })}
        >
          <RepoWorkspaceContentHarness repo={repo} detail={detail} workspacePaneId="workspace" />
        </BranchActionSurfaceContext.Provider>
      </TerminalSessionReadContext.Provider>,
    )

    const copyButton = container.querySelector<HTMLButtonElement>('button[aria-label="status.copy-patch-title"]')!
    expect(copyButton).not.toBeNull()

    await act(async () => {
      copyButton.click()
      await vi.runOnlyPendingTimersAsync()
    })

    // After success, the tooltip stays open and the label flips to
    // status.copy-patch-success. Radix renders the tooltip into a
    // portal under document.body, so check the whole document.
    expect(document.body.textContent).toContain('status.copy-patch-success')

    act(() => {
      vi.advanceTimersByTime(1500)
    })

    expect(document.body.textContent).not.toContain('status.copy-patch-success')
    vi.useRealTimers()
  })

  test('does not render the changes row in the status tab when the worktree is clean', () => {
    const worktreePath = '/tmp/clean-worktree'
    const repo = seedRepoState({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/clean', {
          worktree: { path: worktreePath, summary: { dirty: false, changeCount: 0 } },
        }),
      ],
      selectedBranch: 'feature/clean',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabOrderByBranch: {
        'feature/clean': [staticEntry('status')],
      },
      statusLoaded: true,
      status: [{ path: worktreePath, branch: 'feature/clean', isMain: false, entries: [] }],
    })
    const detail = getSelectedRepoWorkspacePresentation(repo)

    const { container } = renderInJsdom(
      <TerminalSessionReadContext.Provider value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext.Provider
          value={branchActionSurfaceWithCopyPatch({
            label: 'status.copy-patch',
            title: 'status.copy-patch-title',
            disabled: false,
            visible: true,
            onSelect: vi.fn(),
          })}
        >
          <RepoWorkspaceContentHarness repo={repo} detail={detail} workspacePaneId="workspace" />
        </BranchActionSurfaceContext.Provider>
      </TerminalSessionReadContext.Provider>,
    )

    expect(container.querySelector('#workspace-status-panel')).not.toBeNull()
    expect(container.textContent).not.toContain('branch-status.changes-count')
    expect(container.textContent).not.toContain('branch-status.signal.changes')
    expect(container.querySelector('button[aria-label="status.copy-patch-title"]')).toBeNull()
  })

  test('hides the copy patch button on the changes row when copyPatchAction.visible is false', () => {
    const worktreePath = '/tmp/visibility-worktree'
    const repo = seedRepoState({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/hidden', {
          worktree: { path: worktreePath, summary: { dirty: true, changeCount: 1 } },
        }),
      ],
      selectedBranch: 'feature/hidden',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabOrderByBranch: {
        'feature/hidden': [staticEntry('status')],
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
    const detail = getSelectedRepoWorkspacePresentation(repo)

    const { container } = renderInJsdom(
      <TerminalSessionReadContext.Provider value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext.Provider
          value={branchActionSurfaceWithCopyPatch({
            label: 'status.copy-patch',
            title: 'status.copy-patch-title',
            disabled: false,
            visible: false,
            onSelect: vi.fn(),
          })}
        >
          <RepoWorkspaceContentHarness repo={repo} detail={detail} workspacePaneId="workspace" />
        </BranchActionSurfaceContext.Provider>
      </TerminalSessionReadContext.Provider>,
    )

    expect(container.textContent).toContain('branch-status.changes-count')
    expect(container.querySelector('button[aria-label="status.copy-patch-title"]')).toBeNull()
  })

  test('renders the changes panel with status entries and tab labelling', () => {
    const worktreePath = '/tmp/changes-panel-worktree'
    const repo = seedRepoState({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/changes-panel', {
          worktree: { path: worktreePath, summary: { dirty: true, changeCount: 2 } },
        }),
      ],
      selectedBranch: 'feature/changes-panel',
      preferredWorkspacePaneTab: 'changes',
      workspacePaneTabOrderByBranch: {
        'feature/changes-panel': [staticEntry('status'), staticEntry('changes')],
      },
      statusLoaded: true,
      status: [
        {
          path: worktreePath,
          branch: 'feature/changes-panel',
          isMain: false,
          entries: [
            { x: 'M', y: ' ', path: 'src/alpha.ts' },
            { x: '?', y: '?', path: 'src/beta.ts' },
          ],
        },
      ],
    })
    const detail = getSelectedRepoWorkspacePresentation(repo)

    const { container } = renderInJsdom(
      <TerminalSessionReadContext.Provider value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext.Provider value={defaultBranchActionSurface()}>
          <RepoWorkspaceContentHarness repo={repo} detail={detail} workspacePaneId="workspace" />
        </BranchActionSurfaceContext.Provider>
      </TerminalSessionReadContext.Provider>,
    )

    const panel = container.querySelector('#workspace-changes-panel')
    expect(panel).not.toBeNull()
    expect(panel?.getAttribute('role')).toBe('tabpanel')
    expect(panel?.getAttribute('aria-labelledby')).toBe('workspace-changes-tab')
    expect(panel?.querySelector('[aria-label="M "]')).not.toBeNull()
    expect(panel?.querySelector('[aria-label="??"]')).not.toBeNull()
    expect(panel?.querySelector('[aria-label="src/alpha.ts"]')).not.toBeNull()
    expect(panel?.querySelector('[aria-label="src/beta.ts"]')).not.toBeNull()
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
      preferredWorkspacePaneTab: 'status',
    })
    const detail = getSelectedRepoWorkspacePresentation(repo)

    const { container } = renderInJsdom(
      <TerminalSessionReadContext.Provider value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext.Provider value={defaultBranchActionSurface()}>
          <RepoWorkspaceContentHarness repo={repo} detail={detail} workspacePaneId="workspace" />
        </BranchActionSurfaceContext.Provider>
      </TerminalSessionReadContext.Provider>,
    )

    expect(container.querySelector('#workspace-status-panel')).not.toBeNull()
    expect(container.textContent).toContain('feature/no-worktree')
    expect(container.textContent).toContain('branch-status.worktree.none')
    expect(container.textContent).not.toContain('workspace-pane-tabs.empty')
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
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabOrderByBranch: { 'feature/no-worktree': [] },
    })
    const detail = getSelectedRepoWorkspacePresentation(repo)

    const { container } = renderInJsdom(
      <TerminalSessionReadContext.Provider value={emptyTerminalReadContext}>
        <RepoWorkspaceContentHarness repo={repo} detail={detail} workspacePaneId="workspace" />
      </TerminalSessionReadContext.Provider>,
    )

    expect(container.querySelector('#workspace-status-panel')).toBeNull()
    expect(container.textContent).toContain('workspace-pane-tabs.empty')
  })

  test('falls back to status when a worktree-scoped preference is unrenderable on a branch without a worktree', () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      selectedBranch: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabOrderByBranch: { 'feature/no-worktree': [staticEntry('status')] },
    })
    const detail = getSelectedRepoWorkspacePresentation(repo)

    const { container } = renderInJsdom(
      <TerminalSessionReadContext.Provider value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext.Provider value={defaultBranchActionSurface()}>
          <RepoWorkspaceContentHarness repo={repo} detail={detail} workspacePaneId="workspace" />
        </BranchActionSurfaceContext.Provider>
      </TerminalSessionReadContext.Provider>,
    )

    // The user's preferred tab (terminal) is unrenderable without a
    // worktree. The model falls back to the first materialized tab (status)
    // so the user lands on a real tab instead of the empty pane.
    expect(container.querySelector('#workspace-status-panel')).not.toBeNull()
    expect(container.querySelector('#workspace-terminal-panel')).toBeNull()
    expect(container.textContent).not.toContain('workspace-pane-tabs.empty')
  })

  test('falls back to status when terminal is preferred but sync confirms no terminal tabs', () => {
    const worktreePath = '/tmp/terminal-empty-worktree'
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/terminal-empty', { worktree: { path: worktreePath } })],
      selectedBranch: 'feature/terminal-empty',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabOrderByBranch: { 'feature/terminal-empty': [staticEntry('status')] },
    })
    useRepoSyncStore.getState().markReady(REPO_ID, repo.instanceToken)
    const detail = getSelectedRepoWorkspacePresentation(repo)

    const { container } = renderInJsdom(
      <TerminalSessionReadContext.Provider value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext.Provider value={defaultBranchActionSurface()}>
          <RepoWorkspaceContentHarness repo={repo} detail={detail} workspacePaneId="workspace" />
        </BranchActionSurfaceContext.Provider>
      </TerminalSessionReadContext.Provider>,
    )

    // Sync is ready, the worktree has no terminal sessions, and the user
    // preferred terminal — the preferred tab is unrenderable. The model
    // falls back to the first materialized tab (status) at read time so
    // the user does not land on the empty pane.
    expect(container.querySelector('#workspace-status-panel')).not.toBeNull()
    expect(container.querySelector('#workspace-terminal-panel')).toBeNull()
    expect(container.textContent).not.toContain('workspace-pane-tabs.empty')
  })

  test('mounts the terminal session while terminal creation is pending with no sessions', () => {
    const worktreePath = '/tmp/terminal-pending-worktree'
    const terminalWorktreeKey = `${REPO_ID}\0${worktreePath}`
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/terminal-pending', { worktree: { path: worktreePath } })],
      selectedBranch: 'feature/terminal-pending',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabOrderByBranch: { 'feature/terminal-pending': [staticEntry('status')] },
    })
    useRepoSyncStore.getState().markReady(REPO_ID, repo.instanceToken)
    const detail = getSelectedRepoWorkspacePresentation(repo)
    const registerHost = vi.fn()
    const terminalWorktreeSnapshot: TerminalWorktreeSnapshot = {
      ...emptyWorktreeSnapshot,
      terminalWorktreeKey,
      pendingCreate: true,
    }
    const readContext: TerminalSessionReadContextValue = {
      ...emptyTerminalReadContext,
      terminalWorktreeSnapshot: () => terminalWorktreeSnapshot,
    }

    const { container } = renderInJsdom(
      <TerminalSessionContext.Provider value={terminalCommandContextWith({ registerHost })}>
        <TerminalSessionReadContext.Provider value={readContext}>
          <RepoWorkspaceContentHarness repo={repo} detail={detail} workspacePaneId="workspace" />
        </TerminalSessionReadContext.Provider>
      </TerminalSessionContext.Provider>,
    )

    const panel = container.querySelector('#workspace-terminal-panel')
    expect(panel).not.toBeNull()
    expect(panel?.getAttribute('aria-labelledby')).toBe('workspace-terminal-pending-tab')
    expect(panel?.hasAttribute('aria-label')).toBe(false)
    expect(container.querySelector('.goblin-terminal-session__host')).not.toBeNull()
    expect(container.textContent).toContain('terminal.opening')
    expect(container.textContent).not.toContain('workspace-pane-tabs.empty')
    expect(registerHost).toHaveBeenCalledWith(terminalWorktreeKey, expect.any(HTMLDivElement))
  })

  test('mounts the terminal session while terminal creation is pending after every tab was closed', () => {
    const worktreePath = '/tmp/terminal-pending-empty-strip-worktree'
    const terminalWorktreeKey = `${REPO_ID}\0${worktreePath}`
    const branchName = 'feature/terminal-pending-empty-strip'
    const seededRepo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch(branchName, { worktree: { path: worktreePath } })],
      selectedBranch: branchName,
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabOrderByBranch: { [branchName]: [] },
    })
    useRepoSyncStore.getState().markReady(REPO_ID, seededRepo.instanceToken)
    const repo = useReposStore.getState().repos[REPO_ID]!
    const detail = getSelectedRepoWorkspacePresentation(repo)
    const registerHost = vi.fn()
    const terminalWorktreeSnapshot: TerminalWorktreeSnapshot = {
      ...emptyWorktreeSnapshot,
      terminalWorktreeKey,
      pendingCreate: true,
    }
    const readContext: TerminalSessionReadContextValue = {
      ...emptyTerminalReadContext,
      terminalWorktreeSnapshot: () => terminalWorktreeSnapshot,
    }

    renderInJsdom(
      <TerminalSessionContext.Provider value={terminalCommandContextWith({ registerHost })}>
        <TerminalSessionReadContext.Provider value={readContext}>
          <RepoWorkspaceContentHarness repo={repo} detail={detail} workspacePaneId="workspace" />
        </TerminalSessionReadContext.Provider>
      </TerminalSessionContext.Provider>,
    )

    expect(screen.getByRole('tabpanel').id).toBe('workspace-terminal-panel')
    expect(screen.queryByText('workspace-pane-tabs.empty')).toBeNull()
    expect(registerHost).toHaveBeenCalledWith(terminalWorktreeKey, expect.any(HTMLDivElement))
  })

  test('renders terminal loading without a create CTA while initial terminal sync is unresolved', () => {
    const worktreePath = '/tmp/terminal-loading-worktree'
    const terminalWorktreeKey = `${REPO_ID}\0${worktreePath}`
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/terminal-loading', { worktree: { path: worktreePath } })],
      selectedBranch: 'feature/terminal-loading',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabOrderByBranch: { 'feature/terminal-loading': [staticEntry('status')] },
    })
    const detail = getSelectedRepoWorkspacePresentation(repo)
    const createTerminal = vi.fn(async () => 'session-1')
    const registerHost = vi.fn()
    const terminalWorktreeSnapshot: TerminalWorktreeSnapshot = {
      ...emptyWorktreeSnapshot,
      terminalWorktreeKey,
      pendingCreate: false,
    }
    const readContext: TerminalSessionReadContextValue = {
      ...emptyTerminalReadContext,
      terminalWorktreeSnapshot: () => terminalWorktreeSnapshot,
    }

    const { container } = renderInJsdom(
      <TerminalSessionContext.Provider value={terminalCommandContextWith({ createTerminal, registerHost })}>
        <TerminalSessionReadContext.Provider value={readContext}>
          <RepoWorkspaceContentHarness repo={repo} detail={detail} workspacePaneId="workspace" />
        </TerminalSessionReadContext.Provider>
      </TerminalSessionContext.Provider>,
    )

    const panel = container.querySelector('#workspace-terminal-panel')
    expect(panel).not.toBeNull()
    expect(panel?.getAttribute('aria-label')).toBe('terminal.loading')
    expect(panel?.hasAttribute('aria-labelledby')).toBe(false)
    expect(container.textContent).toContain('terminal.loading')
    expect(container.textContent).not.toContain('terminal.new')
    expect(container.querySelector('.goblin-terminal-session__empty-cta')).toBeNull()
    expect(createTerminal).not.toHaveBeenCalled()
    expect(registerHost).toHaveBeenCalledWith(terminalWorktreeKey, expect.any(HTMLDivElement))
  })

  test('labels terminal panels from the unified tab order, not runtime session order', () => {
    const worktreePath = '/tmp/terminal-reordered-worktree'
    const terminalWorktreeKey = `${REPO_ID}\0${worktreePath}`
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/terminal-reordered', { worktree: { path: worktreePath } })],
      selectedBranch: 'feature/terminal-reordered',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabOrderByBranch: {
        'feature/terminal-reordered': [terminalEntry('t2'), staticEntry('status'), terminalEntry('t1')],
      },
    })
    useRepoSyncStore.getState().markReady(REPO_ID, repo.instanceToken)
    const detail = getSelectedRepoWorkspacePresentation(repo)
    const registerHost = vi.fn()
    const terminalWorktreeSnapshot: TerminalWorktreeSnapshot = {
      ...emptyWorktreeSnapshot,
      terminalWorktreeKey,
      sessions: [
        terminalSession('t1', 1, false, terminalWorktreeKey),
        terminalSession('t2', 2, true, terminalWorktreeKey),
      ],
      count: 2,
    }
    const readContext: TerminalSessionReadContextValue = {
      ...emptyTerminalReadContext,
      terminalWorktreeSnapshot: () => terminalWorktreeSnapshot,
    }

    const { container } = renderInJsdom(
      <TerminalSessionContext.Provider value={terminalCommandContextWith({ registerHost })}>
        <TerminalSessionReadContext.Provider value={readContext}>
          <RepoWorkspaceContentHarness repo={repo} detail={detail} workspacePaneId="workspace" />
        </TerminalSessionReadContext.Provider>
      </TerminalSessionContext.Provider>,
    )

    expect(container.querySelector('#workspace-terminal-panel')?.getAttribute('aria-labelledby')).toBe(
      'workspace-workspace-pane-tab',
    )
    expect(registerHost).toHaveBeenCalledWith(terminalWorktreeKey, expect.any(HTMLDivElement))
  })

  test('opens a file by creating a terminal with a startup shell command instead of writing to an opening PTY', async () => {
    const worktreePath = '/tmp/filetree-open-worktree'
    const branchName = 'feature/filetree-open'
    filetreeClientMocks.getRepositoryTree.mockResolvedValueOnce({
      nodes: [
        {
          id: 'README.md',
          path: 'README.md',
          name: 'README.md',
          parentId: null,
          kind: 'file',
          status: 'clean',
        },
      ],
      truncated: false,
    })
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch(branchName, { worktree: { path: worktreePath } })],
      selectedBranch: branchName,
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabOrderByBranch: { [branchName]: [staticEntry('files')] },
    })
    useRepoSyncStore.getState().markReady(REPO_ID, repo.instanceToken)
    const detail = getSelectedRepoWorkspacePresentation(repo)
    const createTerminal = vi.fn(async () => 'session-1')
    const writeInput = vi.fn()
    const showRepoWorkspacePaneTab = vi.fn()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    renderInJsdom(
      <QueryClientProvider client={queryClient}>
        <PrimaryWindowNavigationProvider value={navigationWith({ showRepoWorkspacePaneTab })}>
          <TerminalSessionContext.Provider value={terminalCommandContextWith({ createTerminal, writeInput })}>
            <TerminalSessionReadContext.Provider value={emptyTerminalReadContext}>
              <BranchActionSurfaceContext.Provider value={defaultBranchActionSurface()}>
                <RepoWorkspaceContentHarness repo={repo} detail={detail} workspacePaneId="workspace" />
              </BranchActionSurfaceContext.Provider>
            </TerminalSessionReadContext.Provider>
          </TerminalSessionContext.Provider>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    const row = await screen.findByRole('treeitem', { name: 'README.md' })
    await act(async () => {
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      await Promise.resolve()
    })

    expect(showRepoWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'terminal')
    expect(createTerminal).toHaveBeenCalledWith(
      { repoRoot: REPO_ID, branch: branchName, worktreePath },
      { startupShellCommand: "bat --paging=never --style=plain '/tmp/filetree-open-worktree/README.md'\r" },
    )
    expect(writeInput).not.toHaveBeenCalled()
  })

  test('falls back to status when a branch preference names a closed tab', async () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/a'), createRepoBranch('feature/b')],
      selectedBranch: 'feature/b',
      preferredWorkspacePaneTab: 'history',
      workspacePaneTabOrderByBranch: {
        'feature/a': [staticEntry('status'), staticEntry('history')],
      },
    })
    const detail = getSelectedRepoWorkspacePresentation(repo)

    const { container } = renderInJsdom(
      <TerminalSessionReadContext.Provider value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext.Provider value={defaultBranchActionSurface()}>
          <RepoWorkspaceContentHarness repo={repo} detail={detail} workspacePaneId="workspace" />
        </BranchActionSurfaceContext.Provider>
      </TerminalSessionReadContext.Provider>,
    )
    await flushAsyncWork()

    // The selected branch (feature/b) has no explicit tab order, so it
    // falls back to the default [status]. The user's preferred tab
    // (history) is not in the materialized tab list. The model falls
    // back to the first materialized tab (status) so the user does not
    // land on the empty pane. The store keeps the original preferred
    // tab (history) so opening history later returns to it.
    expect(container.querySelector('#workspace-status-panel')).not.toBeNull()
    expect(container.querySelector('#workspace-history-panel')).toBeNull()
    expect(container.textContent).not.toContain('workspace-pane-tabs.empty')
    expect(repoClientMocks.getRepoLog).not.toHaveBeenCalled()
  })

  test('renders branch history as a linear commit graph', async () => {
    repoClientMocks.getRepoLog.mockResolvedValue([
      {
        hash: '78c150a000000000000000000000000000000000',
        shortHash: '78c150a',
        refs: 'HEAD -> fix/w-tab, origin/main, origin/fix/w-tab, origin/HEAD, main',
        message: 'Fix branch navigator name truncation',
        author: 'Example Author',
        date: '2026-06-21T00:00:00.000Z',
      },
      {
        hash: '1111111000000000000000000000000000000000',
        shortHash: '1111111',
        refs: '',
        message: 'Start history graph',
        author: 'Example Author',
        date: '2026-06-20T00:00:00.000Z',
      },
    ])
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/history')],
      selectedBranch: 'feature/history',
      preferredWorkspacePaneTab: 'history',
      workspacePaneTabOrderByBranch: { 'feature/history': [staticEntry('status'), staticEntry('history')] },
    })
    const detail = getSelectedRepoWorkspacePresentation(repo)

    const { container } = renderInJsdom(
      <TerminalSessionReadContext.Provider value={emptyTerminalReadContext}>
        <RepoWorkspaceContentHarness repo={repo} detail={detail} workspacePaneId="workspace" />
      </TerminalSessionReadContext.Provider>,
    )
    await flushAsyncWork()
    await flushAsyncWork()

    expect(repoClientMocks.getRepoLog).toHaveBeenCalledWith(
      REPO_ID,
      'feature/history',
      expect.objectContaining({ count: 50 }),
    )
    const graph = container.querySelector('[data-history-commit-graph=""]')
    expect(graph).not.toBeNull()
    const rows = Array.from(container.querySelectorAll('[data-history-commit-row=""]'))
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('78c150a')
    expect(rows[0]?.textContent).toContain('Fix branch navigator name truncation')
    const headRef = rows[0]?.querySelector('[data-history-log-ref-token="HEAD -> fix/w-tab"]')
    expect(headRef).not.toBeNull()
    expect(headRef?.getAttribute('data-history-log-ref-remotes')).toBe('origin')
    const mainRef = rows[0]?.querySelector('[data-history-log-ref-token="main"]')
    expect(mainRef).not.toBeNull()
    expect(mainRef?.getAttribute('data-history-log-ref-remotes')).toBe('origin')
    const hashButton = rows[0]?.querySelector('[data-history-log-hash=""]') as HTMLButtonElement | null
    await act(async () => {
      hashButton?.click()
    })
    expect(repoClientMocks.openRepoUrl).toHaveBeenCalledWith(REPO_ID, {
      type: 'commit',
      hash: '78c150a000000000000000000000000000000000',
    })
    expect(rows[1]?.textContent).toContain('1111111')
    expect(rows[1]?.textContent).toContain('Start history graph')
  })

  test('labels worktree history panels with the branch-owned tab id', async () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/history', { worktree: { path: '/tmp/history-worktree' } })],
      selectedBranch: 'feature/history',
      preferredWorkspacePaneTab: 'history',
      workspacePaneTabOrderByBranch: { 'feature/history': [staticEntry('status'), staticEntry('history')] },
    })
    const detail = getSelectedRepoWorkspacePresentation(repo)

    const { container } = renderInJsdom(
      <TerminalSessionReadContext.Provider value={emptyTerminalReadContext}>
        <RepoWorkspaceContentHarness repo={repo} detail={detail} workspacePaneId="workspace" />
      </TerminalSessionReadContext.Provider>,
    )
    await flushAsyncWork()

    expect(container.querySelector('#workspace-history-panel')?.getAttribute('aria-labelledby')).toBe(
      'workspace-history-tab',
    )
  })

  test('shows an error state when branch history cannot be read', async () => {
    repoClientMocks.getRepoLog.mockRejectedValue(new Error('error.failed-read-repo'))
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/history')],
      selectedBranch: 'feature/history',
      preferredWorkspacePaneTab: 'history',
      workspacePaneTabOrderByBranch: { 'feature/history': [staticEntry('history')] },
    })
    const detail = getSelectedRepoWorkspacePresentation(repo)

    const { container } = renderInJsdom(
      <TerminalSessionReadContext.Provider value={emptyTerminalReadContext}>
        <RepoWorkspaceContentHarness repo={repo} detail={detail} workspacePaneId="workspace" />
      </TerminalSessionReadContext.Provider>,
    )
    await flushAsyncWork()

    expect(container.textContent).toContain('error.failed-read-repo')
    expect(container.textContent).not.toContain('log.empty-for-branch')
  })
})

const emptyWorktreeSnapshot: TerminalWorktreeSnapshot = {
  terminalWorktreeKey: '',
  selectedDescriptor: null,
  sessions: [],
  count: 0,
  bellCount: 0,
  activeCount: 0,
  pendingCreate: false,
}

const emptyTerminalReadContext: TerminalSessionReadContextValue = {
  terminalWorktreeSnapshot: () => emptyWorktreeSnapshot,
  subscribeTerminalWorktree: () => () => {},
  repoBellCount: () => 0,
  subscribeRepoBellCount: () => () => {},
  snapshot: () => ({ phase: 'opening', message: null, processName: 'terminal' }),
  subscribeSnapshot: () => () => {},
}

function terminalCommandContextWith(overrides: Partial<TerminalSessionContextValue> = {}): TerminalSessionContextValue {
  return {
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
    serialize: vi.fn(() => ''),
    ...overrides,
  }
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve()
  })
}

function staticEntry(type: WorkspacePaneStaticTabType) {
  return workspacePaneStaticTabOrderEntry(type)
}

function terminalEntry(id: string) {
  return workspacePaneTerminalTabOrderEntry(id)
}

function navigationWith(overrides: Partial<PrimaryWindowNavigationActions>): PrimaryWindowNavigationActions {
  return {
    activateRepo: () => {},
    closeRepo: () => {},
    cycleRepo: () => {},
    selectRepoBranch: () => {},
    showRepoWorkspacePaneTab: () => {},
    showRepoBranchWorkspacePaneTab: () => {},
    openSettings: () => {},
    ...overrides,
  }
}

function terminalSession(
  terminalSessionId: string,
  index: number,
  selected: boolean,
  terminalWorktreeKey: string,
): TerminalSessionSummary {
  return {
    type: 'terminal',
    terminalSessionId,
    terminalWorktreeKey,
    index,
    title: terminalSessionId,
    phase: 'open',
    selected,
    hasBell: false,
    recentlyActive: false,
  }
}
