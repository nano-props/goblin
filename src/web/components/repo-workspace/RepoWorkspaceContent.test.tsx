// @vitest-environment jsdom

import type { ComponentProps } from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RepoWorkspaceContent } from '#/web/components/repo-workspace/RepoWorkspaceContent.tsx'
import { BranchActionSurfaceContext } from '#/web/components/repo-workspace/branch-action-surface-context.ts'
import { getCurrentRepoWorkspacePresentation, type RepoWorkspaceRepo } from '#/web/components/repo-workspace/model.ts'
import { useRepoWorkspaceTabModel } from '#/web/components/repo-workspace/use-repo-workspace-tab-model.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import type { BranchCopyPatchAction } from '#/web/hooks/branch-action-state.ts'
import {
  TerminalSessionContext,
  TerminalSessionReadContext,
  useTerminalSessionReadContext,
} from '#/web/components/terminal/terminal-session-context.ts'
import type {
  TerminalSessionContextValue,
  TerminalSessionSummary,
  TerminalSessionReadContextValue,
  TerminalWorktreeSnapshot,
} from '#/web/components/terminal/types.ts'
import {
  createBranchSnapshot,
  createRepoBranch,
  installWorkspacePaneTabsTestBridge,
  resetReposStore,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { tabOpenerScopeKey } from '#/web/stores/repos/tab-opener.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import type { WorkspacePaneStaticTabType, WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import {
  isWorkspacePaneStaticTabType,
  workspacePaneStaticTabEntry,
  workspacePaneRuntimeTabEntry,
} from '#/shared/workspace-pane.ts'
import type { RepoBranchWorkspacePaneRoute } from '#/web/App.tsx'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/repos/workspace-pane-preferences.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import {
  PrimaryWindowNavigationProvider,
  type PrimaryWindowNavigationActions,
} from '#/web/primary-window-navigation.tsx'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import type { RepoState } from '#/web/stores/repos/types.ts'

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
  return (
    <QueryClientProvider client={primaryWindowQueryClient}>
      <RepoWorkspaceContentInner {...props} />
    </QueryClientProvider>
  )
}

function RepoWorkspaceContentInner(props: RepoWorkspaceContentHarnessProps) {
  const workspacePaneRoute = useHarnessWorkspacePaneRoute(props)
  const workspacePaneTabModel = useRepoWorkspaceTabModel(props.repo, props.detail, workspacePaneRoute)
  return <RepoWorkspaceContent {...props} workspacePaneTabModel={workspacePaneTabModel} />
}

function useHarnessWorkspacePaneRoute(props: RepoWorkspaceContentHarnessProps): RepoBranchWorkspacePaneRoute | null {
  const branch = props.detail.branch
  const preferredTab = preferredWorkspacePaneTabForTarget(
    props.repo.ui,
    branch ? { repoRoot: props.repo.id, branchName: branch.name, worktreePath: branch.worktree?.path ?? null } : null,
  )
  const readContext = useTerminalSessionReadContext()
  if (preferredTab === 'terminal') {
    const terminalWorktreeKey = branch?.worktree?.path
      ? formatTerminalWorktreeKey(props.repo.id, branch.worktree.path)
      : null
    const terminalWorktreeSnapshot = terminalWorktreeKey
      ? readContext.terminalWorktreeSnapshot(terminalWorktreeKey)
      : null
    return {
      kind: 'terminal',
      terminalSessionId:
        terminalWorktreeSnapshot?.selectedDescriptor?.terminalSessionId ??
        terminalWorktreeSnapshot?.sessions.find((session) => session.selected)?.terminalSessionId ??
        terminalWorktreeSnapshot?.sessions[0]?.terminalSessionId ??
        'pending-terminal',
    }
  }
  return workspacePaneRouteForStaticPreferredTab(preferredTab)
}

function workspacePaneRouteForStaticPreferredTab(tab: WorkspacePaneTabType): RepoBranchWorkspacePaneRoute | null {
  return isWorkspacePaneStaticTabType(tab) ? { kind: 'static', tab } : null
}

function repoWorkspaceRepo(repo: RepoState): RepoWorkspaceRepo {
  const branchModel = readRepoBranchQueryProjection(repo)
  if (!branchModel) throw new Error('missing branch read model')
  return {
    ...repo,
    ui: { ...repo.ui, currentBranchName: branchModel.branches[0]?.name ?? null },
    branchAction: repo.operations.branchAction,
    branchModel: { ...branchModel, statusReady: true },
  }
}

beforeEach(() => {
  resetReposStore()
  installWorkspacePaneTabsTestBridge()
  useTerminalProjectionHydrationStore.setState({ hydrationByRepo: new Map(), refreshedAtByRepo: new Map() })
  repoClientMocks.getRepoLog.mockResolvedValue([])
  repoClientMocks.openRepoUrl.mockResolvedValue({ ok: true, message: '' })
  filetreeClientMocks.getRepositoryTree.mockResolvedValue({ nodes: [], truncated: false })
  filetreeClientMocks.getRepositoryFileViewer.mockResolvedValue({ viewer: 'bat', shell: 'posix' })
})

afterEach(() => {
  setClientBridgeForTests(null)
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
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/changes', {
          worktree: { path: worktreePath, summary: { dirty: true, changeCount: 4 } },
        }),
      ],
      currentBranchName: 'feature/changes',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/changes': [staticEntry('status'), staticEntry('changes')],
      },
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
    const detail = getCurrentRepoWorkspacePresentation(repoWorkspaceRepo(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext
          value={branchActionSurfaceWithCopyPatch({
            label: 'status.copy-patch',
            title: 'status.copy-patch-title',
            disabled: false,
            visible: true,
            onSelect: onCopyPatch,
          })}
        >
          <RepoWorkspaceContentHarness repo={repoWorkspaceRepo(repo)} detail={detail} workspacePaneId="workspace" />
        </BranchActionSurfaceContext>
      </TerminalSessionReadContext>,
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
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/copy-success', {
          worktree: { path: worktreePath, summary: { dirty: true, changeCount: 1 } },
        }),
      ],
      currentBranchName: 'feature/copy-success',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/copy-success': [staticEntry('status')],
      },
      status: [
        {
          path: worktreePath,
          branch: 'feature/copy-success',
          isMain: false,
          entries: [{ x: 'M', y: ' ', path: 'src/example.ts' }],
        },
      ],
    })
    const detail = getCurrentRepoWorkspacePresentation(repoWorkspaceRepo(repo))
    const onCopyPatch = vi.fn().mockResolvedValue(true)

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext
          value={branchActionSurfaceWithCopyPatch({
            label: 'status.copy-patch',
            title: 'status.copy-patch-title',
            disabled: false,
            visible: true,
            onSelect: onCopyPatch,
          })}
        >
          <RepoWorkspaceContentHarness repo={repoWorkspaceRepo(repo)} detail={detail} workspacePaneId="workspace" />
        </BranchActionSurfaceContext>
      </TerminalSessionReadContext>,
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
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/clean', {
          worktree: { path: worktreePath, summary: { dirty: false, changeCount: 0 } },
        }),
      ],
      currentBranchName: 'feature/clean',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/clean': [staticEntry('status')],
      },
      status: [{ path: worktreePath, branch: 'feature/clean', isMain: false, entries: [] }],
    })
    const detail = getCurrentRepoWorkspacePresentation(repoWorkspaceRepo(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext
          value={branchActionSurfaceWithCopyPatch({
            label: 'status.copy-patch',
            title: 'status.copy-patch-title',
            disabled: false,
            visible: true,
            onSelect: vi.fn(),
          })}
        >
          <RepoWorkspaceContentHarness repo={repoWorkspaceRepo(repo)} detail={detail} workspacePaneId="workspace" />
        </BranchActionSurfaceContext>
      </TerminalSessionReadContext>,
    )

    expect(container.querySelector('#workspace-status-panel')).not.toBeNull()
    expect(container.textContent).not.toContain('branch-status.changes-count')
    expect(container.textContent).not.toContain('branch-status.signal.changes')
    expect(container.querySelector('button[aria-label="status.copy-patch-title"]')).toBeNull()
  })

  test('opens files and changes tabs from the status rows', async () => {
    const worktreePath = '/tmp/status-links-worktree'
    const showRepoBranchWorkspacePaneTab = vi.fn()
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/status-links', {
          worktree: { path: worktreePath, summary: { dirty: true, changeCount: 18 } },
        }),
      ],
      currentBranchName: 'feature/status-links',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/status-links': [staticEntry('status'), staticEntry('changes'), staticEntry('files')],
      },
      status: [
        {
          path: worktreePath,
          branch: 'feature/status-links',
          isMain: false,
          entries: Array.from({ length: 18 }, (_, index) => ({ x: 'M', y: ' ', path: `src/file-${index}.ts` })),
        },
      ],
    })
    const detail = getCurrentRepoWorkspacePresentation(repoWorkspaceRepo(repo))

    const { container } = renderInJsdom(
      <PrimaryWindowNavigationProvider value={navigationWith({ showRepoBranchWorkspacePaneTab })}>
        <TerminalSessionReadContext value={emptyTerminalReadContext}>
          <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
            <RepoWorkspaceContentHarness repo={repoWorkspaceRepo(repo)} detail={detail} workspacePaneId="workspace" />
          </BranchActionSurfaceContext>
        </TerminalSessionReadContext>
      </PrimaryWindowNavigationProvider>,
    )

    const pathButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === worktreePath,
    )
    const changesButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      (button.textContent ?? '').includes('branch-status.changes-count'),
    )

    expect(pathButton).not.toBeNull()
    expect(changesButton).not.toBeNull()

    await act(async () => {
      pathButton?.click()
      await Promise.resolve()
    })
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/status-links', 'files')

    showRepoBranchWorkspacePaneTab.mockClear()

    await act(async () => {
      changesButton?.click()
      await Promise.resolve()
    })
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/status-links', 'changes')
  })

  test('opens upstream refs and commit hashes from the status rows', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/open-links', {
          tracking: 'origin/team/main',
          lastCommitHash: 'ecff955e65e045ee673dc730c06a9a7350d8a558',
          lastCommitShortHash: 'ecff955',
          lastCommitMessage: 'Unify repo status link actions',
        }),
      ],
      currentBranchName: 'feature/open-links',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/open-links': [staticEntry('status')],
      },
      remote: {
        remotes: ['origin', 'origin/team'],
        hasRemotes: true,
        hasBrowserRemote: true,
        browserRemoteProvider: 'github',
        remoteProviders: { origin: 'github', 'origin/team': 'gitlab' },
        hasGitHubRemote: true,
      },
    })
    const detail = getCurrentRepoWorkspacePresentation(repoWorkspaceRepo(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
          <RepoWorkspaceContentHarness repo={repoWorkspaceRepo(repo)} detail={detail} workspacePaneId="workspace" />
        </BranchActionSurfaceContext>
      </TerminalSessionReadContext>,
    )

    const upstreamButton = container.querySelector<HTMLButtonElement>('[data-upstream-link=""]')
    const commitButton = container.querySelector<HTMLButtonElement>('[data-commit-link=""]')

    expect(upstreamButton).not.toBeNull()
    expect(commitButton).not.toBeNull()

    await act(async () => {
      upstreamButton?.click()
      await Promise.resolve()
    })
    expect(repoClientMocks.openRepoUrl).toHaveBeenCalledWith(REPO_ID, {
      type: 'branch',
      branch: 'main',
      remote: 'origin/team',
    })

    repoClientMocks.openRepoUrl.mockClear()

    await act(async () => {
      commitButton?.click()
      await Promise.resolve()
    })
    expect(repoClientMocks.openRepoUrl).toHaveBeenCalledWith(REPO_ID, {
      type: 'commit',
      hash: 'ecff955e65e045ee673dc730c06a9a7350d8a558',
    })
  })

  test('hides the copy patch button on the changes row when copyPatchAction.visible is false', () => {
    const worktreePath = '/tmp/visibility-worktree'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/hidden', {
          worktree: { path: worktreePath, summary: { dirty: true, changeCount: 1 } },
        }),
      ],
      currentBranchName: 'feature/hidden',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/hidden': [staticEntry('status')],
      },
      status: [
        {
          path: worktreePath,
          branch: 'feature/hidden',
          isMain: false,
          entries: [{ x: 'M', y: ' ', path: 'src/example.ts' }],
        },
      ],
    })
    const detail = getCurrentRepoWorkspacePresentation(repoWorkspaceRepo(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext
          value={branchActionSurfaceWithCopyPatch({
            label: 'status.copy-patch',
            title: 'status.copy-patch-title',
            disabled: false,
            visible: false,
            onSelect: vi.fn(),
          })}
        >
          <RepoWorkspaceContentHarness repo={repoWorkspaceRepo(repo)} detail={detail} workspacePaneId="workspace" />
        </BranchActionSurfaceContext>
      </TerminalSessionReadContext>,
    )

    expect(container.textContent).toContain('branch-status.changes-count')
    expect(container.querySelector('button[aria-label="status.copy-patch-title"]')).toBeNull()
  })

  test('renders the changes panel with status entries and tab labelling', () => {
    const worktreePath = '/tmp/changes-panel-worktree'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/changes-panel', {
          worktree: { path: worktreePath, summary: { dirty: true, changeCount: 2 } },
        }),
      ],
      currentBranchName: 'feature/changes-panel',
      preferredWorkspacePaneTab: 'changes',
      workspacePaneTabsByBranch: {
        'feature/changes-panel': [staticEntry('status'), staticEntry('changes')],
      },
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
    const detail = getCurrentRepoWorkspacePresentation(repoWorkspaceRepo(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
          <RepoWorkspaceContentHarness repo={repoWorkspaceRepo(repo)} detail={detail} workspacePaneId="workspace" />
        </BranchActionSurfaceContext>
      </TerminalSessionReadContext>,
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
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [
        createRepoBranch('feature/no-worktree', {
          tracking: 'origin/feature/no-worktree',
          lastCommitHash: 'abc1234000000000000000000000000000000000',
          lastCommitShortHash: 'abc1234',
          lastCommitMessage: 'Update placeholder branch',
          lastCommitAuthor: 'Example Author',
          lastCommitDate: '2026-01-01T00:00:00.000Z',
        }),
      ],
      currentBranchName: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'status',
    })
    const detail = getCurrentRepoWorkspacePresentation(repoWorkspaceRepo(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
          <RepoWorkspaceContentHarness repo={repoWorkspaceRepo(repo)} detail={detail} workspacePaneId="workspace" />
        </BranchActionSurfaceContext>
      </TerminalSessionReadContext>,
    )

    expect(container.querySelector('#workspace-status-panel')).not.toBeNull()
    expect(container.textContent).toContain('feature/no-worktree')
    expect(container.textContent).toContain('branch-status.worktree.none')
    expect(container.textContent).not.toContain('workspace-pane-tabs.empty')
  })

  test('shows the workspace empty state when the status tab is closed', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [
        createRepoBranch('feature/no-worktree', {
          tracking: 'origin/feature/no-worktree',
          lastCommitHash: 'abc1234000000000000000000000000000000000',
          lastCommitShortHash: 'abc1234',
          lastCommitMessage: 'Update placeholder branch',
          lastCommitAuthor: 'Example Author',
          lastCommitDate: '2026-01-01T00:00:00.000Z',
        }),
      ],
      currentBranchName: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: { 'feature/no-worktree': [] },
    })
    const detail = getCurrentRepoWorkspacePresentation(repoWorkspaceRepo(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <RepoWorkspaceContentHarness repo={repoWorkspaceRepo(repo)} detail={detail} workspacePaneId="workspace" />
      </TerminalSessionReadContext>,
    )

    expect(container.querySelector('#workspace-status-panel')).toBeNull()
    expect(container.textContent).toContain('workspace-pane-tabs.empty')
  })

  test('falls back to status when a worktree-scoped preference is unrenderable on a branch without a worktree', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      currentBranchName: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/no-worktree': [staticEntry('status')] },
    })
    const detail = getCurrentRepoWorkspacePresentation(repoWorkspaceRepo(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
          <RepoWorkspaceContentHarness repo={repoWorkspaceRepo(repo)} detail={detail} workspacePaneId="workspace" />
        </BranchActionSurfaceContext>
      </TerminalSessionReadContext>,
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
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/terminal-empty', { worktree: { path: worktreePath } })],
      currentBranchName: 'feature/terminal-empty',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/terminal-empty': [staticEntry('status')] },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.instanceId)
    const detail = getCurrentRepoWorkspacePresentation(repoWorkspaceRepo(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
          <RepoWorkspaceContentHarness repo={repoWorkspaceRepo(repo)} detail={detail} workspacePaneId="workspace" />
        </BranchActionSurfaceContext>
      </TerminalSessionReadContext>,
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
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/terminal-pending', { worktree: { path: worktreePath } })],
      currentBranchName: 'feature/terminal-pending',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/terminal-pending': [staticEntry('status')] },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.instanceId)
    const detail = getCurrentRepoWorkspacePresentation(repoWorkspaceRepo(repo))
    const registerHost = vi.fn()
    const terminalWorktreeSnapshot: TerminalWorktreeSnapshot = {
      ...emptyWorktreeSnapshot,
      terminalWorktreeKey,
      createPending: true,
    }
    const readContext: TerminalSessionReadContextValue = {
      ...emptyTerminalReadContext,
      terminalWorktreeSnapshot: () => terminalWorktreeSnapshot,
    }

    const { container } = renderInJsdom(
      <TerminalSessionContext value={terminalCommandContextWith({ registerHost })}>
        <TerminalSessionReadContext value={readContext}>
          <RepoWorkspaceContentHarness repo={repoWorkspaceRepo(repo)} detail={detail} workspacePaneId="workspace" />
        </TerminalSessionReadContext>
      </TerminalSessionContext>,
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
    const seededRepo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(branchName, { worktree: { path: worktreePath } })],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { [branchName]: [] },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, seededRepo.instanceId)
    const repo = useReposStore.getState().repos[REPO_ID]!
    const detail = getCurrentRepoWorkspacePresentation(repoWorkspaceRepo(repo))
    const registerHost = vi.fn()
    const terminalWorktreeSnapshot: TerminalWorktreeSnapshot = {
      ...emptyWorktreeSnapshot,
      terminalWorktreeKey,
      createPending: true,
    }
    const readContext: TerminalSessionReadContextValue = {
      ...emptyTerminalReadContext,
      terminalWorktreeSnapshot: () => terminalWorktreeSnapshot,
    }

    renderInJsdom(
      <TerminalSessionContext value={terminalCommandContextWith({ registerHost })}>
        <TerminalSessionReadContext value={readContext}>
          <RepoWorkspaceContentHarness repo={repoWorkspaceRepo(repo)} detail={detail} workspacePaneId="workspace" />
        </TerminalSessionReadContext>
      </TerminalSessionContext>,
    )

    expect(screen.getByRole('tabpanel').id).toBe('workspace-terminal-panel')
    expect(screen.queryByText('workspace-pane-tabs.empty')).toBeNull()
    expect(registerHost).toHaveBeenCalledWith(terminalWorktreeKey, expect.any(HTMLDivElement))
  })

  test('renders terminal loading without a create CTA while initial terminal sync is unresolved', () => {
    const worktreePath = '/tmp/terminal-loading-worktree'
    const terminalWorktreeKey = `${REPO_ID}\0${worktreePath}`
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/terminal-loading', { worktree: { path: worktreePath } })],
      currentBranchName: 'feature/terminal-loading',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/terminal-loading': [staticEntry('status')] },
    })
    const detail = getCurrentRepoWorkspacePresentation(repoWorkspaceRepo(repo))
    const createTerminal = vi.fn(async () => 'session-1')
    const registerHost = vi.fn()
    const terminalWorktreeSnapshot: TerminalWorktreeSnapshot = {
      ...emptyWorktreeSnapshot,
      terminalWorktreeKey,
      createPending: false,
    }
    const readContext: TerminalSessionReadContextValue = {
      ...emptyTerminalReadContext,
      terminalWorktreeSnapshot: () => terminalWorktreeSnapshot,
    }

    const { container } = renderInJsdom(
      <TerminalSessionContext value={terminalCommandContextWith({ createTerminal, registerHost })}>
        <TerminalSessionReadContext value={readContext}>
          <RepoWorkspaceContentHarness repo={repoWorkspaceRepo(repo)} detail={detail} workspacePaneId="workspace" />
        </TerminalSessionReadContext>
      </TerminalSessionContext>,
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

  test('labels terminal panels from the mixed tab list, not runtime session list', () => {
    const worktreePath = '/tmp/terminal-reordered-worktree'
    const terminalWorktreeKey = `${REPO_ID}\0${worktreePath}`
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/terminal-reordered', { worktree: { path: worktreePath } })],
      currentBranchName: 'feature/terminal-reordered',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/terminal-reordered': [terminalEntry('t2'), staticEntry('status'), terminalEntry('t1')],
      },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.instanceId)
    const detail = getCurrentRepoWorkspacePresentation(repoWorkspaceRepo(repo))
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
      <TerminalSessionContext value={terminalCommandContextWith({ registerHost })}>
        <TerminalSessionReadContext value={readContext}>
          <RepoWorkspaceContentHarness repo={repoWorkspaceRepo(repo)} detail={detail} workspacePaneId="workspace" />
        </TerminalSessionReadContext>
      </TerminalSessionContext>,
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
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch(branchName, { worktree: { path: worktreePath } })],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: { [branchName]: [staticEntry('files'), staticEntry('status')] },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.instanceId)
    const detail = getCurrentRepoWorkspacePresentation(repoWorkspaceRepo(repo))
    let resolvedStartupShellCommand: string | null = null
    const createTerminal: TerminalSessionContextValue['createTerminal'] = vi.fn(async (_base, options) => {
      resolvedStartupShellCommand = (await options?.resolveStartupShellCommand?.()) ?? null
      return 'session-1'
    })
    const writeInput = vi.fn()
    const showRepoBranchWorkspacePaneTab = vi.fn()
    const showRepoBranchTerminalSession = vi.fn()
    let resolveViewer!: (value: { viewer: 'bat'; shell: 'posix' }) => void
    filetreeClientMocks.getRepositoryFileViewer.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveViewer = resolve
        }),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    renderInJsdom(
      <QueryClientProvider client={queryClient}>
        <PrimaryWindowNavigationProvider
          value={navigationWith({ showRepoBranchWorkspacePaneTab, showRepoBranchTerminalSession })}
        >
          <TerminalSessionContext value={terminalCommandContextWith({ createTerminal, writeInput })}>
            <TerminalSessionReadContext value={emptyTerminalReadContext}>
              <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
                <RepoWorkspaceContentHarness
                  repo={repoWorkspaceRepo(repo)}
                  detail={detail}
                  workspacePaneId="workspace"
                />
              </BranchActionSurfaceContext>
            </TerminalSessionReadContext>
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    const row = await screen.findByRole('treeitem', { name: 'README.md' })
    await act(async () => {
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      await Promise.resolve()
    })
    const actionButton = row.querySelector<HTMLButtonElement>('[data-action-popover-trigger]')
    expect(actionButton?.getAttribute('aria-busy')).toBe('true')
    expect(actionButton?.querySelector('svg.animate-spin')).toBeTruthy()
    expect(createTerminal).toHaveBeenCalledTimes(1)
    await act(async () => {
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      await Promise.resolve()
    })
    expect(filetreeClientMocks.getRepositoryFileViewer).toHaveBeenCalledTimes(1)
    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/changes', 'status')
    await act(async () => {
      resolveViewer({ viewer: 'bat', shell: 'posix' })
      await Promise.resolve()
    })

    expect(showRepoBranchTerminalSession).toHaveBeenCalledWith(REPO_ID, 'feature/filetree-open', 'session-1')
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
    expect(createTerminal).toHaveBeenCalledWith(
      { repoRoot: REPO_ID, repoInstanceId: repo.instanceId, branch: branchName, worktreePath },
      {
        resolveStartupShellCommand: expect.any(Function),
        insertAfterIdentity: 'workspace-pane:files',
      },
    )
    expect(resolvedStartupShellCommand).toBe(
      "bat --paging=never --style=plain '/tmp/filetree-open-worktree/README.md'\r",
    )
    expect(writeInput).not.toHaveBeenCalled()

    // Chrome-tab-style opener tracking: the terminal this opened should be
    // attributed to "files" (the only tab open, and active, when the file
    // was double-clicked), scoped to this branch.
    expect(
      useReposStore.getState().tabOpenerIdentityByScope[tabOpenerScopeKey(REPO_ID, branchName)]?.['terminal:session-1'],
    ).toBe('workspace-pane:files')
  })

  test('falls back to status when a branch preference names a closed tab', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/a'), createRepoBranch('feature/b')],
      currentBranchName: 'feature/b',
      preferredWorkspacePaneTab: 'history',
      workspacePaneTabsByBranch: {
        'feature/a': [staticEntry('status'), staticEntry('history')],
      },
    })
    const detail = getCurrentRepoWorkspacePresentation(repoWorkspaceRepo(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
          <RepoWorkspaceContentHarness repo={repoWorkspaceRepo(repo)} detail={detail} workspacePaneId="workspace" />
        </BranchActionSurfaceContext>
      </TerminalSessionReadContext>,
    )
    await flushAsyncWork()

    // The selected branch (feature/b) has no explicit mixed tab list, so it
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
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/history')],
      currentBranchName: 'feature/history',
      preferredWorkspacePaneTab: 'history',
      workspacePaneTabsByBranch: { 'feature/history': [staticEntry('status'), staticEntry('history')] },
    })
    const detail = getCurrentRepoWorkspacePresentation(repoWorkspaceRepo(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <RepoWorkspaceContentHarness repo={repoWorkspaceRepo(repo)} detail={detail} workspacePaneId="workspace" />
      </TerminalSessionReadContext>,
    )
    await flushAsyncWork()
    await flushAsyncWork()

    expect(repoClientMocks.getRepoLog).toHaveBeenCalledWith(
      REPO_ID,
      'feature/history',
      expect.objectContaining({ count: 50 }),
    )
    await waitFor(() => {
      expect(container.querySelector('[data-history-commit-graph=""]')).not.toBeNull()
    })
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

  test('labels worktree history panels with the static tab id', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/history', { worktree: { path: '/tmp/history-worktree' } })],
      currentBranchName: 'feature/history',
      preferredWorkspacePaneTab: 'history',
      workspacePaneTabsByBranch: { 'feature/history': [staticEntry('status'), staticEntry('history')] },
    })
    const detail = getCurrentRepoWorkspacePresentation(repoWorkspaceRepo(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <RepoWorkspaceContentHarness repo={repoWorkspaceRepo(repo)} detail={detail} workspacePaneId="workspace" />
      </TerminalSessionReadContext>,
    )
    await flushAsyncWork()

    expect(container.querySelector('#workspace-history-panel')?.getAttribute('aria-labelledby')).toBe(
      'workspace-history-tab',
    )
  })

  test('shows an error state when branch history cannot be read', async () => {
    repoClientMocks.getRepoLog.mockRejectedValue(new Error('error.failed-read-repo'))
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/history')],
      currentBranchName: 'feature/history',
      preferredWorkspacePaneTab: 'history',
      workspacePaneTabsByBranch: { 'feature/history': [staticEntry('history')] },
    })
    const detail = getCurrentRepoWorkspacePresentation(repoWorkspaceRepo(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <RepoWorkspaceContentHarness repo={repoWorkspaceRepo(repo)} detail={detail} workspacePaneId="workspace" />
      </TerminalSessionReadContext>,
    )
    await flushAsyncWork()

    await waitFor(() => {
      expect(container.textContent).toContain('error.failed-read-repo')
    })
    expect(container.textContent).not.toContain('log.empty-for-branch')
  })
})

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

const emptyTerminalReadContext: TerminalSessionReadContextValue = {
  terminalWorktreeSnapshot: () => emptyWorktreeSnapshot,
  subscribeTerminalWorktree: () => () => {},
  repoBellCount: () => 0,
  subscribeRepoBellCount: () => () => {},
  snapshot: () => emptyTerminalSnapshot,
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
    ...overrides,
  }
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve()
  })
}

function staticEntry(type: WorkspacePaneStaticTabType) {
  return workspacePaneStaticTabEntry(type)
}

function terminalEntry(id: string) {
  return workspacePaneRuntimeTabEntry('terminal', id)
}

function navigationWith(overrides: Partial<PrimaryWindowNavigationActions>): PrimaryWindowNavigationActions {
  return {
    activateRepo: () => {},
    closeRepo: () => {},
    cycleRepo: () => {},
    selectRepoBranch: () => {},
    showRepoBranchWorkspacePaneTab: () => {},
    showRepoBranchTerminalSession: () => {},
    goBack: () => {},
    goForward: () => {},
    openSettings: () => {},
    openCreateWorktree: () => {},
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
    hasRecentOutput: false,
  }
}
