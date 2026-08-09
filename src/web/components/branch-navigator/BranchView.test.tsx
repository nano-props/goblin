// @vitest-environment jsdom

import {
  createRepoBranch,
  resetWorkspacesStore,
  seedRepoQueryDataForTest,
  seedRepoWithReadModelForTest,
  createBranchSnapshot,
} from '#/web/test-utils/repo-store.ts'
import { fireEvent, screen } from '@testing-library/vue'
import { VueQueryClientScope } from '#/web/test-utils/VueQueryClientScope.tsx'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { flushTestUpdates, renderInJsdom } from '#/test-utils/render.tsx'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { BranchView } from '#/web/components/branch-navigator/BranchView.tsx'
import type { AppNavigationActions } from '#/web/app-navigation-actions.ts'
import { AppNavigationProvider } from '#/web/app-navigation.tsx'
import { appNavigationActionsForTest } from '#/web/test-utils/app-navigation.ts'
import { appQueryClient } from '#/web/app-query-client.ts'
import { installGoblinTestBridge } from '#/web/test-utils/bridge.ts'
import { repoSnapshotQueryKey, repoWorktreeStatusQueryKey } from '#/web/repo-query-keys.ts'
import { TerminalSessionReadScope } from '#/web/components/terminal/terminal-session-context.ts'
import type { TerminalSessionReadContextValue } from '#/web/components/terminal/types.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'

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

describe('BranchView', () => {
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

    renderBranchView()

    expect(screen.getByText('feature/query')).toBeTruthy()
  })

  test('filters the query branch rows with the workspace branch view preference', async () => {
    const worktreeBranch = createRepoBranch('feature/worktree', {
      worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false },
    })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/plain'), worktreeBranch],
      currentBranchName: 'feature/worktree',
    })
    seedRepoQueryDataForTest(repo, {
      branches: [createRepoBranch('feature/plain'), worktreeBranch],
      currentBranch: 'feature/worktree',
    })
    workspacesStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    renderBranchView()

    expect(screen.getByText('feature/worktree')).toBeTruthy()
    expect(screen.queryByText('feature/plain')).toBeNull()
  })

  test('opens a non-current branch status through destination navigation', async () => {
    const destination = createRepoBranch('feature/destination', {
      worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false },
    })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/current'), destination],
      currentBranchName: 'feature/current',
    })
    seedRepoQueryDataForTest(repo, {
      branches: [createRepoBranch('feature/current'), destination],
      currentBranch: 'feature/current',
    })

    renderBranchView()
    await fireEvent.doubleClick(screen.getByText('feature/destination'))

    expect(mocks.dispatchShowWorkspacePaneStaticTabAction).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: REPO_ID,
        branchName: 'feature/destination',
        type: 'status',
      }),
    )
  })

  test('uses the TanStack Query status read model for branch row dirty state when available', async () => {
    const branch = createRepoBranch('feature/dirty', {
      worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false },
    })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
      currentBranchName: 'feature/dirty',
    })
    seedRepoQueryDataForTest(repo, {
      branches: [branch],
      currentBranch: 'feature/dirty',
      status: [
        {
          path: WORKTREE_PATH,
          branch: 'feature/dirty',
          isMain: false,
          entries: [{ x: 'M', y: ' ', path: 'dirty.ts' }],
        },
      ],
    })

    renderBranchView()

    expect(screen.getByLabelText('branches.dirty')).toBeTruthy()
  })

  test('derives query snapshot worktree state from the query status read model', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [],
      currentBranchName: 'feature/query-dirty',
    })
    seedRepoQueryDataForTest(repo, {
      branches: [
        createBranchSnapshot('feature/query-dirty', {
          isCurrent: true,
          worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false },
        }),
      ],
      currentBranch: 'feature/query-dirty',
      status: [
        {
          path: WORKTREE_PATH,
          branch: 'feature/query-dirty',
          isMain: false,
          entries: [{ x: 'M', y: ' ', path: 'query-dirty.ts' }],
        },
      ],
    })

    renderBranchView()

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

    renderBranchView()

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

    renderBranchView()

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
    renderBranchView()

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

    renderBranchView()

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

    renderBranchView()

    await vi.waitFor(() => expect(readStatus).toHaveBeenCalledOnce())
    expect(screen.getByText('main')).toBeTruthy()
    expect(screen.queryByText('status.stale-title')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect((await screen.findByRole('status')).textContent).toContain('error.repo-membership-changing')
    expect(screen.getByRole('button', { name: 'error.try-again' })).toBeTruthy()
  })
})

function renderBranchView() {
  return renderInJsdom(
    <VueQueryClientScope client={appQueryClient}>
      <AppNavigationProvider value={navigation}>
        <TerminalSessionReadScope value={terminalReadContext}>
          <BranchView repoId={REPO_ID} />
        </TerminalSessionReadScope>
      </AppNavigationProvider>
    </VueQueryClientScope>,
  )
}
