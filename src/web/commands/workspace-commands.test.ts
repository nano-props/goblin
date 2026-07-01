// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  runCloseWorkspacePaneTabCommand,
  runCloseWorkspacePaneTabOrWindowCommand,
  runConfirmCloseTerminalWorkspacePaneTabCommand,
  runMoveWorkspacePaneTabCommand,
  runNewTerminalTabCommand,
  runSelectWorkspacePaneTabByIndexCommand,
  runShowWorkspacePaneTabCommand,
  runTerminalPrimaryActionCommand,
} from '#/web/commands/workspace-commands.ts'
import { closeWorkspacePaneTabsForWorktree } from '#/web/workspace-pane/workspace-pane-tab-close.ts'
import { setTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import {
  createRepoBranch,
  installWorkspacePaneTabsTestBridge,
  resetReposStore,
  seedRepoState,
} from '#/web/test-utils/bridge.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  resetTerminalActionDialogsStore,
  useTerminalActionDialogsStore,
} from '#/web/stores/repos/terminal-action-dialogs.ts'
import {
  preferredWorkspacePaneTabForTarget,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/repos/workspace-pane-preferences.ts'
import {
  readWorkspacePaneTabsForTarget,
  setWorkspacePaneTabsForTargetQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { workspacePaneStaticTabsFromEntries } from '#/web/workspace-pane/workspace-pane-tabs.ts'
import { useRepoSyncStore } from '#/web/stores/repo-sync.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import type { TerminalWorktreeSnapshot } from '#/web/components/terminal/types.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import type { WorkspacePaneStaticTabType, WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneStaticTabEntry, workspacePaneTerminalTabEntry } from '#/shared/workspace-pane.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: toastMocks.error,
  },
}))

const REPO_ID = '/tmp/gbl-workspace-command-repo'
const WORKTREE_PATH = '/tmp/gbl-workspace-command-worktree'
const WORKTREE_KEY = `${REPO_ID}\0${WORKTREE_PATH}`

beforeEach(() => {
  resetReposStore()
  installWorkspacePaneTabsTestBridge()
  resetTerminalActionDialogsStore()
  useRepoSyncStore.setState({ ready: new Map(), timestamps: new Map() })
})

afterEach(() => {
  setClientBridgeForTests(null)
  setTerminalSessionCommandBridge(null)
  resetTerminalActionDialogsStore()
  toastMocks.error.mockClear()
})

describe('workspace commands', () => {
  test('show workspace pane tab command opens status as a branch static tab when a worktree exists', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/worktree': [] },
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => ({
        terminalWorktreeKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        bellCount: 0,
        outputActiveCount: 0,
        pendingCreate: false,
      }),
      createTerminal: vi.fn(async () => 'session-1'),
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith()

    await expect(runShowWorkspacePaneTabCommand({ repoId: REPO_ID, tab: 'status', navigation })).resolves.toBe(true)
    expect(preferredWorkspacePaneTab()).toBe('status')
    expect(openTabsFor('feature/worktree')).toEqual(['status'])
  })

  test('show workspace pane tab command opens history without routing through status', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => ({
        terminalWorktreeKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        bellCount: 0,
        outputActiveCount: 0,
        pendingCreate: false,
      }),
      createTerminal: vi.fn(async () => 'session-1'),
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith()

    await expect(runShowWorkspacePaneTabCommand({ repoId: REPO_ID, tab: 'history', navigation })).resolves.toBe(true)
    expect(preferredWorkspacePaneTab()).toBe('history')
    expect(openTabsFor('feature/worktree')).toEqual(['status', 'history'])
  })

  test('show workspace pane tab command opens changes as a workspace static tab', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/worktree': [] },
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => ({
        terminalWorktreeKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        bellCount: 0,
        outputActiveCount: 0,
        pendingCreate: false,
      }),
      createTerminal: vi.fn(async () => 'session-1'),
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith()

    await expect(runShowWorkspacePaneTabCommand({ repoId: REPO_ID, tab: 'changes', navigation })).resolves.toBe(true)
    expect(preferredWorkspacePaneTab()).toBe('changes')
    expect(openTabsFor('feature/worktree')).toEqual(['changes'])
  })

  test.each(['status', 'changes'] as const)(
    'show workspace pane tab command refreshes status when opening %s',
    async (tab) => {
      seedRepoState({
        id: REPO_ID,
        branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
        selectedBranch: 'feature/worktree',
        preferredWorkspacePaneTab: 'history',
        workspacePaneTabsByBranch: { 'feature/worktree': [] },
      })
      setTerminalSessionCommandBridge({
        terminalWorktreeSnapshot: () => ({
          terminalWorktreeKey: WORKTREE_KEY,
          selectedDescriptor: null,
          sessions: [],
          count: 0,
          bellCount: 0,
          outputActiveCount: 0,
          pendingCreate: false,
        }),
        createTerminal: vi.fn(async () => 'session-1'),
        selectTerminal: vi.fn(),
      })
      const refreshStatus = vi.fn(async () => {})
      const token = useReposStore.getState().repos[REPO_ID]!.instanceToken
      useReposStore.setState({
        refreshStatus: refreshStatus as ReturnType<typeof useReposStore.getState>['refreshStatus'],
      })

      await expect(
        runShowWorkspacePaneTabCommand({ repoId: REPO_ID, tab, navigation: navigationWith() }),
      ).resolves.toBe(true)

      expect(refreshStatus).toHaveBeenCalledWith(REPO_ID, { token })
    },
  )

  test('show workspace pane tab command keeps the previous tab when changes has no worktree', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      selectedBranch: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => ({
        terminalWorktreeKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        bellCount: 0,
        outputActiveCount: 0,
        pendingCreate: false,
      }),
      createTerminal: vi.fn(async () => 'session-1'),
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith()

    await expect(runShowWorkspacePaneTabCommand({ repoId: REPO_ID, tab: 'changes', navigation })).resolves.toBe(false)
    expect(preferredWorkspacePaneTab()).toBe('terminal')
    expect(openTabsFor('feature/no-worktree')).toEqual(['status'])
  })

  test('show workspace pane tab command opens status for a selected branch without a worktree', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      selectedBranch: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => ({
        terminalWorktreeKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        bellCount: 0,
        outputActiveCount: 0,
        pendingCreate: false,
      }),
      createTerminal: vi.fn(async () => 'session-1'),
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith()

    await expect(runShowWorkspacePaneTabCommand({ repoId: REPO_ID, tab: 'status', navigation })).resolves.toBe(true)
    expect(preferredWorkspacePaneTab()).toBe('status')
  })

  test('terminal primary action opens the terminal tab and creates the first terminal when missing', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    const createTerminal = vi.fn(async () => 'session-1')
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => ({
        terminalWorktreeKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        bellCount: 0,
        outputActiveCount: 0,
        pendingCreate: false,
      }),
      createTerminal,
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith()

    await runTerminalPrimaryActionCommand({ repoId: REPO_ID, navigation })

    expect(preferredWorkspacePaneTab()).toBe('terminal')
    expect(createTerminal).toHaveBeenCalledWith({
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
  })

  test('terminal primary action focuses the first existing terminal instead of creating a new one', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    const createTerminal = vi.fn(async () => 'terminal-new')
    const selectTerminal = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => ({
        terminalWorktreeKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [
          {
            type: 'terminal',
            terminalSessionId: 'session-1',
            terminalWorktreeKey: WORKTREE_KEY,
            index: 1,
            title: 'terminal 1',
            phase: 'open',
            selected: true,
            hasBell: false,
            hasRecentOutput: false,
          },
          {
            type: 'terminal',
            terminalSessionId: 'session-2',
            terminalWorktreeKey: WORKTREE_KEY,
            index: 2,
            title: 'terminal 2',
            phase: 'open',
            selected: false,
            hasBell: false,
            hasRecentOutput: false,
          },
        ],
        count: 2,
        bellCount: 0,
        outputActiveCount: 0,
        pendingCreate: false,
      }),
      createTerminal,
      selectTerminal,
    })
    const navigation = navigationWith()

    await runTerminalPrimaryActionCommand({ repoId: REPO_ID, navigation })

    expect(preferredWorkspacePaneTab()).toBe('terminal')
    expect(createTerminal).not.toHaveBeenCalled()
    expect(selectTerminal).toHaveBeenCalledWith(WORKTREE_KEY, 'session-1')
  })

  test('new terminal tab command creates another terminal even when one already exists', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
    })
    const createTerminal = createTerminalWithProjection(async () => 'session-2')
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal,
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith()

    await runNewTerminalTabCommand({ repoId: REPO_ID, navigation })

    expect(preferredWorkspacePaneTab()).toBe('terminal')
    expect(useReposStore.getState().selectedTerminalSessionIdByTerminalWorktree[WORKTREE_KEY]).toBe('session-2')
    expect(createTerminal).toHaveBeenCalledWith({
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
  })

  test('new terminal tab command keeps a reused terminal id in its existing tab position', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [terminalEntry('session-1'), staticEntry('status')],
      },
    })
    const createTerminal = vi.fn(async () => 'session-1')
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal,
      selectTerminal: vi.fn(),
    })

    await runNewTerminalTabCommand({ repoId: REPO_ID, navigation: navigationWith() })

    expect(tabsFor('feature/worktree')).toEqual([terminalEntry('session-1'), staticEntry('status')])
  })

  test('new terminal tab command catches create failures and shows feedback', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status')],
      },
    })
    const createTerminal = vi.fn(async () => {
      throw new Error('Terminal socket open timed out')
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal,
      selectTerminal: vi.fn(),
    })

    await expect(
      runNewTerminalTabCommand({
        repoId: REPO_ID,
        navigation: navigationWith(),
        t: (key) => key,
      }),
    ).resolves.toBe(false)

    expect(toastMocks.error).toHaveBeenCalledWith('action.result-error', {
      description: 'error.terminal-connection-timeout',
    })
    expect(tabsFor('feature/worktree')).toEqual([staticEntry('status')])
  })

  test('new terminal tab command does not steal focus if user changed view during create', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1')],
      },
    })
    const { promise, resolve } = Promise.withResolvers<string>()
    const createTerminal = createTerminalWithProjection(() => promise)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal,
      selectTerminal: vi.fn(),
    })

    const command = runNewTerminalTabCommand({ repoId: REPO_ID, navigation: navigationWith() })
    await vi.waitFor(() => expect(createTerminal).toHaveBeenCalledTimes(1))

    // Simulate the user clicking a different tab while the create is in flight.
    useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'status')
    expect(preferredWorkspacePaneTab()).toBe('status')

    resolve('session-2')
    await command

    expect(tabsFor('feature/worktree')).toEqual([
      staticEntry('status'),
      terminalEntry('session-1'),
      terminalEntry('session-2'),
    ])
    expect(preferredWorkspacePaneTab()).toBe('status')
    expect(useReposStore.getState().selectedTerminalSessionIdByTerminalWorktree[WORKTREE_KEY]).toBe('session-2')
  })

  test('close workspace tab command closes the selected terminal when terminal is active', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1')],
      },
    })
    const closeTerminalByDescriptor = vi.fn(async () => true)
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'session-2'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({ repoId: REPO_ID, navigation: navigationWith(), closeWindow }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('session-1', {
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
    // Tab removal is owned by the server workspace tab list broadcast, not the command.
    expect(tabsFor('feature/worktree')).toEqual([staticEntry('status'), terminalEntry('session-1')])
    expect(closeWindow).not.toHaveBeenCalled()
  })

  test('close workspace tab command asks before closing a terminal with a non-shell foreground process', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1')],
      },
    })
    const closeTerminalByDescriptor = vi.fn(async () => true)
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal({ processName: 'node' }),
      createTerminal: vi.fn(async () => 'session-2'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({ repoId: REPO_ID, navigation: navigationWith(), closeWindow }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).not.toHaveBeenCalled()
    expect(closeWindow).not.toHaveBeenCalled()
    expect(useTerminalActionDialogsStore.getState().closeConfirm).toMatchObject({
      repoId: REPO_ID,
      targetIdentity: 'terminal:session-1',
      processName: 'node',
    })
  })

  test('close workspace tab command bypasses the terminal process confirmation after confirm', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1')],
      },
    })
    const closeTerminalByDescriptor = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal({ processName: 'node' }),
      createTerminal: vi.fn(async () => 'session-2'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    expect(
      await runCloseWorkspacePaneTabCommand({
        repoId: REPO_ID,
        navigation: navigationWith(),
        targetIdentity: 'terminal:session-1',
        skipTerminalCloseConfirm: true,
      }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('session-1', {
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
    expect(useTerminalActionDialogsStore.getState().closeConfirm).toBeNull()
  })

  test('close workspace tab command confirms against the original terminal when selection changes', async () => {
    const otherWorktreePath = '/tmp/gbl-workspace-command-other-worktree'
    seedRepoState({
      id: REPO_ID,
      branches: [
        createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } }),
        createRepoBranch('feature/other', { worktree: { path: otherWorktreePath } }),
      ],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1')],
        'feature/other': [staticEntry('status')],
      },
    })
    const closeTerminalByDescriptor = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal({ processName: 'node' }),
      createTerminal: vi.fn(async () => 'session-2'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    expect(
      await runCloseWorkspacePaneTabCommand({
        repoId: REPO_ID,
        navigation: navigationWith(),
        targetIdentity: 'terminal:session-1',
      }),
    ).toBe(true)
    const payload = useTerminalActionDialogsStore.getState().closeConfirm
    expect(payload).not.toBeNull()
    if (!payload) throw new Error('expected terminal close confirmation payload')
    expect(payload).toMatchObject({
      repoId: REPO_ID,
      targetIdentity: 'terminal:session-1',
      terminalSessionId: 'session-1',
      terminalBase: {
        repoRoot: REPO_ID,
        branch: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
      },
    })

    useReposStore.getState().selectBranch(REPO_ID, 'feature/other')

    expect(
      await runConfirmCloseTerminalWorkspacePaneTabCommand({
        repoId: payload.repoId,
        navigation: navigationWith(),
        targetIdentity: payload.targetIdentity,
        confirmedTerminal: {
          terminalSessionId: payload.terminalSessionId,
          base: payload.terminalBase,
        },
      }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('session-1', {
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
  })

  test('close workspace tab command commits UI without waiting for terminal resources', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1')],
      },
    })
    let resolveClose!: (value: boolean) => void
    const closeTerminalByDescriptor = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveClose = resolve
        }),
    )
    const closeWindow = vi.fn()
    const showRepoWorkspacePaneTab = vi.fn((repoId, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, tab)
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'session-2'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    let settled = false
    const closePromise = runCloseWorkspacePaneTabOrWindowCommand({
      repoId: REPO_ID,
      navigation: navigationWith({ showRepoWorkspacePaneTab }),
      closeWindow,
    }).then((result) => {
      settled = true
      return result
    })
    await Promise.resolve()

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('session-1', {
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
    await expect(closePromise).resolves.toBe(true)
    expect(settled).toBe(true)
    expect(showRepoWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'status')
    expect(preferredWorkspacePaneTab()).toBe('status')
    expect(closeWindow).not.toHaveBeenCalled()

    resolveClose(true)
    await Promise.resolve()
  })

  test('close workspace tab command reads updated terminal projection between rapid closes', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1'), terminalEntry('session-2')],
      },
    })
    useReposStore.getState().setSelectedTerminal(WORKTREE_KEY, 'session-1')

    let visibleSessionIds = ['session-1', 'session-2']
    const closeResolvers: Array<(value: boolean) => void> = []
    const closeTerminalByDescriptor = vi.fn((terminalSessionId: string) => {
      visibleSessionIds = visibleSessionIds.filter(
        (candidateTerminalSessionId) => candidateTerminalSessionId !== terminalSessionId,
      )
      useReposStore.getState().setSelectedTerminal(WORKTREE_KEY, visibleSessionIds[0] ?? null)
      return new Promise<boolean>((resolve) => {
        closeResolvers.push(resolve)
      })
    })
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotForSessions(visibleSessionIds),
      createTerminal: vi.fn(async () => 'session-3'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    const firstClose = runCloseWorkspacePaneTabOrWindowCommand({
      repoId: REPO_ID,
      navigation: navigationWith(),
      closeWindow,
    })

    const secondClose = runCloseWorkspacePaneTabOrWindowCommand({
      repoId: REPO_ID,
      navigation: navigationWith(),
      closeWindow,
    })
    await expect(firstClose).resolves.toBe(true)
    await expect(secondClose).resolves.toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenNthCalledWith(1, 'session-1', {
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
    expect(closeTerminalByDescriptor).toHaveBeenNthCalledWith(2, 'session-2', {
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
    expect(closeWindow).not.toHaveBeenCalled()

    closeResolvers.forEach((resolve) => resolve(true))
    await Promise.resolve()
  })

  test('close workspace tab command closes the selected terminal when it is not the first terminal', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1'), terminalEntry('session-2')],
      },
    })
    useReposStore.getState().setSelectedTerminal(WORKTREE_KEY, 'session-2')
    const closeTerminalByDescriptor = vi.fn(async () => true)
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithSecondTerminalSelected(),
      createTerminal: vi.fn(async () => 'session-3'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({ repoId: REPO_ID, navigation: navigationWith(), closeWindow }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('session-2', {
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
    expect(closeWindow).not.toHaveBeenCalled()
  })

  test('close workspace tab command closes the selected status tab without closing the window', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1')],
      },
    })
    const closeWindow = vi.fn()
    const showRepoWorkspacePaneTab = vi.fn((repoId, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, tab)
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'session-2'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        repoId: REPO_ID,
        navigation: navigationWith({ showRepoWorkspacePaneTab }),
        closeWindow,
      }),
    ).toBe(true)
    expect(openTabsFor('feature/worktree')).toEqual([])
    expect(showRepoWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'terminal')
    expect(preferredWorkspacePaneTab()).toBe('terminal')
    expect(closeWindow).not.toHaveBeenCalled()
  })

  test('close workspace tab command closes changes as a static tab and lands on the adjacent terminal', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'changes',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1'), staticEntry('changes')],
      },
    })
    const closeWindow = vi.fn()
    const showRepoWorkspacePaneTab = vi.fn((repoId, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, tab)
    })
    const selectTerminal = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'session-2'),
      selectTerminal,
      closeTerminalByDescriptor: vi.fn(async () => true),
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        repoId: REPO_ID,
        navigation: navigationWith({ showRepoWorkspacePaneTab }),
        closeWindow,
      }),
    ).toBe(true)
    expect(openTabsFor('feature/worktree')).toEqual(['status'])
    expect(showRepoWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'terminal')
    expect(selectTerminal).toHaveBeenCalledWith(WORKTREE_KEY, 'session-1')
    expect(preferredWorkspacePaneTab()).toBe('terminal')
    expect(closeWindow).not.toHaveBeenCalled()
  })

  test('close workspace tab command on the only terminal in a mixed strip lands on the spatial neighbor', async () => {
    // Regression: with preferred=terminal and tabs=[status, session-1, changes],
    // closing session-1 must land on changes (the spatial neighbor), not
    // status (materializedTabs[0]).
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1'), staticEntry('changes')],
      },
    })
    const closeWindow = vi.fn()
    const showRepoWorkspacePaneTab = vi.fn((repoId, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, tab)
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'session-2'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({
        repoId: REPO_ID,
        navigation: navigationWith({ showRepoWorkspacePaneTab }),
        closeWindow,
        targetIdentity: 'terminal:session-1',
      }),
    ).toBe(true)
    expect(showRepoWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'changes')
    expect(preferredWorkspacePaneTab()).toBe('changes')
    expect(closeWindow).not.toHaveBeenCalled()
  })

  test('close workspace tab command falls back to closing the window when no workspace tab is selected', async () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/worktree': [] },
    })
    useRepoSyncStore.getState().markReady(REPO_ID, repo.instanceToken)
    const closeTerminalByDescriptor = vi.fn(async () => true)
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'session-1'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({ repoId: REPO_ID, navigation: navigationWith(), closeWindow }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).not.toHaveBeenCalled()
    expect(closeWindow).toHaveBeenCalledTimes(1)
  })

  test('close workspace tab command does not close the window while the terminal host is pending', async () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    useRepoSyncStore.getState().markReady(REPO_ID, repo.instanceToken)
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => ({ ...emptyWorktreeSnapshot(), pendingCreate: true }),
      createTerminal: vi.fn(async () => 'session-1'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({ repoId: REPO_ID, navigation: navigationWith(), closeWindow }),
    ).toBe(true)

    expect(closeWindow).not.toHaveBeenCalled()
    expect(preferredWorkspacePaneTab()).toBe('terminal')
    expect(openTabsFor('feature/worktree')).toEqual(['status'])
  })

  test('close workspace tab command does not close the window while terminal sync is unresolved', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'session-1'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
    })

    expect(
      await runCloseWorkspacePaneTabOrWindowCommand({ repoId: REPO_ID, navigation: navigationWith(), closeWindow }),
    ).toBe(true)

    expect(closeWindow).not.toHaveBeenCalled()
    expect(preferredWorkspacePaneTab()).toBe('terminal')
    expect(openTabsFor('feature/worktree')).toEqual(['status'])
  })

  test('close workspace tabs for worktree closes worktree-scoped tabs only', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [
          staticEntry('status'),
          terminalEntry('session-1'),
          staticEntry('changes'),
          staticEntry('history'),
        ],
      },
    })
    const closeTerminalsForWorktree = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'session-2'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
      closeTerminalsForWorktree,
    })

    await expect(
      closeWorkspacePaneTabsForWorktree({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
      }),
    ).resolves.toBe(true)

    expect(closeTerminalsForWorktree).toHaveBeenCalledWith({
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
    expect(openTabsFor('feature/worktree')).toEqual(['status', 'history'])
  })

  test('close workspace tabs for worktree releases pending terminal resources even without a terminal tab', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status')],
      },
    })
    const closeTerminalsForWorktree = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => ({ ...emptyWorktreeSnapshot(), pendingCreate: true }),
      createTerminal: vi.fn(async () => 'session-1'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
      closeTerminalsForWorktree,
    })

    await expect(
      closeWorkspacePaneTabsForWorktree({
        repoId: REPO_ID,
        branchName: 'feature/worktree',
        worktreePath: WORKTREE_PATH,
      }),
    ).resolves.toBe(true)

    expect(closeTerminalsForWorktree).toHaveBeenCalledWith({
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
    expect(openTabsFor('feature/worktree')).toEqual(['status'])
  })

  test('select workspace pane tab by index follows the mixed mixed tab list', () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1'), staticEntry('changes')],
      },
    })
    const selectTerminal = vi.fn()
    const showRepoWorkspacePaneTab = vi.fn((repoId, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, tab)
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'session-2'),
      selectTerminal,
    })
    const navigation = navigationWith({ showRepoWorkspacePaneTab })

    expect(runSelectWorkspacePaneTabByIndexCommand({ repoId: REPO_ID, tabIndex: 2, navigation })).toBe(true)
    expect(runSelectWorkspacePaneTabByIndexCommand({ repoId: REPO_ID, tabIndex: 3, navigation })).toBe(true)

    expect(showRepoWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'terminal')
    expect(showRepoWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'changes')
    expect(selectTerminal).toHaveBeenCalledWith(WORKTREE_KEY, 'session-1')
  })

  test('select workspace pane tab by index ignores a pending terminal tab', () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    useRepoSyncStore.getState().markReady(REPO_ID, repo.instanceToken)
    const showRepoWorkspacePaneTab = vi.fn((repoId, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, tab)
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => ({ ...emptyWorktreeSnapshot(), pendingCreate: true }),
      createTerminal: vi.fn(async () => 'session-1'),
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith({ showRepoWorkspacePaneTab })

    expect(runSelectWorkspacePaneTabByIndexCommand({ repoId: REPO_ID, tabIndex: 2, navigation })).toBe(false)

    expect(showRepoWorkspacePaneTab).not.toHaveBeenCalled()
  })

  test('move workspace pane tab command follows the mixed mixed tab list', () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1'), staticEntry('changes')],
      },
    })
    const selectTerminal = vi.fn()
    const showRepoWorkspacePaneTab = vi.fn((repoId, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, tab)
    })
    setTerminalSessionCommandBridge({
      terminalWorktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal: vi.fn(async () => 'session-2'),
      selectTerminal,
    })
    const navigation = navigationWith({ showRepoWorkspacePaneTab })

    expect(runMoveWorkspacePaneTabCommand({ repoId: REPO_ID, direction: 1, navigation })).toBe(true)
    expect(runMoveWorkspacePaneTabCommand({ repoId: REPO_ID, direction: 1, navigation })).toBe(true)

    expect(showRepoWorkspacePaneTab).toHaveBeenNthCalledWith(1, REPO_ID, 'terminal')
    expect(showRepoWorkspacePaneTab).toHaveBeenNthCalledWith(2, REPO_ID, 'changes')
    expect(selectTerminal).toHaveBeenCalledWith(WORKTREE_KEY, 'session-1')
  })

  test('move workspace pane tab command works for branch-scope tabs without a worktree', () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/no-worktree')],
      selectedBranch: 'feature/no-worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: { 'feature/no-worktree': [staticEntry('status'), staticEntry('history')] },
    })
    const showRepoWorkspacePaneTab = vi.fn((repoId, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, tab)
    })
    const navigation = navigationWith({ showRepoWorkspacePaneTab })

    expect(runMoveWorkspacePaneTabCommand({ repoId: REPO_ID, direction: 1, navigation })).toBe(true)

    expect(showRepoWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'history')
    expect(preferredWorkspacePaneTab()).toBe('history')
  })
})

function preferredWorkspacePaneTab() {
  const repo = useReposStore.getState().repos[REPO_ID]
  return repo
    ? preferredWorkspacePaneTabForTarget(repo.ui, workspacePaneTabsTargetForRepoBranch(repo, repo.ui.selectedBranch))
    : null
}

function openTabsFor(branch: string) {
  return workspacePaneStaticTabsFromEntries(tabsFor(branch))
}

function tabsFor(branch: string): WorkspacePaneTabEntry[] {
  const repo = useReposStore.getState().repos[REPO_ID]
  const target = repo ? workspacePaneTabsTargetForRepoBranch(repo, branch) : null
  return target ? readWorkspacePaneTabsForTarget(target) : []
}

function createTerminalWithProjection(resolveSessionId: () => string | Promise<string>) {
  return vi.fn(async (base: TerminalSessionBase) => {
    const terminalSessionId = await resolveSessionId()
    const currentTabs = readWorkspacePaneTabsForTarget({
      repoRoot: base.repoRoot,
      branchName: base.branch,
      worktreePath: base.worktreePath,
    })
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: base.repoRoot,
      branchName: base.branch,
      worktreePath: base.worktreePath,
      tabs: [...currentTabs, terminalEntry(terminalSessionId)],
    })
    useReposStore
      .getState()
      .setSelectedTerminal(formatTerminalWorktreeKey(base.repoRoot, base.worktreePath), terminalSessionId)
    return terminalSessionId
  })
}

function staticEntry(type: WorkspacePaneStaticTabType) {
  return workspacePaneStaticTabEntry(type)
}

function terminalEntry(id: string) {
  return workspacePaneTerminalTabEntry(id)
}

function navigationWith(overrides: Partial<PrimaryWindowNavigationActions> = {}): PrimaryWindowNavigationActions {
  return {
    activateRepo: (repoId) => useReposStore.getState().setActive(repoId),
    closeRepo: () => {},
    cycleRepo: () => {},
    selectRepoBranch: () => {},
    showRepoWorkspacePaneTab: (repoId, tab) => {
      const state = useReposStore.getState()
      state.setActive(repoId)
      state.setWorkspacePaneTab(repoId, tab)
    },
    showRepoBranchWorkspacePaneTab: (repoId, branch, tab) => {
      const state = useReposStore.getState()
      state.setActive(repoId)
      state.selectBranch(repoId, branch)
      state.setWorkspacePaneTab(repoId, tab)
    },
    openSettings: () => {},
    ...overrides,
  }
}

function worktreeSnapshotWithTerminal(options: { processName?: string } = {}): TerminalWorktreeSnapshot {
  return {
    terminalWorktreeKey: WORKTREE_KEY,
    selectedDescriptor: {
      terminalSessionId: 'session-1',
      terminalWorktreeKey: WORKTREE_KEY,
      index: 1,
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    },
    sessions: [
      {
        type: 'terminal',
        terminalSessionId: 'session-1',
        terminalWorktreeKey: WORKTREE_KEY,
        index: 1,
        title: 'terminal 1',
        fullTitle: 'terminal 1',
        processName: options.processName ?? 'zsh',
        phase: 'open',
        selected: true,
        hasBell: false,
        hasRecentOutput: false,
      },
    ],
    count: 1,
    bellCount: 0,
    outputActiveCount: 0,
    pendingCreate: false,
  }
}

function emptyWorktreeSnapshot(): TerminalWorktreeSnapshot {
  return {
    terminalWorktreeKey: WORKTREE_KEY,
    selectedDescriptor: null,
    sessions: [],
    count: 0,
    bellCount: 0,
    outputActiveCount: 0,
    pendingCreate: false,
  }
}

function worktreeSnapshotForSessions(terminalSessionIds: string[]): TerminalWorktreeSnapshot {
  const selectedKey = useReposStore.getState().selectedTerminalSessionIdByTerminalWorktree[WORKTREE_KEY] ?? null
  const sessions = terminalSessionIds.map((terminalSessionId, index) => ({
    type: 'terminal' as const,
    terminalSessionId: terminalSessionId,
    terminalWorktreeKey: WORKTREE_KEY,
    index: index + 1,
    title: `terminal ${index + 1}`,
    phase: 'open' as const,
    selected: terminalSessionId === selectedKey,
    hasBell: false,
    hasRecentOutput: false,
  }))
  const selectedSession = sessions.find((session) => session.terminalSessionId === selectedKey) ?? null
  return {
    terminalWorktreeKey: WORKTREE_KEY,
    selectedDescriptor: selectedSession
      ? {
          terminalSessionId: selectedSession.terminalSessionId,
          terminalWorktreeKey: WORKTREE_KEY,
          index: selectedSession.index,
          repoRoot: REPO_ID,
          branch: 'feature/worktree',
          worktreePath: WORKTREE_PATH,
        }
      : null,
    sessions,
    count: sessions.length,
    bellCount: 0,
    outputActiveCount: 0,
    pendingCreate: false,
  }
}

function worktreeSnapshotWithSecondTerminalSelected(): TerminalWorktreeSnapshot {
  return {
    terminalWorktreeKey: WORKTREE_KEY,
    selectedDescriptor: {
      terminalSessionId: 'session-2',
      terminalWorktreeKey: WORKTREE_KEY,
      index: 2,
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    },
    sessions: [
      {
        type: 'terminal',
        terminalSessionId: 'session-1',
        terminalWorktreeKey: WORKTREE_KEY,
        index: 1,
        title: 'terminal 1',
        phase: 'open',
        selected: false,
        hasBell: false,
        hasRecentOutput: false,
      },
      {
        type: 'terminal',
        terminalSessionId: 'session-2',
        terminalWorktreeKey: WORKTREE_KEY,
        index: 2,
        title: 'terminal 2',
        phase: 'open',
        selected: true,
        hasBell: false,
        hasRecentOutput: false,
      },
    ],
    count: 2,
    bellCount: 0,
    outputActiveCount: 0,
    pendingCreate: false,
  }
}
