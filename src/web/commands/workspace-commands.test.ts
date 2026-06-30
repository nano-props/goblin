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
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  resetTerminalActionDialogsStore,
  useTerminalActionDialogsStore,
} from '#/web/stores/repos/terminal-action-dialogs.ts'
import { preferredWorkspacePaneTabForBranch } from '#/web/stores/repos/workspace-pane-preferences.ts'
import {
  workspacePaneStaticTabsForBranch,
  workspacePaneTabOrderForBranch,
} from '#/web/stores/repos/workspace-pane-tabs.ts'
import { useRepoSyncStore } from '#/web/stores/repo-sync.ts'
import type { PrimaryWindowNavigationActions } from '#/web/primary-window-navigation.tsx'
import type { WorktreeTerminalSnapshot } from '#/web/components/terminal/types.ts'
import type { WorkspacePaneStaticTabType, WorkspacePaneTabOrderEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneStaticTabOrderEntry, workspacePaneTerminalTabOrderEntry } from '#/shared/workspace-pane.ts'

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
  resetTerminalActionDialogsStore()
  useRepoSyncStore.setState({ ready: new Map(), timestamps: new Map() })
})

afterEach(() => {
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
      workspacePaneTabOrderByBranch: { 'feature/worktree': [] },
    })
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => ({
        worktreeTerminalKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        bellCount: 0,
        activeCount: 0,
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
      workspacePaneTabOrderByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => ({
        worktreeTerminalKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        bellCount: 0,
        activeCount: 0,
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
      workspacePaneTabOrderByBranch: { 'feature/worktree': [] },
    })
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => ({
        worktreeTerminalKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        bellCount: 0,
        activeCount: 0,
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
        workspacePaneTabOrderByBranch: { 'feature/worktree': [] },
      })
      setTerminalSessionCommandBridge({
        worktreeSnapshot: () => ({
          worktreeTerminalKey: WORKTREE_KEY,
          selectedDescriptor: null,
          sessions: [],
          count: 0,
          bellCount: 0,
          activeCount: 0,
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
      worktreeSnapshot: () => ({
        worktreeTerminalKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        bellCount: 0,
        activeCount: 0,
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
      worktreeSnapshot: () => ({
        worktreeTerminalKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        bellCount: 0,
        activeCount: 0,
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
      workspacePaneTabOrderByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    const createTerminal = vi.fn(async () => 'session-1')
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => ({
        worktreeTerminalKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [],
        count: 0,
        bellCount: 0,
        activeCount: 0,
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
      workspacePaneTabOrderByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    const createTerminal = vi.fn(async () => 'terminal-new')
    const selectTerminal = vi.fn()
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => ({
        worktreeTerminalKey: WORKTREE_KEY,
        selectedDescriptor: null,
        sessions: [
          {
            type: 'terminal',
            terminalKey: 'session-1',
            worktreeTerminalKey: WORKTREE_KEY,
            sessionId: 'session-1',
            index: 1,
            displayOrder: 1,
            title: 'terminal 1',
            phase: 'open',
            selected: true,
            hasBell: false,
            recentlyActive: false,
          },
          {
            type: 'terminal',
            terminalKey: 'session-2',
            worktreeTerminalKey: WORKTREE_KEY,
            sessionId: 'session-2',
            index: 2,
            displayOrder: 2,
            title: 'terminal 2',
            phase: 'open',
            selected: false,
            hasBell: false,
            recentlyActive: false,
          },
        ],
        count: 2,
        bellCount: 0,
        activeCount: 0,
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
    const createTerminal = vi.fn(async () => 'session-2')
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithTerminal(),
      createTerminal,
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith()

    await runNewTerminalTabCommand({ repoId: REPO_ID, navigation })

    expect(preferredWorkspacePaneTab()).toBe('terminal')
    expect(useReposStore.getState().selectedTerminalKeyByWorktree[WORKTREE_KEY]).toBe('session-2')
    expect(createTerminal).toHaveBeenCalledWith({
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    })
  })

  test('new terminal tab command moves a reused stale terminal id to the end of the tab order', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [terminalEntry('session-1'), staticEntry('status')],
      },
    })
    const createTerminal = vi.fn(async () => 'session-1')
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal,
      selectTerminal: vi.fn(),
    })

    await runNewTerminalTabCommand({ repoId: REPO_ID, navigation: navigationWith() })

    expect(tabOrderFor('feature/worktree')).toEqual([staticEntry('status'), terminalEntry('session-1')])
  })

  test('new terminal tab command catches create failures and shows feedback', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [staticEntry('status')],
      },
    })
    const createTerminal = vi.fn(async () => {
      throw new Error('Terminal socket open timed out')
    })
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => emptyWorktreeSnapshot(),
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
    expect(tabOrderFor('feature/worktree')).toEqual([staticEntry('status')])
  })

  test('new terminal tab command does not steal focus if user changed view during create', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1')],
      },
    })
    const { promise, resolve } = Promise.withResolvers<string>()
    const createTerminal = vi.fn(() => promise)
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithTerminal(),
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

    expect(tabOrderFor('feature/worktree')).toEqual([
      staticEntry('status'),
      terminalEntry('session-1'),
      terminalEntry('session-2'),
    ])
    expect(preferredWorkspacePaneTab()).toBe('status')
    expect(useReposStore.getState().selectedTerminalKeyByWorktree[WORKTREE_KEY]).toBeUndefined()
  })

  test('close workspace tab command closes the selected terminal when terminal is active', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1')],
      },
    })
    const closeTerminalByDescriptor = vi.fn(async () => true)
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithTerminal(),
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
    // Tab removal is owned by the projection's onTerminalSessionRemoved callback, not the command.
    expect(tabOrderFor('feature/worktree')).toEqual([staticEntry('status'), terminalEntry('session-1')])
    expect(closeWindow).not.toHaveBeenCalled()
  })

  test('close workspace tab command asks before closing a terminal with a non-shell foreground process', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1')],
      },
    })
    const closeTerminalByDescriptor = vi.fn(async () => true)
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithTerminal({ processName: 'node' }),
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
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1')],
      },
    })
    const closeTerminalByDescriptor = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithTerminal({ processName: 'node' }),
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
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1')],
        'feature/other': [staticEntry('status')],
      },
    })
    const closeTerminalByDescriptor = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithTerminal({ processName: 'node' }),
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
      terminalKey: 'session-1',
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
          terminalKey: payload.terminalKey,
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
      workspacePaneTabOrderByBranch: {
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
      worktreeSnapshot: () => worktreeSnapshotWithTerminal(),
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
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1'), terminalEntry('session-2')],
      },
    })
    useReposStore.getState().setSelectedTerminal(WORKTREE_KEY, 'session-1')

    let visibleSessionIds = ['session-1', 'session-2']
    const closeResolvers: Array<(value: boolean) => void> = []
    const closeTerminalByDescriptor = vi.fn((key: string) => {
      visibleSessionIds = visibleSessionIds.filter((sessionId) => sessionId !== key)
      useReposStore.getState().setSelectedTerminal(WORKTREE_KEY, visibleSessionIds[0] ?? null)
      return new Promise<boolean>((resolve) => {
        closeResolvers.push(resolve)
      })
    })
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotForSessions(visibleSessionIds),
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
    })
    useReposStore.getState().setSelectedTerminal(WORKTREE_KEY, 'session-2')
    const closeTerminalByDescriptor = vi.fn(async () => true)
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithSecondTerminalSelected(),
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
    })
    const closeWindow = vi.fn()
    const showRepoWorkspacePaneTab = vi.fn((repoId, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, tab)
    })
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithTerminal(),
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
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1'), staticEntry('changes')],
      },
    })
    const closeWindow = vi.fn()
    const showRepoWorkspacePaneTab = vi.fn((repoId, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, tab)
    })
    const selectTerminal = vi.fn()
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithTerminal(),
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
    // Regression: with preferred=terminal and tabOrder=[status, session-1, changes],
    // closing session-1 must land on changes (the spatial neighbor), not
    // status (materializedTabs[0]).
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1'), staticEntry('changes')],
      },
    })
    const closeWindow = vi.fn()
    const showRepoWorkspacePaneTab = vi.fn((repoId, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, tab)
    })
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithTerminal(),
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
      workspacePaneTabOrderByBranch: { 'feature/worktree': [] },
    })
    useRepoSyncStore.getState().markReady(REPO_ID, repo.instanceToken)
    const closeTerminalByDescriptor = vi.fn(async () => true)
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => emptyWorktreeSnapshot(),
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
      workspacePaneTabOrderByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    useRepoSyncStore.getState().markReady(REPO_ID, repo.instanceToken)
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => ({ ...emptyWorktreeSnapshot(), pendingCreate: true }),
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
      workspacePaneTabOrderByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    const closeWindow = vi.fn()
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => emptyWorktreeSnapshot(),
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
      workspacePaneTabOrderByBranch: {
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
      worktreeSnapshot: () => worktreeSnapshotWithTerminal(),
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
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [staticEntry('status')],
      },
    })
    const closeTerminalsForWorktree = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => ({ ...emptyWorktreeSnapshot(), pendingCreate: true }),
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

  test('select workspace pane tab by index follows the mixed tab strip order', () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1'), staticEntry('changes')],
      },
    })
    const selectTerminal = vi.fn()
    const showRepoWorkspacePaneTab = vi.fn((repoId, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, tab)
    })
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithTerminal(),
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
      workspacePaneTabOrderByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    useRepoSyncStore.getState().markReady(REPO_ID, repo.instanceToken)
    const showRepoWorkspacePaneTab = vi.fn((repoId, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, tab)
    })
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => ({ ...emptyWorktreeSnapshot(), pendingCreate: true }),
      createTerminal: vi.fn(async () => 'session-1'),
      selectTerminal: vi.fn(),
    })
    const navigation = navigationWith({ showRepoWorkspacePaneTab })

    expect(runSelectWorkspacePaneTabByIndexCommand({ repoId: REPO_ID, tabIndex: 2, navigation })).toBe(false)

    expect(showRepoWorkspacePaneTab).not.toHaveBeenCalled()
  })

  test('move workspace pane tab command follows the mixed tab strip order', () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabOrderByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('session-1'), staticEntry('changes')],
      },
    })
    const selectTerminal = vi.fn()
    const showRepoWorkspacePaneTab = vi.fn((repoId, tab) => {
      useReposStore.getState().setWorkspacePaneTab(repoId, tab)
    })
    setTerminalSessionCommandBridge({
      worktreeSnapshot: () => worktreeSnapshotWithTerminal(),
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
      workspacePaneTabOrderByBranch: { 'feature/no-worktree': [staticEntry('status'), staticEntry('history')] },
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
  return repo ? preferredWorkspacePaneTabForBranch(repo.ui, repo.ui.selectedBranch) : null
}

function openTabsFor(branch: string) {
  const repo = useReposStore.getState().repos[REPO_ID]
  return repo ? workspacePaneStaticTabsForBranch(repo.ui, branch) : []
}

function tabOrderFor(branch: string): WorkspacePaneTabOrderEntry[] {
  const repo = useReposStore.getState().repos[REPO_ID]
  return repo ? workspacePaneTabOrderForBranch(repo.ui, branch) : []
}

function staticEntry(type: WorkspacePaneStaticTabType) {
  return workspacePaneStaticTabOrderEntry(type)
}

function terminalEntry(id: string) {
  return workspacePaneTerminalTabOrderEntry(id)
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

function worktreeSnapshotWithTerminal(options: { processName?: string } = {}): WorktreeTerminalSnapshot {
  return {
    worktreeTerminalKey: WORKTREE_KEY,
    selectedDescriptor: {
      terminalKey: 'session-1',
      worktreeTerminalKey: WORKTREE_KEY,
      sessionId: 'session-1',
      index: 1,
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    },
    sessions: [
      {
        type: 'terminal',
        terminalKey: 'session-1',
        worktreeTerminalKey: WORKTREE_KEY,
        sessionId: 'session-1',
        index: 1,
        displayOrder: 1,
        title: 'terminal 1',
        fullTitle: 'terminal 1',
        processName: options.processName ?? 'zsh',
        phase: 'open',
        selected: true,
        hasBell: false,
        recentlyActive: false,
      },
    ],
    count: 1,
    bellCount: 0,
    activeCount: 0,
    pendingCreate: false,
  }
}

function emptyWorktreeSnapshot(): WorktreeTerminalSnapshot {
  return {
    worktreeTerminalKey: WORKTREE_KEY,
    selectedDescriptor: null,
    sessions: [],
    count: 0,
    bellCount: 0,
    activeCount: 0,
    pendingCreate: false,
  }
}

function worktreeSnapshotForSessions(sessionIds: string[]): WorktreeTerminalSnapshot {
  const selectedKey = useReposStore.getState().selectedTerminalKeyByWorktree[WORKTREE_KEY] ?? null
  const sessions = sessionIds.map((sessionId, index) => ({
    type: 'terminal' as const,
    terminalKey: sessionId,
    worktreeTerminalKey: WORKTREE_KEY,
    sessionId,
    index: index + 1,
    displayOrder: index + 1,
    title: `terminal ${index + 1}`,
    phase: 'open' as const,
    selected: sessionId === selectedKey,
    hasBell: false,
    recentlyActive: false,
  }))
  const selectedSession = sessions.find((session) => session.terminalKey === selectedKey) ?? null
  return {
    worktreeTerminalKey: WORKTREE_KEY,
    selectedDescriptor: selectedSession
      ? {
          terminalKey: selectedSession.terminalKey,
          worktreeTerminalKey: WORKTREE_KEY,
          sessionId: selectedSession.sessionId,
          index: selectedSession.index,
          repoRoot: REPO_ID,
          branch: 'feature/worktree',
          worktreePath: WORKTREE_PATH,
        }
      : null,
    sessions,
    count: sessions.length,
    bellCount: 0,
    activeCount: 0,
    pendingCreate: false,
  }
}

function worktreeSnapshotWithSecondTerminalSelected(): WorktreeTerminalSnapshot {
  return {
    worktreeTerminalKey: WORKTREE_KEY,
    selectedDescriptor: {
      terminalKey: 'session-2',
      worktreeTerminalKey: WORKTREE_KEY,
      sessionId: 'session-2',
      index: 2,
      repoRoot: REPO_ID,
      branch: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
    },
    sessions: [
      {
        type: 'terminal',
        terminalKey: 'session-1',
        worktreeTerminalKey: WORKTREE_KEY,
        sessionId: 'session-1',
        index: 1,
        displayOrder: 1,
        title: 'terminal 1',
        phase: 'open',
        selected: false,
        hasBell: false,
        recentlyActive: false,
      },
      {
        type: 'terminal',
        terminalKey: 'session-2',
        worktreeTerminalKey: WORKTREE_KEY,
        sessionId: 'session-2',
        index: 2,
        displayOrder: 2,
        title: 'terminal 2',
        phase: 'open',
        selected: true,
        hasBell: false,
        recentlyActive: false,
      },
    ],
    count: 2,
    bellCount: 0,
    activeCount: 0,
    pendingCreate: false,
  }
}
