// @vitest-environment jsdom

import { screen } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { BranchView } from '#/web/components/branch-navigator/BranchView.tsx'
import {
  PrimaryWindowNavigationProvider,
  type PrimaryWindowNavigationActions,
} from '#/web/primary-window-navigation.tsx'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { setRepoStatusQueryData } from '#/web/repo-data-query.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/test-utils/bridge.ts'
import { TerminalSessionReadContext } from '#/web/components/terminal/terminal-session-context.ts'
import type { TerminalSessionReadContextValue } from '#/web/components/terminal/types.ts'

const REPO_ID = '/tmp/gbl-branch-view-test-repo'
const WORKTREE_PATH = '/tmp/gbl-branch-view-test-worktree'

const navigation: PrimaryWindowNavigationActions = {
  activateRepo: vi.fn(),
  closeRepo: vi.fn(),
  cycleRepo: vi.fn(),
  selectRepoBranch: vi.fn(),
  showRepoWorkspacePaneTab: vi.fn(),
  showRepoBranchWorkspacePaneTab: vi.fn(),
  openSettings: vi.fn(),
}

const terminalReadContext: TerminalSessionReadContextValue = {
  terminalWorktreeSnapshot: () => ({
    terminalWorktreeKey: '',
    selectedDescriptor: null,
    sessions: [],
    count: 0,
    bellCount: 0,
    outputActiveCount: 0,
    pendingCreate: false,
  }),
  subscribeTerminalWorktree: () => () => {},
  repoBellCount: () => 0,
  subscribeRepoBellCount: () => () => {},
  snapshot: () => ({ phase: 'opening', message: null, processName: 'terminal' }),
  subscribeSnapshot: () => () => {},
}

beforeEach(() => {
  resetReposStore()
  vi.clearAllMocks()
})

describe('BranchView', () => {
  test('uses the React Query status read model for branch row dirty state when available', () => {
    const branch = createRepoBranch('feature/dirty', { worktree: { path: WORKTREE_PATH } })
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [branch],
      selectedBranch: 'feature/dirty',
      statusLoaded: true,
    })
    setRepoStatusQueryData(REPO_ID, repo.instanceId, [
      { path: WORKTREE_PATH, branch: 'feature/dirty', isMain: false, entries: [{ x: 'M', y: ' ', path: 'dirty.ts' }] },
    ])

    renderInJsdom(
      <QueryClientProvider client={primaryWindowQueryClient}>
        <PrimaryWindowNavigationProvider value={navigation}>
          <TerminalSessionReadContext value={terminalReadContext}>
            <BranchView repoId={REPO_ID} />
          </TerminalSessionReadContext>
        </PrimaryWindowNavigationProvider>
      </QueryClientProvider>,
    )

    expect(screen.getByLabelText('branches.dirty')).toBeTruthy()
  })
})
