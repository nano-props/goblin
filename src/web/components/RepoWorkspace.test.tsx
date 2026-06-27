// @vitest-environment jsdom

import { act } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BranchWorkspace } from '#/web/components/BranchWorkspace.tsx'
import {
  TerminalSlotContext,
  TerminalSlotReadContext,
} from '#/web/components/terminal/terminal-slot-context.ts'
import type {
  TerminalSlotContextValue,
  TerminalSlotReadContextValue,
  WorktreeTerminalSnapshot,
} from '#/web/components/terminal/types.ts'
import { MainWindowNavigationProvider, type MainWindowNavigationActions } from '#/web/main-window-navigation.tsx'
import { useRepoSyncStore } from '#/web/stores/repo-sync.ts'
import { resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'

const REPO_ID = '/tmp/branch-workspace-container-repo'

const emptyWorktreeSnapshot: WorktreeTerminalSnapshot = {
  worktreeTerminalKey: '',
  selectedDescriptor: null,
  slots: [],
  count: 0,
  bellCount: 0,
  pendingCreate: false,
}

const terminalReadContext: TerminalSlotReadContextValue = {
  worktreeSnapshot: () => emptyWorktreeSnapshot,
  subscribeWorktree: () => () => {},
  snapshot: () => ({ phase: 'opening', message: null, processName: 'terminal' }),
  subscribeSnapshot: () => () => {},
}

const terminalCommandContext: TerminalSlotContextValue = {
  createTerminal: vi.fn(async () => 'slot-1'),
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
  serialize: vi.fn(() => ''),
}

const navigation: MainWindowNavigationActions = {
  activateRepo: vi.fn(),
  closeRepo: vi.fn(),
  cycleRepo: vi.fn(),
  selectRepoBranch: vi.fn(),
  showRepoWorkspacePaneView: vi.fn(),
  showRepoBranchWorkspacePaneView: vi.fn(),
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

describe('BranchWorkspace', () => {
  test('can render after the repo appears without changing hook order', () => {
    render(
      <MainWindowNavigationProvider value={navigation}>
        <TerminalSlotContext.Provider value={terminalCommandContext}>
          <TerminalSlotReadContext.Provider value={terminalReadContext}>
            <BranchWorkspace repoId={REPO_ID} />
          </TerminalSlotReadContext.Provider>
        </TerminalSlotContext.Provider>
      </MainWindowNavigationProvider>,
    )

    expect(() => {
      act(() => {
        seedRepoState({ id: REPO_ID, branches: [], statusLoaded: true })
      })
    }).not.toThrow()
    expect(screen.getByText('branches.empty')).toBeTruthy()
  })
})
