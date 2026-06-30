// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react'
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
import { resetReposStore, seedRepoState } from '#/web/test-utils/bridge.ts'

const REPO_ID = '/tmp/repo-workspace-container-repo'

const emptyWorktreeSnapshot: TerminalWorktreeSnapshot = {
  terminalWorktreeKey: '',
  selectedDescriptor: null,
  sessions: [],
  count: 0,
  bellCount: 0,
  activeCount: 0,
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
  serialize: vi.fn(() => ''),
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
      <PrimaryWindowNavigationProvider value={navigation}>
        <TerminalSessionContext.Provider value={terminalCommandContext}>
          <TerminalSessionReadContext.Provider value={terminalReadContext}>
            <RepoWorkspace repoId={REPO_ID} />
          </TerminalSessionReadContext.Provider>
        </TerminalSessionContext.Provider>
      </PrimaryWindowNavigationProvider>,
    )

    expect(() => {
      act(() => {
        seedRepoState({ id: REPO_ID, branches: [], statusLoaded: true })
      })
    }).not.toThrow()
    expect(screen.getByText('branches.empty')).toBeTruthy()
  })
})
