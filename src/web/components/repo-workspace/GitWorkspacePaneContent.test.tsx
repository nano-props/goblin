// @vitest-environment jsdom

import type { ComponentProps } from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
import { GitWorkspacePaneContent } from '#/web/components/repo-workspace/GitWorkspacePaneContent.tsx'
import { FiletreeTab } from '#/web/components/repo-workspace/panels.tsx'
import { BranchActionSurfaceContext } from '#/web/components/repo-workspace/branch-action-surface-context.ts'
import {
  getCurrentGitWorkspacePanePresentation as buildGitWorkspacePanePresentation,
  type GitWorkspacePaneProjection,
} from '#/web/components/repo-workspace/model.ts'
import { useGitWorkspacePaneTabModel } from '#/web/workspace-pane/use-workspace-pane-tab-model.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import type { BranchCopyPatchAction } from '#/web/hooks/branch-action-state.ts'
import {
  TerminalSessionContext,
  TerminalSessionReadContext,
  useTerminalSessionReadContext,
  EMPTY_TERMINAL_SNAPSHOT,
  EMPTY_TERMINAL_WORKTREE_SNAPSHOT,
} from '#/web/components/terminal/terminal-session-context.ts'
import type {
  TerminalSessionContextValue,
  TerminalSessionSummary,
  TerminalSessionReadContextValue,
  TerminalWorktreeSnapshot,
} from '#/web/components/terminal/types.ts'
import {
  createBranchSnapshot,
  installWorkspacePaneTabsTestBridge,
  resetWorkspacesStore,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import type { WorkspacePaneStaticTabType, WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import {
  isWorkspacePaneStaticTabType,
  workspacePaneStaticTabEntry,
  workspacePaneRuntimeTabEntry,
} from '#/shared/workspace-pane.ts'
import type { WorkspacePaneRoute } from '#/web/App.tsx'
import { observedWorkspacePaneRouteCommitForTest } from '#/web/test-utils/workspace-pane-navigation.ts'
import { observeWorkspacePaneRouteForTest } from '#/web/test-utils/workspace-pane-navigation.ts'
import { formatTerminalWorktreeKeyForPath } from '#/shared/terminal-worktree-key.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import {
  workspacePanePreferenceTargetOptions,
  workspacePaneTabTargetForBranch,
} from '#/web/workspace-pane/workspace-pane-tab-target.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { terminalSessionContextForTest } from '#/web/test-utils/terminal-session-context.ts'
import {
  PrimaryWindowNavigationProvider,
  type PrimaryWindowNavigationActions,
} from '#/web/primary-window-navigation.tsx'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import type { WorkspaceState } from '#/web/stores/workspaces/types.ts'
import { runCloseWorkspacePaneTabCommand } from '#/web/commands/workspace-commands.ts'

let workspacePaneTabsTestBridge: ReturnType<typeof installWorkspacePaneTabsTestBridge>
import { workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'

const repoClientMocks = vi.hoisted(() => ({
  getRepoLog: vi.fn(),
  openRepoUrl: vi.fn(),
}))
const filetreeClientMocks = vi.hoisted(() => ({
  getRepositoryTree: vi.fn(),
  getRepositoryFileViewer: vi.fn(),
}))
const responsiveMocks = vi.hoisted(() => ({ compact: false }))
vi.mock('#/web/hooks/useResponsiveUiMode.tsx', () => ({
  useIsCompactUi: () => responsiveMocks.compact,
}))
vi.mock('#/web/repo-client.ts', () => ({
  getRepoLog: repoClientMocks.getRepoLog,
  openRepoUrl: repoClientMocks.openRepoUrl,
}))
vi.mock('#/web/filetree-client.ts', () => ({
  getRepositoryTree: filetreeClientMocks.getRepositoryTree,
  getRepositoryFileViewer: filetreeClientMocks.getRepositoryFileViewer,
}))
const REPO_ID = workspaceIdForTest('goblin+file:///tmp/goblin-repo-workspace-content-repo')

type GitWorkspacePaneContentHarnessProps = Omit<
  ComponentProps<typeof GitWorkspacePaneContent>,
  'workspacePaneTabModel'
> & {
  workspacePaneRouteMode?: 'preference-route' | 'bare-branch'
}

function GitWorkspacePaneContentHarness(props: GitWorkspacePaneContentHarnessProps) {
  return (
    <QueryClientProvider client={primaryWindowQueryClient}>
      <GitWorkspacePaneContentInner {...props} />
    </QueryClientProvider>
  )
}

function GitWorkspacePaneContentInner(props: GitWorkspacePaneContentHarnessProps) {
  const { workspacePaneRouteMode, ...contentProps } = props
  const workspacePaneRoute = useHarnessWorkspacePaneRoute(props)
  const workspacePaneTabModel = useGitWorkspacePaneTabModel(contentProps.repo, contentProps.detail, workspacePaneRoute)
  return <GitWorkspacePaneContent {...contentProps} workspacePaneTabModel={workspacePaneTabModel} />
}

function useHarnessWorkspacePaneRoute(
  props: GitWorkspacePaneContentHarnessProps,
): WorkspacePaneRoute | null | undefined {
  if (props.workspacePaneRouteMode === 'bare-branch') return undefined
  const branch = props.detail.branch
  const preferredTab = preferredWorkspacePaneTabForTarget(
    props.repo.ui,
    branch
      ? branch.worktree?.path
        ? {
            kind: 'git-worktree' as const,
            workspaceId: props.repo.id,
            worktreePath: branch.worktree.path,
          }
        : { kind: 'git-branch' as const, workspaceId: props.repo.id, branchName: branch.name }
      : null,
  )
  const readContext = useTerminalSessionReadContext()
  if (preferredTab === 'terminal') {
    const terminalWorktreeKey = branch?.worktree?.path
      ? formatTerminalWorktreeKeyForPath(props.repo.id, branch.worktree.path)
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

function workspacePaneRouteForStaticPreferredTab(tab: WorkspacePaneTabType | null): WorkspacePaneRoute | null {
  return isWorkspacePaneStaticTabType(tab) ? { kind: 'static', tab } : null
}

function getTestGitWorkspacePanePresentation(repo: GitWorkspacePaneProjection) {
  return buildGitWorkspacePanePresentation(repo, { loading: false, error: null, stale: false })
}

function gitWorkspacePaneProjection(repo: WorkspaceState): GitWorkspacePaneProjection {
  if (repo.capability.kind !== 'git') throw new Error('expected Git workspace fixture')
  const branchModel = readRepoBranchQueryProjection(repo)
  if (!branchModel) throw new Error('missing branch read model')
  const currentBranchName = branchModel.currentBranch || branchModel.branches[0]?.name || null
  return {
    ...repo,
    ui: { ...repo.ui, currentBranchName },
    branchAction: repo.capability.git.operations.branchAction,
    branchModel,
    unavailable: false,
    probe: repo.capability.probe,
    remote: repo.capability.git.remote,
    remoteLifecycle: repo.admission.kind === 'remote' ? repo.admission.lifecycle : null,
  }
}

function preferenceBackedWorkspacePaneTabModel(repoId: WorkspaceId, branchName: string) {
  const model = workspacePaneTabTargetForBranch(repoId, branchName, workspacePanePreferenceTargetOptions)
  if (!model) throw new Error('missing preference-backed workspace pane tab model')
  return model
}

beforeEach(() => {
  responsiveMocks.compact = false
  primaryWindowQueryClient.clear()
  resetWorkspacesStore()
  workspacePaneTabsTestBridge = installWorkspacePaneTabsTestBridge()
  useTerminalProjectionHydrationStore.setState({ hydrationByWorkspace: new Map(), refreshedAtByWorkspace: new Map() })
  repoClientMocks.getRepoLog.mockResolvedValue([])
  repoClientMocks.openRepoUrl.mockResolvedValue({ ok: true, message: '' })
  filetreeClientMocks.getRepositoryTree.mockResolvedValue({ nodes: [], truncated: false })
  filetreeClientMocks.getRepositoryFileViewer.mockResolvedValue({
    viewer: 'bat',
    shell: 'posix',
    executionRoot: '/tmp/repo',
  })
})

afterEach(() => {
  setClientBridgeForTests(null)
})

describe('GitWorkspacePaneContent', () => {
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

  test('offers a compact return to the branch list when the last routed branch no longer exists', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [],
      currentBranchName: null,
    })
    const existingPresentationRepo = gitWorkspacePaneProjection(repo)
    const presentationRepo = {
      ...existingPresentationRepo,
      ui: { ...existingPresentationRepo.ui, currentBranchName: 'feature/removed' },
    }
    const detail = getTestGitWorkspacePanePresentation(presentationRepo)
    const onBackToBranchNavigator = vi.fn()

    const renderMissingBranch = () =>
      renderInJsdom(
        <TerminalSessionReadContext value={emptyTerminalReadContext}>
          <GitWorkspacePaneContentHarness
            repo={presentationRepo}
            detail={detail}
            workspacePaneId="workspace"
            onBackToBranchNavigator={onBackToBranchNavigator}
          />
        </TerminalSessionReadContext>,
      )

    const desktop = renderMissingBranch()
    expect(screen.queryByRole('button', { name: 'branches.back-to-list' })).toBeNull()
    desktop.unmount()

    responsiveMocks.compact = true
    renderMissingBranch()

    expect(document.body.textContent).toContain('branches.missing')
    expect(document.body.textContent).not.toContain('branches.filter-empty')
    screen.getByRole('button', { name: 'branches.back-to-list' }).click()
    expect(onBackToBranchNavigator).toHaveBeenCalledOnce()
  })

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
    const presentationRepo = gitWorkspacePaneProjection(repo)
    const detail = buildGitWorkspacePanePresentation(presentationRepo, {
      loading: true,
      error: null,
      stale: false,
    })
    const workspacePaneTabModel = preferenceBackedWorkspacePaneTabModel(REPO_ID, 'feature/changes')

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
          <GitWorkspacePaneContent
            repo={presentationRepo}
            detail={detail}
            workspacePaneId="workspace"
            workspacePaneTabModel={workspacePaneTabModel}
          />
        </BranchActionSurfaceContext>
      </TerminalSessionReadContext>,
    )

    expect(container.querySelector('#workspace-status-panel')?.getAttribute('aria-busy')).toBe('true')
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
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))
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
          <GitWorkspacePaneContentHarness
            repo={gitWorkspacePaneProjection(repo)}
            detail={detail}
            workspacePaneId="workspace"
          />
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
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))

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
          <GitWorkspacePaneContentHarness
            repo={gitWorkspacePaneProjection(repo)}
            detail={detail}
            workspacePaneId="workspace"
          />
        </BranchActionSurfaceContext>
      </TerminalSessionReadContext>,
    )

    expect(container.querySelector('#workspace-status-panel')).not.toBeNull()
    expect(container.textContent).not.toContain('branch-status.changes-count')
    expect(container.textContent).not.toContain('branch-status.signal.changes')
    expect(container.querySelector('button[aria-label="status.copy-patch-title"]')).toBeNull()
  })

  test('opens files from the status row as a new tab and returns to status when it closes', async () => {
    const worktreePath = '/tmp/status-links-worktree'
    const showRepoBranchWorkspacePaneTab = vi.fn((repoId, branch, tab) => {
      useWorkspacesStore.getState().setWorkspacePaneTab(repoId, branch, tab)
      return true
    })
    const showRepoBranchEmptyWorkspacePane = vi.fn(() => true)
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
        'feature/status-links': [staticEntry('status'), staticEntry('changes')],
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
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab, showRepoBranchEmptyWorkspacePane })

    const { container } = renderInJsdom(
      <PrimaryWindowNavigationProvider value={navigation}>
        <TerminalSessionReadContext value={emptyTerminalReadContext}>
          <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
            <GitWorkspacePaneContentHarness
              repo={gitWorkspacePaneProjection(repo)}
              detail={detail}
              workspacePaneId="workspace"
            />
          </BranchActionSurfaceContext>
        </TerminalSessionReadContext>
      </PrimaryWindowNavigationProvider>,
    )

    const pathButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === worktreePath,
    )

    expect(pathButton).not.toBeNull()
    observeWorkspacePaneRouteForTest({
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName: 'feature/status-links',
      worktreePath,
      route: { kind: 'static', tab: 'status' },
    })

    await act(async () => {
      pathButton?.click()
      await Promise.resolve()
    })
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/status-links', 'files')
    expect(
      workspacePaneTabOpener(
        {
          kind: 'git-worktree',
          workspaceId: REPO_ID,
          worktreePath,
        },
        repo.workspaceRuntimeId,
        'workspace-pane:files',
      ),
    ).toBe('workspace-pane:status')

    showRepoBranchWorkspacePaneTab.mockClear()
    observeWorkspacePaneRouteForTest({
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName: 'feature/status-links',
      worktreePath,
      route: { kind: 'static', tab: 'files' },
    })

    expect(
      await runCloseWorkspacePaneTabCommand({
        workspaceId: REPO_ID,
        target: {
          kind: 'git-worktree',
          workspacePaneRoute: { kind: 'static', tab: 'files' },
          filesystemTarget: gitWorktreeFilesystemTarget(repo, worktreePath, 'feature/status-links'),
        },
        targetIdentity: 'workspace-pane:files',
        navigation,
      }),
    ).toBe(true)
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/status-links', 'status')
    expect(showRepoBranchEmptyWorkspacePane).not.toHaveBeenCalled()
  })

  test('opens changes from the status row', async () => {
    const worktreePath = '/tmp/status-links-worktree'
    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
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
        'feature/status-links': [staticEntry('status'), staticEntry('changes')],
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
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))

    const { container } = renderInJsdom(
      <PrimaryWindowNavigationProvider value={navigationWith({ showRepoBranchWorkspacePaneTab })}>
        <TerminalSessionReadContext value={emptyTerminalReadContext}>
          <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
            <GitWorkspacePaneContentHarness
              repo={gitWorkspacePaneProjection(repo)}
              detail={detail}
              workspacePaneId="workspace"
            />
          </BranchActionSurfaceContext>
        </TerminalSessionReadContext>
      </PrimaryWindowNavigationProvider>,
    )

    const changesButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      (button.textContent ?? '').includes('branch-status.changes-count'),
    )

    expect(changesButton).not.toBeNull()
    observeWorkspacePaneRouteForTest({
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName: 'feature/status-links',
      worktreePath,
      route: { kind: 'static', tab: 'status' },
    })

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
    const presentationRepo = gitWorkspacePaneProjection(repo)
    const detail = getTestGitWorkspacePanePresentation(presentationRepo)
    const workspacePaneTabModel = preferenceBackedWorkspacePaneTabModel(REPO_ID, 'feature/open-links')

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
          <GitWorkspacePaneContent
            repo={presentationRepo}
            detail={detail}
            workspacePaneId="workspace"
            workspacePaneTabModel={workspacePaneTabModel}
          />
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
    expect(repoClientMocks.openRepoUrl).toHaveBeenCalledWith(REPO_ID, repo.workspaceRuntimeId, {
      type: 'branch',
      branch: 'main',
      remote: 'origin/team',
    })

    repoClientMocks.openRepoUrl.mockClear()

    await act(async () => {
      commitButton?.click()
      await Promise.resolve()
    })
    expect(repoClientMocks.openRepoUrl).toHaveBeenCalledWith(REPO_ID, repo.workspaceRuntimeId, {
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
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))

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
          <GitWorkspacePaneContentHarness
            repo={gitWorkspacePaneProjection(repo)}
            detail={detail}
            workspacePaneId="workspace"
          />
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
    const presentationRepo = gitWorkspacePaneProjection(repo)
    const detail = getTestGitWorkspacePanePresentation(presentationRepo)
    const workspacePaneTabModel = preferenceBackedWorkspacePaneTabModel(REPO_ID, 'feature/changes-panel')

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
          <GitWorkspacePaneContent
            repo={presentationRepo}
            detail={detail}
            workspacePaneId="workspace"
            workspacePaneTabModel={workspacePaneTabModel}
          />
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

  test('keeps stale changes visible and retries status from the query owner callback', () => {
    const worktreePath = '/tmp/stale-changes-panel-worktree'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/stale-changes', {
          worktree: { path: worktreePath, summary: { dirty: true, changeCount: 1 } },
        }),
      ],
      currentBranchName: 'feature/stale-changes',
      preferredWorkspacePaneTab: 'changes',
      workspacePaneTabsByBranch: {
        'feature/stale-changes': [staticEntry('changes')],
      },
      status: [
        {
          path: worktreePath,
          branch: 'feature/stale-changes',
          isMain: false,
          entries: [{ x: 'M', y: ' ', path: 'src/stale.ts' }],
        },
      ],
    })
    const presentationRepo = gitWorkspacePaneProjection(repo)
    const detail = buildGitWorkspacePanePresentation(presentationRepo, {
      loading: false,
      error: 'status failed',
      stale: true,
    })
    const onRetryStatus = vi.fn()

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
          <GitWorkspacePaneContentHarness
            repo={presentationRepo}
            detail={detail}
            workspacePaneId="workspace"
            onRetryStatus={onRetryStatus}
          />
        </BranchActionSurfaceContext>
      </TerminalSessionReadContext>,
    )

    expect(container.textContent).toContain('status.stale-title')
    expect(container.querySelector('[aria-label="src/stale.ts"]')).not.toBeNull()
    act(() => screen.getByRole('button', { name: 'error.try-again' }).click())
    expect(onRetryStatus).toHaveBeenCalledOnce()
  })

  test('renders branch status for a selected branch without a worktree', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/no-worktree', {
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
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
          <GitWorkspacePaneContentHarness
            repo={gitWorkspacePaneProjection(repo)}
            detail={detail}
            workspacePaneId="workspace"
          />
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
      branchSnapshots: [
        createBranchSnapshot('feature/no-worktree', {
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
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <GitWorkspacePaneContentHarness
          repo={gitWorkspacePaneProjection(repo)}
          detail={detail}
          workspacePaneId="workspace"
        />
      </TerminalSessionReadContext>,
    )

    expect(container.querySelector('#workspace-status-panel')).toBeNull()
    expect(container.textContent).toContain('workspace-pane-tabs.empty')
  })

  test('falls back to status when a worktree-scoped preference is unrenderable on a branch without a worktree', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/no-worktree')],
      currentBranchName: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/no-worktree': [staticEntry('status')] },
    })
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
          <GitWorkspacePaneContent
            repo={gitWorkspacePaneProjection(repo)}
            detail={detail}
            workspacePaneId="workspace"
            workspacePaneTabModel={preferenceBackedWorkspacePaneTabModel(REPO_ID, 'feature/no-worktree')}
          />
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

  test('hook falls back to status for a bare-branch stale preferred terminal tab', () => {
    const worktreePath = '/tmp/hook-terminal-empty-worktree'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/hook-terminal-empty', { worktree: { path: worktreePath } })],
      currentBranchName: 'feature/hook-terminal-empty',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/hook-terminal-empty': [staticEntry('status')] },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
          <GitWorkspacePaneContentHarness
            repo={gitWorkspacePaneProjection(repo)}
            detail={detail}
            workspacePaneId="workspace"
            workspacePaneRouteMode="bare-branch"
          />
        </BranchActionSurfaceContext>
      </TerminalSessionReadContext>,
    )

    expect(container.querySelector('#workspace-status-panel')).not.toBeNull()
    expect(container.querySelector('#workspace-terminal-panel')).toBeNull()
    expect(container.textContent).not.toContain('workspace-pane-tabs.empty')
  })

  test('falls back to status when terminal is preferred but sync confirms no terminal tabs', () => {
    const worktreePath = '/tmp/terminal-empty-worktree'
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/terminal-empty', { worktree: { path: worktreePath } })],
      currentBranchName: 'feature/terminal-empty',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/terminal-empty': [staticEntry('status')] },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
          <GitWorkspacePaneContent
            repo={gitWorkspacePaneProjection(repo)}
            detail={detail}
            workspacePaneId="workspace"
            workspacePaneTabModel={preferenceBackedWorkspacePaneTabModel(REPO_ID, 'feature/terminal-empty')}
          />
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
    const terminalWorktreeKey = formatTerminalWorktreeKeyForPath(REPO_ID, worktreePath)
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/terminal-pending', { worktree: { path: worktreePath } })],
      currentBranchName: 'feature/terminal-pending',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/terminal-pending': [staticEntry('status')] },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))
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
          <GitWorkspacePaneContentHarness
            repo={gitWorkspacePaneProjection(repo)}
            detail={detail}
            workspacePaneId="workspace"
          />
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
    const terminalWorktreeKey = formatTerminalWorktreeKeyForPath(REPO_ID, worktreePath)
    const branchName = 'feature/terminal-pending-empty-strip'
    const seededRepo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot(branchName, { worktree: { path: worktreePath } })],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { [branchName]: [] },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, seededRepo.workspaceRuntimeId)
    const repo = useWorkspacesStore.getState().workspaces[REPO_ID]!
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))
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
          <GitWorkspacePaneContentHarness
            repo={gitWorkspacePaneProjection(repo)}
            detail={detail}
            workspacePaneId="workspace"
          />
        </TerminalSessionReadContext>
      </TerminalSessionContext>,
    )

    expect(screen.getByRole('tabpanel').id).toBe('workspace-terminal-panel')
    expect(screen.queryByText('workspace-pane-tabs.empty')).toBeNull()
    expect(registerHost).toHaveBeenCalledWith(terminalWorktreeKey, expect.any(HTMLDivElement))
  })

  test('renders terminal loading without a create CTA while initial terminal sync is unresolved', () => {
    const worktreePath = '/tmp/terminal-loading-worktree'
    const terminalWorktreeKey = formatTerminalWorktreeKeyForPath(REPO_ID, worktreePath)
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/terminal-loading', { worktree: { path: worktreePath } })],
      currentBranchName: 'feature/terminal-loading',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/terminal-loading': [staticEntry('status')] },
    })
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))
    const createTerminal = vi.fn(async () => 'term-111111111111111111111')
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
          <GitWorkspacePaneContentHarness
            repo={gitWorkspacePaneProjection(repo)}
            detail={detail}
            workspacePaneId="workspace"
          />
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
    const terminalWorktreeKey = formatTerminalWorktreeKeyForPath(REPO_ID, worktreePath)
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/terminal-reordered', { worktree: { path: worktreePath } })],
      currentBranchName: 'feature/terminal-reordered',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/terminal-reordered': [
          terminalEntry('term-222222222222222222222'),
          staticEntry('status'),
          terminalEntry('term-111111111111111111111'),
        ],
      },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))
    const registerHost = vi.fn()
    const terminalWorktreeSnapshot: TerminalWorktreeSnapshot = {
      ...emptyWorktreeSnapshot,
      terminalWorktreeKey,
      sessions: [
        terminalSession('term-111111111111111111111', 1, false, terminalWorktreeKey),
        terminalSession('term-222222222222222222222', 2, true, terminalWorktreeKey),
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
          <GitWorkspacePaneContentHarness
            repo={gitWorkspacePaneProjection(repo)}
            detail={detail}
            workspacePaneId="workspace"
          />
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
      branchSnapshots: [createBranchSnapshot(branchName, { worktree: { path: worktreePath } })],
      currentBranchName: branchName,
      preferredWorkspacePaneTab: 'files',
      workspacePaneTabsByBranch: { [branchName]: [staticEntry('files'), staticEntry('status')] },
    })
    useTerminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))
    let resolvedStartupShellCommand: string | null = null
    const createTerminalWithAdmission: TerminalSessionContextValue['createTerminalWithAdmission'] = vi.fn(
      async (_base, options) => {
        resolvedStartupShellCommand = (await options?.resolveStartupShellCommand?.()) ?? null
        workspacePaneTabsTestBridge.addRuntimeTab({
          workspaceId: REPO_ID,
          workspaceRuntimeId: repo.workspaceRuntimeId,
          branchName,
          worktreePath,
          terminalSessionId: 'term-111111111111111111111',
          insertAfterIdentity: 'workspace-pane:files',
        })
        return {
          terminalSessionId: 'term-111111111111111111111',
          presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: branchName } },
          requestRole: 'leader' as const,
          resourceDisposition: 'created' as const,
          runtimeProjectionApplied: true,
        }
      },
    )
    const writeInput = vi.fn()
    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    const showRepoBranchTerminalSession = vi.fn(() => true)
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab, showRepoBranchTerminalSession })
    let resolveViewer!: (value: { viewer: 'bat'; shell: 'posix'; executionRoot: string }) => void
    filetreeClientMocks.getRepositoryFileViewer.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveViewer = resolve
        }),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    renderInJsdom(
      <QueryClientProvider client={queryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionContext value={terminalCommandContextWith({ createTerminalWithAdmission, writeInput })}>
            <TerminalSessionReadContext value={emptyTerminalReadContext}>
              <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
                <GitWorkspacePaneContentHarness
                  repo={gitWorkspacePaneProjection(repo)}
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
    observeWorkspacePaneRouteForTest({
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName,
      worktreePath,
      route: { kind: 'static', tab: 'files' },
    })
    await act(async () => {
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      await Promise.resolve()
    })
    const actionButton = row.querySelector<HTMLButtonElement>('[data-action-popover-trigger]')
    expect(actionButton?.getAttribute('aria-busy')).toBe('true')
    expect(actionButton?.querySelector('svg.animate-spin')).toBeTruthy()
    expect(createTerminalWithAdmission).toHaveBeenCalledTimes(1)
    await act(async () => {
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      await Promise.resolve()
    })
    expect(filetreeClientMocks.getRepositoryFileViewer).toHaveBeenCalledTimes(1)
    useWorkspacesStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/changes', 'status')
    await act(async () => {
      resolveViewer({ viewer: 'bat', shell: 'posix', executionRoot: worktreePath })
      await Promise.resolve()
    })

    expect(showRepoBranchTerminalSession).toHaveBeenCalledWith(
      REPO_ID,
      'feature/filetree-open',
      'term-111111111111111111111',
    )
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
    expect(createTerminalWithAdmission).toHaveBeenCalledWith(
      {
        target: {
          kind: 'git-worktree' as const,
          workspaceId: REPO_ID,
          workspaceRuntimeId: repo.workspaceRuntimeId,
          root: 'goblin+file:///tmp/filetree-open-worktree',
        },
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: branchName } },
      },
      {
        resolveStartupShellCommand: expect.any(Function),
      },
      {
        insertAfterIdentity: 'workspace-pane:files',
      },
    )
    expect(
      readWorkspacePaneTabsForTarget({
        kind: 'git-worktree' as const,
        workspaceId: REPO_ID,
        workspaceRuntimeId: repo.workspaceRuntimeId,
        worktreePath,
      }),
    ).toEqual([staticEntry('files'), terminalEntry('term-111111111111111111111'), staticEntry('status')])
    expect(resolvedStartupShellCommand).toBe(
      "bat --paging=never --style=plain '/tmp/filetree-open-worktree/README.md'\r",
    )
    expect(writeInput).not.toHaveBeenCalled()

    // Chrome-tab-style opener tracking: the terminal this opened should be
    // attributed to "files" (the only tab open, and active, when the file
    // was double-clicked), scoped to this workspace pane target.
    expect(
      workspacePaneTabOpener(
        {
          kind: 'git-worktree',
          workspaceId: REPO_ID,
          worktreePath: '/tmp/filetree-open-worktree',
        },
        repo.workspaceRuntimeId,
        'terminal:term-111111111111111111111',
      ),
    ).toBe('workspace-pane:files')
  })

  test('opens a workspace-root file through the shared filesystem terminal flow', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///Users/example/Workspace/sample-project')
    const repo = seedRepoWithReadModelForTest({ id: workspaceId, branches: [], currentBranchName: null })
    filetreeClientMocks.getRepositoryTree.mockResolvedValueOnce({
      nodes: [
        {
          id: 'sample-document.md',
          path: 'sample-document.md',
          name: 'sample-document.md',
          parentId: null,
          kind: 'file',
          status: 'clean',
        },
      ],
      truncated: false,
    })
    filetreeClientMocks.getRepositoryFileViewer.mockResolvedValueOnce({
      viewer: 'bat',
      shell: 'posix',
      executionRoot: '/Users/example/Workspace/sample-project',
    })
    let startupShellCommand: string | null = null
    const createTerminalWithAdmission: TerminalSessionContextValue['createTerminalWithAdmission'] = vi.fn(
      async (base, options) => {
        startupShellCommand = (await options?.resolveStartupShellCommand?.()) ?? null
        workspacePaneTabsTestBridge.addRuntimeTab({
          kind: 'workspace-root',
          workspaceId: workspaceId,
          workspaceRuntimeId: repo.workspaceRuntimeId,

          terminalSessionId: 'term-111111111111111111111',
          insertAfterIdentity: 'workspace-pane:files',
        })
        return {
          terminalSessionId: 'term-111111111111111111111',
          presentation: { kind: 'workspace-root' as const },
          requestRole: 'leader' as const,
          resourceDisposition: 'created' as const,
          runtimeProjectionApplied: true,
        }
      },
    )

    renderInJsdom(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigationWith({})}>
          <TerminalSessionContext value={terminalCommandContextWith({ createTerminalWithAdmission })}>
            <FiletreeTab
              target={{
                kind: 'workspace-root',
                workspaceId,
                workspaceRuntimeId: repo.workspaceRuntimeId,
                rootPath: workspaceId,
                capabilities: {
                  files: { read: true, write: true },
                  terminal: { available: true },
                  git: { status: 'unavailable' },
                },
              }}
            />
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    const row = await screen.findByRole('treeitem', { name: 'sample-document.md' })
    await act(async () => {
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      await Promise.resolve()
    })

    await waitFor(() => expect(createTerminalWithAdmission).toHaveBeenCalledOnce())
    expect(createTerminalWithAdmission).toHaveBeenCalledWith(
      {
        target: {
          kind: 'workspace-root',
          workspaceId,
          workspaceRuntimeId: repo.workspaceRuntimeId,
        },
        presentation: { kind: 'workspace-root' },
      },
      { resolveStartupShellCommand: expect.any(Function) },
      { insertAfterIdentity: 'workspace-pane:files' },
    )
    expect(
      useWorkspacesStore.getState().workspaces[workspaceId]?.ui.preferredWorkspacePaneTabByTarget[
        `${workspaceId}\0workspace-root`
      ],
    ).toBe('terminal')
    expect(startupShellCommand).toBe(
      "bat --paging=never --style=plain '/Users/example/Workspace/sample-project/sample-document.md'\r",
    )
  })

  test('does not expose terminal-open or trash actions without filesystem capabilities', async () => {
    const workspaceId = workspaceIdForTest('goblin+file:///tmp/read-only-filetree-workspace')
    const repo = seedRepoWithReadModelForTest({ id: workspaceId, branches: [], currentBranchName: null })
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
    const createTerminalWithAdmission = vi.fn()

    renderInJsdom(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigationWith({})}>
          <TerminalSessionContext value={terminalCommandContextWith({ createTerminalWithAdmission })}>
            <FiletreeTab
              target={{
                kind: 'workspace-root',
                workspaceId,
                workspaceRuntimeId: repo.workspaceRuntimeId,
                rootPath: workspaceId,
                capabilities: {
                  files: { read: true, write: false },
                  terminal: { available: false },
                  git: { status: 'unavailable' },
                },
              }}
            />
          </TerminalSessionContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    const row = await screen.findByRole('treeitem', { name: 'README.md' })
    expect(row.querySelector('[data-action-popover-trigger]')).toBeNull()
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(createTerminalWithAdmission).not.toHaveBeenCalled()
  })

  test('falls back to status when a branch preference names a closed tab', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/a'), createBranchSnapshot('feature/b')],
      currentBranchName: 'feature/b',
      preferredWorkspacePaneTab: 'history',
      workspacePaneTabsByBranch: {
        'feature/a': [staticEntry('status'), staticEntry('history')],
        'feature/b': [staticEntry('status')],
      },
    })
    const presentationRepo = gitWorkspacePaneProjection(repo)
    const detail = getTestGitWorkspacePanePresentation(presentationRepo)
    const workspacePaneTabModel = preferenceBackedWorkspacePaneTabModel(REPO_ID, 'feature/b')

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <BranchActionSurfaceContext value={defaultBranchActionSurface()}>
          <GitWorkspacePaneContent
            repo={presentationRepo}
            detail={detail}
            workspacePaneId="workspace"
            workspacePaneTabModel={workspacePaneTabModel}
          />
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
      branchSnapshots: [createBranchSnapshot('feature/history')],
      currentBranchName: 'feature/history',
      preferredWorkspacePaneTab: 'history',
      workspacePaneTabsByBranch: { 'feature/history': [staticEntry('status'), staticEntry('history')] },
    })
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <GitWorkspacePaneContentHarness
          repo={gitWorkspacePaneProjection(repo)}
          detail={detail}
          workspacePaneId="workspace"
        />
      </TerminalSessionReadContext>,
    )
    await flushAsyncWork()
    await flushAsyncWork()

    expect(repoClientMocks.getRepoLog).toHaveBeenCalledWith(
      REPO_ID,
      repo.workspaceRuntimeId,
      'feature/history',
      expect.objectContaining({ count: 100 }),
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
    expect(repoClientMocks.openRepoUrl).toHaveBeenCalledWith(REPO_ID, repo.workspaceRuntimeId, {
      type: 'commit',
      hash: '78c150a000000000000000000000000000000000',
    })
    expect(rows[1]?.textContent).toContain('1111111')
    expect(rows[1]?.textContent).toContain('Start history graph')
  })

  test('labels worktree history panels with the static tab id', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [createBranchSnapshot('feature/history', { worktree: { path: '/tmp/history-worktree' } })],
      currentBranchName: 'feature/history',
      preferredWorkspacePaneTab: 'history',
      workspacePaneTabsByBranch: { 'feature/history': [staticEntry('status'), staticEntry('history')] },
    })
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <GitWorkspacePaneContentHarness
          repo={gitWorkspacePaneProjection(repo)}
          detail={detail}
          workspacePaneId="workspace"
        />
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
      branchSnapshots: [createBranchSnapshot('feature/history')],
      currentBranchName: 'feature/history',
      preferredWorkspacePaneTab: 'history',
      workspacePaneTabsByBranch: { 'feature/history': [staticEntry('history')] },
    })
    const detail = getTestGitWorkspacePanePresentation(gitWorkspacePaneProjection(repo))

    const { container } = renderInJsdom(
      <TerminalSessionReadContext value={emptyTerminalReadContext}>
        <GitWorkspacePaneContentHarness
          repo={gitWorkspacePaneProjection(repo)}
          detail={detail}
          workspacePaneId="workspace"
        />
      </TerminalSessionReadContext>,
    )
    await flushAsyncWork()

    await waitFor(() => {
      expect(container.textContent).toContain('error.failed-read-repo')
    })
    expect(container.textContent).not.toContain('log.empty-for-branch')
  })
})

const emptyWorktreeSnapshot = EMPTY_TERMINAL_WORKTREE_SNAPSHOT
const emptyTerminalSnapshot = EMPTY_TERMINAL_SNAPSHOT

const emptyTerminalReadContext: TerminalSessionReadContextValue = {
  terminalWorktreeSnapshot: () => emptyWorktreeSnapshot,
  subscribeTerminalWorktree: () => () => {},
  workspaceBellCount: () => 0,
  subscribeWorkspaceBellCount: () => () => {},
  snapshot: () => emptyTerminalSnapshot,
  subscribeSnapshot: () => () => {},
}

function gitWorktreeFilesystemTarget(repo: WorkspaceState, rootPath: string, branchName: string) {
  if (repo.capability.kind !== 'git') throw new Error('expected Git workspace fixture')
  return {
    kind: 'git-worktree' as const,
    workspaceId: repo.id,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    rootPath,
    head: { kind: 'branch' as const, branchName },
    capabilities: repo.capability.probe.capabilities,
  }
}

function terminalCommandContextWith(overrides: Partial<TerminalSessionContextValue> = {}): TerminalSessionContextValue {
  return terminalSessionContextForTest({
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
    ...overrides,
  })
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
  const navigation: PrimaryWindowNavigationActions = {
    activateWorkspace: () => {},
    closeWorkspace: async () => ({ ok: true }),
    cycleWorkspace: () => {},
    selectRepoBranch: () => true,
    showRepoBranchEmptyWorkspacePane: () => true,
    showRepoBranchWorkspacePaneTab: () => true,
    showRepoBranchTerminalSession: () => true,
    commitWorkspacePaneRoute: () => false,
    goBack: () => {},
    goForward: () => {},
    openSettings: () => {},
    openCreateWorktree: () => {},
    ...overrides,
    currentWorkspacePaneRoute: overrides.currentWorkspacePaneRoute ?? (() => undefined),
  }
  navigation.commitWorkspacePaneRoute = observedWorkspacePaneRouteCommitForTest(navigation)
  return navigation
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
