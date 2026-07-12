// @vitest-environment jsdom

import { fireEvent, screen } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { BranchView } from '#/web/components/branch-navigator/BranchView.tsx'
import {
  PrimaryWindowNavigationProvider,
  type PrimaryWindowNavigationActions,
} from '#/web/primary-window-navigation.tsx'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  createBranchSnapshot,
  createRepoBranch,
  resetReposStore,
  seedRepoReadModelQueryData,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { TerminalSessionReadContext } from '#/web/components/terminal/terminal-session-context.ts'
import type { TerminalSessionReadContextValue } from '#/web/components/terminal/types.ts'

const mocks = vi.hoisted(() => ({
  dispatchShowWorkspacePaneStaticTabAction: vi.fn(),
}))

vi.mock('#/web/workspace-pane/workspace-pane-tab-open-action.ts', () => ({
  dispatchShowWorkspacePaneStaticTabAction: mocks.dispatchShowWorkspacePaneStaticTabAction,
}))

const REPO_ID = '/tmp/goblin-branch-view-test-repo'
const WORKTREE_PATH = '/tmp/goblin-branch-view-test-worktree'

const navigation: PrimaryWindowNavigationActions = {
  currentRepoBranchWorkspacePaneRoute: () => undefined,
  activateRepo: vi.fn(),
  closeRepo: vi.fn(),
  cycleRepo: vi.fn(),
  selectRepoBranch: vi.fn(),
  showRepoBranchEmptyWorkspacePane: () => true,
  showRepoBranchWorkspacePaneTab: vi.fn(),
  showRepoBranchTerminalSession: vi.fn(),
  commitRepoBranchWorkspacePaneRoute: vi.fn(() => true),
  goBack: vi.fn(),
  goForward: vi.fn(),
  openSettings: vi.fn(),
  openCreateWorktree: vi.fn(),
}

const terminalReadContext: TerminalSessionReadContextValue = {
  terminalWorktreeSnapshot: () => ({
    terminalWorktreeKey: '',
    selectedDescriptor: null,
    sessions: [],
    count: 0,
    bellCount: 0,
    outputActiveCount: 0,
    createPending: false,
  }),
  subscribeTerminalWorktree: () => () => {},
  repoBellCount: () => 0,
  subscribeRepoBellCount: () => () => {},
  snapshot: () => ({ phase: 'opening', message: null, processName: 'terminal' }),
  subscribeSnapshot: () => () => {},
}

beforeEach(() => {
  primaryWindowQueryClient.clear()
  resetReposStore()
  vi.clearAllMocks()
})

describe('BranchView', () => {
  test('uses the React Query projection read model for branch rows when available', () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [],
      currentBranchName: 'feature/query',
    })
    seedRepoReadModelQueryData(repo, {
      branches: [createRepoBranch('feature/query')],
      currentBranch: 'feature/query',
    })

    renderBranchView()

    expect(screen.getByText('feature/query')).toBeTruthy()
  })

  test('opens a non-current branch status through destination navigation', () => {
    const destination = createRepoBranch('feature/destination', { worktree: { path: WORKTREE_PATH } })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/current'), destination],
      currentBranchName: 'feature/current',
    })
    seedRepoReadModelQueryData(repo, {
      branches: [createRepoBranch('feature/current'), destination],
      currentBranch: 'feature/current',
    })

    renderBranchView()
    fireEvent.doubleClick(screen.getByText('feature/destination'))

    expect(mocks.dispatchShowWorkspacePaneStaticTabAction).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: REPO_ID,
        branchName: 'feature/destination',
        type: 'status',
      }),
    )
  })

  test('uses the React Query status read model for branch row dirty state when available', () => {
    const branch = createRepoBranch('feature/dirty', { worktree: { path: WORKTREE_PATH } })
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [branch],
      currentBranchName: 'feature/dirty',
    })
    seedRepoReadModelQueryData(repo, {
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
    seedRepoReadModelQueryData(repo, {
      branches: [
        createBranchSnapshot('feature/query-dirty', {
          isCurrent: true,
          worktree: { path: WORKTREE_PATH, summary: { dirty: false, changeCount: 0 } },
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
})

function renderBranchView() {
  return renderInJsdom(
    <QueryClientProvider client={primaryWindowQueryClient}>
      <PrimaryWindowNavigationProvider value={navigation}>
        <TerminalSessionReadContext value={terminalReadContext}>
          <BranchView repoId={REPO_ID} />
        </TerminalSessionReadContext>
      </PrimaryWindowNavigationProvider>
    </QueryClientProvider>,
  )
}
