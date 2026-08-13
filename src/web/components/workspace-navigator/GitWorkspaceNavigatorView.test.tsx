// @vitest-environment jsdom

import {
  createRepoBranch,
  resetWorkspacesStore,
  seedRepoQueryDataForTest,
  seedRepoWithReadModelForTest,
  createBranchSnapshot,
  createRepoWorktreeSnapshotForTest,
} from '#/web/test-utils/repo-store.ts'
import { fireEvent, screen } from '@testing-library/vue'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { flushTestUpdates, renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { GitWorkspaceNavigatorView } from '#/web/components/workspace-navigator/GitWorkspaceNavigatorView.tsx'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'
import { AppNavigationProvider } from '#/web/app-navigation.tsx'
import { appNavigationActionsForTest } from '#/web/test-utils/app-navigation.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { installGoblinTestBridge } from '#/web/test-utils/bridge.ts'
import { repoSnapshotQueryKey, repoWorktreeStatusQueryKey } from '#/web/repo-query-keys.ts'
import { TerminalSessionReadScope } from '#/web/components/terminal/terminal-session-context.ts'
import type { TerminalSessionReadContextValue } from '#/web/components/terminal/types.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { getRepoSnapshotQueryData, setRepoSnapshotQueryData } from '#/web/repo-query-cache.ts'

const mocks = vi.hoisted(() => ({
  dispatchShowWorkspacePaneStaticTabAction: vi.fn(),
}))

vi.mock('#/web/workspace-pane/workspace-pane-tab-open-action.ts', () => ({
  dispatchShowWorkspacePaneStaticTabAction: mocks.dispatchShowWorkspacePaneStaticTabAction,
}))

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/example-repo')
const WORKTREE_PATH = '/tmp/goblin-branch-view-test-worktree'

const navigation: AppNavigationActions = {
  ...appNavigationActionsForTest(),
  currentWorkspacePaneRoute: () => undefined,
  activateWorkspace: vi.fn(),
  closeWorkspace: vi.fn(),
  cycleWorkspace: vi.fn(),
  selectRepoBranch: vi.fn(),
  selectRepoWorktree: vi.fn(),
  commitFilesystemWorkspacePaneRoute: vi.fn(async () => true),
  commitWorkspacePaneRoute: vi.fn(async () => true),
  goBack: vi.fn(),
  goForward: vi.fn(),
  openSettings: vi.fn(),
  openCreateWorktree: vi.fn(),
}

const terminalReadContext: TerminalSessionReadContextValue = {
  terminalFilesystemTargetSnapshot: () => ({
    terminalFilesystemTargetKey: '',
    selectedDescriptor: null,
    sessions: [],
    count: 0,
    bellCount: 0,
    outputActiveCount: 0,
    createPending: false,
  }),
  subscribeTerminalFilesystemTarget: () => () => {},
  workspaceBellCount: () => 0,
  subscribeWorkspaceBellCount: () => () => {},
  workspaceTerminalSessions: () => [],
  subscribeWorkspaceTerminalSessions: () => () => {},
  snapshot: () => ({
    phase: 'opening',
    message: null,
    processName: 'terminal',
    composer: { expanded: false, mode: 'keys', draft: '', historyEntries: [] },
  }),
  subscribeSnapshot: () => () => {},
}

beforeEach(() => {
  appQueryClient.clear()
  resetWorkspacesStore()
  vi.clearAllMocks()
})

describe('GitWorkspaceNavigatorView', () => {
  test('uses the TanStack Query snapshot for branch rows when available', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [],
      currentBranchName: 'feature/query',
    })
    seedRepoQueryDataForTest(repo, {
      branches: [createRepoBranch('feature/query')],
      currentBranch: 'feature/query',
    })

    renderGitWorkspaceNavigatorView()

    expect(screen.getByText('feature/query')).toBeTruthy()
  })

  test('filters the query branch rows with the workspace branch view preference', async () => {
    const worktreeBranch = createRepoBranch('feature/worktree')
    const worktrees = [createRepoWorktreeSnapshotForTest(worktreeBranch.name, WORKTREE_PATH)]
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/plain'), worktreeBranch],
      currentBranchName: 'feature/worktree',
      worktrees,
    })
    seedRepoQueryDataForTest(repo, {
      branches: [createRepoBranch('feature/plain'), worktreeBranch],
      currentBranch: 'feature/worktree',
      worktrees,
    })
    workspacesStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    renderGitWorkspaceNavigatorView()

    expect(screen.getByText('feature/worktree')).toBeTruthy()
    expect(screen.queryByText('feature/plain')).toBeNull()
  })

  test('replaces an attached branch row with its in-progress worktree state', () => {
    const branch = createRepoBranch('feature/merge')
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
      currentBranchName: 'feature/merge',
      worktrees: [createRepoWorktreeSnapshotForTest(branch.name, WORKTREE_PATH)],
    })
    const snapshot = getRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId)
    if (!snapshot) throw new Error('expected seeded snapshot')
    setRepoSnapshotQueryData(repo.id, repo.workspaceRuntimeId, {
      ...snapshot,
      worktrees: snapshot.worktrees.map((worktree) => ({ ...worktree, operation: { kind: 'merge' as const } })),
    })

    renderGitWorkspaceNavigatorView()

    expect(screen.getByText('worktree-state.merge')).toBeTruthy()
    expect(screen.queryByText('feature/merge')).toBeNull()
  })

  test.each(['rebase', 'bisect'] as const)(
    'replaces the retained branch row with its detached %s worktree state',
    (kind) => {
      const branch = createRepoBranch('feature/in-progress')
      seedRepoWithReadModelForTest({
        id: REPO_ID,
        branches: [branch],
        currentBranchName: null,
        worktrees: [
          {
            path: WORKTREE_PATH,
            head: { kind: 'detached' },
            headOid: '0123456789abcdef0123456789abcdef01234567',
            operation: { kind },
            materializedBranch: branch.name,
            isPrimary: false,
            isLocked: false,
          },
        ],
      })

      renderGitWorkspaceNavigatorView()

      expect(
        screen.getByText(kind === 'rebase' ? 'worktree-state.rebase-branch' : 'worktree-state.bisect'),
      ).toBeTruthy()
      expect(screen.queryByText(branch.name)).toBeNull()
    },
  )

  test('opens a materialized branch status through its worktree target', async () => {
    const destination = createRepoBranch('feature/destination')
    const worktrees = [createRepoWorktreeSnapshotForTest(destination.name, WORKTREE_PATH)]
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/current'), destination],
      currentBranchName: 'feature/current',
      worktrees,
    })
    seedRepoQueryDataForTest(repo, {
      branches: [createRepoBranch('feature/current'), destination],
      currentBranch: 'feature/current',
      worktrees,
    })

    renderGitWorkspaceNavigatorView()
    await fireEvent.click(screen.getByText('feature/destination'))
    await fireEvent.doubleClick(screen.getByText('feature/destination'))

    expect(navigation.selectRepoWorktree).toHaveBeenCalledOnce()
    expect(navigation.selectRepoWorktree).toHaveBeenCalledWith({
      routeTarget: { kind: 'git-worktree', workspaceId: REPO_ID, worktreePath: WORKTREE_PATH },
      workspaceRuntimeId: repo.workspaceRuntimeId,
    })
    expect(navigation.commitFilesystemWorkspacePaneRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        routeTarget: { kind: 'git-worktree', workspaceId: REPO_ID, worktreePath: WORKTREE_PATH },
      }),
      { kind: 'static', tab: 'status' },
    )
    expect(mocks.dispatchShowWorkspacePaneStaticTabAction).not.toHaveBeenCalled()
  })

  test('opens a detached worktree status through its canonical worktree target', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('main')],
      currentBranchName: null,
      worktrees: [
        {
          path: WORKTREE_PATH,
          head: { kind: 'detached' },
          headOid: '0123456789abcdef0123456789abcdef01234567',
          operation: null,
          materializedBranch: null,
          isPrimary: false,
          isLocked: false,
        },
      ],
    })

    renderGitWorkspaceNavigatorView()
    await fireEvent.doubleClick(screen.getByText('0123456'))

    expect(navigation.commitFilesystemWorkspacePaneRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        routeTarget: { kind: 'git-worktree', workspaceId: REPO_ID, worktreePath: WORKTREE_PATH },
      }),
      { kind: 'static', tab: 'status' },
    )
    expect(mocks.dispatchShowWorkspacePaneStaticTabAction).not.toHaveBeenCalled()
  })

  test('opens an unmaterialized branch status through its branch target', async () => {
    const branch = createRepoBranch('feature/destination')
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
      currentBranchName: null,
    })
    seedRepoQueryDataForTest(repo, { branches: [branch], currentBranch: '' })

    renderGitWorkspaceNavigatorView()
    await fireEvent.click(screen.getByText(branch.name))
    await fireEvent.doubleClick(screen.getByText(branch.name))

    expect(navigation.selectRepoBranch).toHaveBeenCalledOnce()
    expect(navigation.selectRepoBranch).toHaveBeenCalledWith({
      routeTarget: { kind: 'git-branch', workspaceId: REPO_ID, branchName: branch.name },
      workspaceRuntimeId: repo.workspaceRuntimeId,
    })

    expect(mocks.dispatchShowWorkspacePaneStaticTabAction).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: REPO_ID,
        branchName: branch.name,
        type: 'status',
      }),
    )
  })

  test('uses the TanStack Query status read model for branch row dirty state when available', async () => {
    const branch = createRepoBranch('feature/dirty')
    const worktrees = [createRepoWorktreeSnapshotForTest(branch.name, WORKTREE_PATH)]
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
      currentBranchName: 'feature/dirty',
      worktrees,
    })
    seedRepoQueryDataForTest(repo, {
      branches: [branch],
      currentBranch: 'feature/dirty',
      worktrees,
      status: [
        {
          path: WORKTREE_PATH,
          branch: 'feature/dirty',
          isMain: false,
          entries: [{ x: 'M', y: ' ', path: 'dirty.ts' }],
        },
      ],
    })

    renderGitWorkspaceNavigatorView()

    expect(screen.getByLabelText('branches.dirty')).toBeTruthy()
  })

  test('derives query snapshot worktree state from the query status read model', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [],
      currentBranchName: 'feature/query-dirty',
    })
    seedRepoQueryDataForTest(repo, {
      branches: [createBranchSnapshot('feature/query-dirty')],
      currentBranch: 'feature/query-dirty',
      worktrees: [createRepoWorktreeSnapshotForTest('feature/query-dirty', WORKTREE_PATH)],
      status: [
        {
          path: WORKTREE_PATH,
          branch: 'feature/query-dirty',
          isMain: false,
          entries: [{ x: 'M', y: ' ', path: 'query-dirty.ts' }],
        },
      ],
    })

    renderGitWorkspaceNavigatorView()

    expect(screen.getByLabelText('branches.dirty')).toBeTruthy()
  })

  test('keeps branch rows visible with unknown dirty state when the initial status read fails', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('main')],
      currentBranchName: 'main',
    })
    seedRepoQueryDataForTest(repo, {
      branches: [createRepoBranch('main')],
      currentBranch: 'main',
    })
    appQueryClient.removeQueries({
      queryKey: repoWorktreeStatusQueryKey(REPO_ID, repo.workspaceRuntimeId),
    })
    const readStatus = vi.fn(async () => {
      throw new Error('status failed')
    })
    installGoblinTestBridge({ 'repo.worktreeStatus': readStatus })

    renderGitWorkspaceNavigatorView()

    await vi.waitFor(() => expect(readStatus).toHaveBeenCalledOnce())
    expect(screen.getByText('main')).toBeTruthy()
    expect((await screen.findByRole('alert')).textContent).toContain('error.failed-read-repo')
    expect(screen.getByRole('button', { name: 'error.try-again' })).toBeTruthy()
    expect(screen.queryByLabelText('branches.dirty')).toBeNull()
  })

  test('offers a neutral retry when the initial status read crosses a membership change', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('main')],
      currentBranchName: 'main',
    })
    seedRepoQueryDataForTest(repo, {
      branches: [createRepoBranch('main')],
      currentBranch: 'main',
    })
    appQueryClient.removeQueries({
      queryKey: repoWorktreeStatusQueryKey(REPO_ID, repo.workspaceRuntimeId),
    })
    const readStatus = vi.fn(async () => {
      throw new Error('error.repo-membership-changing')
    })
    installGoblinTestBridge({ 'repo.worktreeStatus': readStatus })

    renderGitWorkspaceNavigatorView()

    expect((await screen.findByRole('status')).textContent).toContain('error.repo-membership-changing')
    expect(screen.getByText('main')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'error.try-again' })).toBeTruthy()
  })

  test('keeps last-good branch status visible with a retryable stale warning', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('main')],
      currentBranchName: 'main',
    })
    seedRepoQueryDataForTest(repo, {
      branches: [createRepoBranch('main')],
      currentBranch: 'main',
      status: [{ path: REPO_ID, branch: 'main', isMain: true, entries: [] }],
    })
    const readStatus = vi
      .fn()
      .mockRejectedValueOnce(new Error('status failed'))
      .mockResolvedValueOnce({ workspaceRuntimeId: repo.workspaceRuntimeId, status: [], loadedAt: 2 })
    installGoblinTestBridge({ 'repo.worktreeStatus': readStatus })
    renderGitWorkspaceNavigatorView()

    expect(await screen.findByText('status.stale-title')).toBeTruthy()
    expect(screen.getByText('main')).toBeTruthy()
    await flushTestUpdates(() => screen.getByRole<HTMLElement>('button', { name: 'error.try-again' }).click())
    await vi.waitFor(() => expect(readStatus).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(screen.queryByText('status.stale-title')).toBeNull())
  })

  test('presents simultaneous snapshot and status failures as one retryable notice', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('main')],
      currentBranchName: 'main',
    })
    const readSnapshot = vi.fn(async () => {
      throw new Error('snapshot failed')
    })
    const readStatus = vi.fn(async () => {
      throw new Error('status failed')
    })
    installGoblinTestBridge({
      'repo.snapshot': readSnapshot,
      'repo.worktreeStatus': readStatus,
    })
    await appQueryClient.invalidateQueries({
      queryKey: repoSnapshotQueryKey(REPO_ID, repo.workspaceRuntimeId),
      exact: true,
      refetchType: 'none',
    })

    renderGitWorkspaceNavigatorView()

    await vi.waitFor(() => {
      expect(readSnapshot).toHaveBeenCalledOnce()
      expect(readStatus).toHaveBeenCalledOnce()
    })
    expect(await screen.findAllByText('status.stale-title')).toHaveLength(1)
    await flushTestUpdates(() => screen.getByRole<HTMLElement>('button', { name: 'error.try-again' }).click())
    await vi.waitFor(() => {
      expect(readSnapshot).toHaveBeenCalledTimes(2)
      expect(readStatus).toHaveBeenCalledTimes(2)
    })
  })

  test('keeps the last accepted projection with a neutral retry while worktree membership changes', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('main')],
      currentBranchName: 'main',
    })
    seedRepoQueryDataForTest(repo, {
      branches: [createRepoBranch('main')],
      currentBranch: 'main',
      status: [{ path: REPO_ID, branch: 'main', isMain: true, entries: [] }],
    })
    const readStatus = vi.fn(async () => {
      throw new Error('error.repo-membership-changing')
    })
    installGoblinTestBridge({ 'repo.worktreeStatus': readStatus })

    renderGitWorkspaceNavigatorView()

    await vi.waitFor(() => expect(readStatus).toHaveBeenCalledOnce())
    expect(screen.getByText('main')).toBeTruthy()
    expect(screen.queryByText('status.stale-title')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect((await screen.findByRole('status')).textContent).toContain('error.repo-membership-changing')
    expect(screen.getByRole('button', { name: 'error.try-again' })).toBeTruthy()
  })
})

function renderGitWorkspaceNavigatorView() {
  return renderInJsdom(
    <VueQueryClientScope client={appQueryClient}>
      <AppNavigationProvider value={navigation}>
        <TerminalSessionReadScope value={terminalReadContext}>
          <GitWorkspaceNavigatorView repoId={REPO_ID} />
        </TerminalSessionReadScope>
      </AppNavigationProvider>
    </VueQueryClientScope>,
  )
}
