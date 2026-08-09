// @vitest-environment jsdom

import {
  seedRepoQueryDataForTest,
  seedRepoWithReadModelForTest,
  createBranchSnapshot,
} from '#/web/test-utils/repo-store.ts'
import { describe, expect, test, vi } from 'vitest'
import '#/web/test-utils/workspace-commands.ts'
import {
  runCloseWorkspacePaneTabCommand as runCloseWorkspacePaneTabCommandRaw,
  runConfirmCloseTerminalWorkspacePaneTabCommand,
} from '#/web/commands/workspace-commands.ts'
import { setTerminalSessionCommandBridgeWithCreatedAdmissionForTest as setTerminalSessionCommandBridge } from '#/web/test-utils/terminal-session-command-bridge.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { terminalActionDialogsStore } from '#/web/stores/workspaces/terminal-action-dialogs.ts'
import { preferredWorkspacePaneTabForTarget } from '#/web/stores/workspaces/workspace-pane-preferences.ts'
import { readWorkspacePaneTabsForTarget } from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/test-utils/workspace-pane-tabs.ts'
import { terminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import type { TerminalSessionBase } from '#/shared/terminal-types.ts'
import { workspacePaneStaticTabEntry as staticEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabOpener } from '#/web/workspace-pane/workspace-pane-tab-opener.ts'
import { seedInitialObservedWorkspacePaneRouteForTest } from '#/web/test-utils/workspace-pane-navigation.ts'
import type { WorkspacePaneCommandTarget } from '#/web/workspace-pane/workspace-pane-command-target.ts'
import {
  REPO_ID,
  WORKTREE_KEY,
  WORKTREE_PANE_TARGET,
  WORKTREE_PATH,
  emptyWorktreeSnapshot,
  expectedTerminalBase,
  filesystemTargetForTest,
  navigationWith,
  openTabsFor,
  preferredWorkspacePaneTab,
  recordCreatedTerminalSelection,
  runCloseCurrentWorkspacePaneTabCommand,
  runCloseWorkspacePaneTabCommand,
  runNewTerminalTabCommand,
  runShowWorkspacePaneTabCommand,
  terminalEntry,
  worktreeSnapshotForSessions,
  worktreeSnapshotWithSecondTerminalSelected,
  worktreeSnapshotWithTerminal,
  workspaceRuntimeIdForTest,
} from '#/web/test-utils/workspace-commands.ts'

describe('workspace commands close', () => {
  test('close workspace tab command returns from files to status when files was opened from the status route', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/worktree', {
          worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false },
        }),
      ],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status')],
      },
    })
    const showRepoBranchWorkspacePaneTab = vi.fn((workspaceId, branch, tab) => {
      workspacesStore.getState().setWorkspacePaneTab(workspaceId, branch, tab)
      return true
    })
    const showRepoBranchEmptyWorkspacePane = vi.fn(() => true)
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab, showRepoBranchEmptyWorkspacePane })

    expect(
      await runShowWorkspacePaneTabCommand({
        workspacePaneRoute: { kind: 'static', tab: 'status' },
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        tab: 'files',
        navigation,
      }),
    ).toBe(true)
    expect(workspacePaneTabOpener(WORKTREE_PANE_TARGET, workspaceRuntimeIdForTest(), 'workspace-pane:files')).toBe(
      'workspace-pane:status',
    )
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenLastCalledWith(REPO_ID, 'feature/worktree', 'files')
    showRepoBranchWorkspacePaneTab.mockClear()

    expect(
      await runCloseWorkspacePaneTabCommand({
        workspacePaneRoute: { kind: 'static', tab: 'files' },
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        targetIdentity: 'workspace-pane:files',
        navigation,
      }),
    ).toBe(true)

    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/worktree', 'status')
    expect(showRepoBranchEmptyWorkspacePane).not.toHaveBeenCalled()
    expect(preferredWorkspacePaneTab('feature/worktree')).toBe('status')
  })

  test('close workspace tab command does nothing when the target projection is unavailable', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [],
      currentBranchName: 'feature/query',
      preferredWorkspacePaneTab: 'status',
    })
    seedRepoQueryDataForTest(repo, {
      branches: [
        createBranchSnapshot('feature/query', { worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false } }),
      ],
      currentBranch: 'feature/query',
    })
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
    })
    const presentationEffects = { onCommit: vi.fn(), onAbandon: vi.fn() }

    await expect(
      runCloseCurrentWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/query',
        navigation: navigationWith(),
        presentationEffects,
      }),
    ).resolves.toBe(false)
    expect(presentationEffects.onCommit).not.toHaveBeenCalled()
    expect(presentationEffects.onAbandon).toHaveBeenCalledOnce()
  })

  test('abandons close presentation and propagates an unexpected command failure', async () => {
    const unexpected = new Error('simulated command coordinate failure')
    const target: WorkspacePaneCommandTarget = {
      routeTarget: { kind: 'git-branch', workspaceId: REPO_ID, branchName: 'feature/failure' },
      workspacePaneRoute: undefined,
      get filesystemTarget(): null {
        throw unexpected
      },
    }
    const presentationEffects = { onCommit: vi.fn(), onAbandon: vi.fn() }

    await expect(
      runCloseWorkspacePaneTabCommandRaw({
        workspaceId: REPO_ID,
        target,
        navigation: navigationWith(),
        presentationEffects,
      }),
    ).rejects.toBe(unexpected)

    expect(presentationEffects.onCommit).not.toHaveBeenCalled()
    expect(presentationEffects.onAbandon).toHaveBeenCalledOnce()
  })

  test('close workspace tab command asks before closing a terminal with a non-shell foreground process', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/worktree', {
          worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false },
        }),
      ],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry('term-111111111111111111111')],
      },
    })
    const closeTerminalByDescriptor = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => worktreeSnapshotWithTerminal({ processName: 'node' }),
      createTerminal: vi.fn(async () => 'term-222222222222222222222'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    const workspacePaneRoute = { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' } as const
    const presentationEffects = { onCommit: vi.fn(), onAbandon: vi.fn() }

    expect(
      await runCloseCurrentWorkspacePaneTabCommand({
        workspacePaneRoute,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        presentationEffects,
      }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).not.toHaveBeenCalled()
    expect(presentationEffects.onCommit).not.toHaveBeenCalled()
    expect(presentationEffects.onAbandon).not.toHaveBeenCalled()
    expect(terminalActionDialogsStore.getState().closeConfirm).toMatchObject({
      workspaceId: REPO_ID,
      targetIdentity: 'terminal:term-111111111111111111111',
      workspacePaneRoute,
      processName: 'node',
    })
    terminalActionDialogsStore.getState().closeCloseConfirm()
    expect(presentationEffects.onCommit).not.toHaveBeenCalled()
    expect(presentationEffects.onAbandon).toHaveBeenCalledOnce()
  })

  test('close workspace tab confirm does not navigate when the user has switched away from the original route', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/worktree', {
          worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false },
        }),
      ],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [
          staticEntry('status'),
          terminalEntry('term-111111111111111111111'),
          staticEntry('history'),
        ],
      },
    })
    const closeTerminalByDescriptor = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => worktreeSnapshotWithTerminal({ processName: 'node' }),
      createTerminal: vi.fn(async () => 'term-222222222222222222222'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    const workspacePaneRoute = { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' } as const
    const presentationEffects = { onCommit: vi.fn(), onAbandon: vi.fn() }
    expect(
      await runCloseWorkspacePaneTabCommand({
        workspacePaneRoute,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        targetIdentity: 'terminal:term-111111111111111111111',
        presentationEffects,
      }),
    ).toBe(true)
    expect(presentationEffects.onCommit).not.toHaveBeenCalled()
    expect(presentationEffects.onAbandon).not.toHaveBeenCalled()
    const payload = terminalActionDialogsStore.getState().takeCloseConfirm()
    if (!payload) throw new Error('expected terminal close confirmation payload')
    const showRepoBranchWorkspacePaneTab = vi.fn((workspaceId, branch, tab) => {
      workspacesStore.getState().setWorkspacePaneTab(workspaceId, branch, tab)
      return true
    })

    expect(
      await runConfirmCloseTerminalWorkspacePaneTabCommand({
        workspacePaneRoute: payload.workspacePaneRoute,
        routeTarget: payload.routeTarget,
        workspaceId: payload.workspaceId,
        currentWorkspacePaneRoute: { kind: 'static', tab: 'status' },
        navigation: navigationWith({ showRepoBranchWorkspacePaneTab }),
        targetIdentity: payload.targetIdentity,
        selectedIdentity: payload.selectedIdentity,
        confirmedTerminal: {
          terminalSessionId: payload.terminalSessionId,
          base: payload.terminalBase,
        },
        ...(payload.presentationEffects ? { presentationEffects: payload.presentationEffects } : {}),
      }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('term-111111111111111111111', expectedTerminalBase())
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
    expect(presentationEffects.onCommit).toHaveBeenCalledOnce()
    expect(presentationEffects.onAbandon).not.toHaveBeenCalled()
  })

  test('close workspace tab command uses each committed snapshot between rapid closes', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/worktree', {
          worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false },
        }),
      ],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [
          staticEntry('status'),
          terminalEntry('term-111111111111111111111'),
          terminalEntry('term-222222222222222222222'),
        ],
      },
    })
    workspacesStore.getState().setSelectedTerminal(WORKTREE_KEY, 'term-111111111111111111111')

    let visibleSessionIds = ['term-111111111111111111111', 'term-222222222222222222222']
    const closeResolvers: Array<(value: boolean) => void> = []
    const closeTerminalByDescriptor = vi.fn((terminalSessionId: string) => {
      return new Promise<boolean>((resolve) => {
        closeResolvers.push((value) => {
          if (value) {
            visibleSessionIds = visibleSessionIds.filter(
              (candidateTerminalSessionId) => candidateTerminalSessionId !== terminalSessionId,
            )
            setWorkspacePaneTabsForTargetQueryData({
              workspaceId: REPO_ID,
              workspaceRuntimeId: workspaceRuntimeIdForTest(),
              branchName: 'feature/worktree',
              worktreePath: WORKTREE_PATH,
              tabs: [staticEntry('status'), ...visibleSessionIds.map(terminalEntry)],
            })
            workspacesStore.getState().setSelectedTerminal(WORKTREE_KEY, visibleSessionIds[0] ?? null)
          }
          resolve(value)
        })
      })
    })
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => worktreeSnapshotForSessions(visibleSessionIds),
      createTerminal: vi.fn(async () => 'term-333333333333333333333'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    const showRepoBranchTerminalSession = vi.fn(() => true)
    const showRepoBranchWorkspacePaneTab = vi.fn(() => true)
    const navigation = navigationWith({ showRepoBranchTerminalSession, showRepoBranchWorkspacePaneTab })

    const firstClose = runCloseCurrentWorkspacePaneTabCommand({
      workspacePaneRoute: { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      navigation,
    })

    const secondClose = runCloseCurrentWorkspacePaneTabCommand({
      workspacePaneRoute: { kind: 'terminal', terminalSessionId: 'term-111111111111111111111' },
      workspaceId: REPO_ID,
      branchName: 'feature/worktree',
      navigation,
    })
    await Promise.resolve()

    expect(closeTerminalByDescriptor).toHaveBeenNthCalledWith(1, 'term-111111111111111111111', expectedTerminalBase())
    expect(closeTerminalByDescriptor).toHaveBeenCalledOnce()

    closeResolvers[0]?.(true)
    await expect(firstClose).resolves.toBe(true)
    expect(showRepoBranchTerminalSession).toHaveBeenCalledWith(
      REPO_ID,
      'feature/worktree',
      'term-222222222222222222222',
    )
    expect(closeTerminalByDescriptor).toHaveBeenNthCalledWith(2, 'term-222222222222222222222', expectedTerminalBase())
    closeResolvers[1]?.(true)
    await expect(secondClose).resolves.toBe(true)
    expect(showRepoBranchWorkspacePaneTab).toHaveBeenCalledWith(REPO_ID, 'feature/worktree', 'status')
  })

  test('close workspace tab command closes the selected terminal when it is not the first terminal', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/worktree', {
          worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false },
        }),
      ],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [
          staticEntry('status'),
          terminalEntry('term-111111111111111111111'),
          terminalEntry('term-222222222222222222222'),
        ],
      },
    })
    workspacesStore.getState().setSelectedTerminal(WORKTREE_KEY, 'term-222222222222222222222')
    const closeTerminalByDescriptor = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => worktreeSnapshotWithSecondTerminalSelected(),
      createTerminal: vi.fn(async () => 'term-333333333333333333333'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    expect(
      await runCloseCurrentWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
      }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith('term-222222222222222222222', expectedTerminalBase())
  })

  test.each(['status', 'files'] as const)(
    'reopens a closed workspace-root %s tab through the shared open transaction',
    async (tabType) => {
      const repo = seedRepoWithReadModelForTest({ id: REPO_ID, branchSnapshots: [], currentBranchName: null })
      const target = {
        kind: 'workspace-root' as const,
        workspaceId: REPO_ID,
        workspaceRuntimeId: repo.workspaceRuntimeId,
      }
      setWorkspacePaneTabsForTargetQueryData({ ...target, tabs: [staticEntry('status'), staticEntry('files')] })
      workspacesStore.getState().setWorkspacePaneTabForTarget(target, tabType)
      const navigation = navigationWith()

      await expect(
        runCloseWorkspacePaneTabCommand({
          workspacePaneRoute: undefined,
          workspaceId: REPO_ID,
          branchName: null,
          navigation,
          targetIdentity: `workspace-pane:${tabType}`,
        }),
      ).resolves.toBe(true)
      const remainingType = tabType === 'status' ? 'files' : 'status'
      expect(readWorkspacePaneTabsForTarget(target).map((tab) => tab.type)).toEqual([remainingType])

      await expect(
        runShowWorkspacePaneTabCommand({
          workspacePaneRoute: null,
          workspaceId: REPO_ID,
          branchName: null,
          tab: tabType,
          navigation,
        }),
      ).resolves.toBe(true)
      expect(readWorkspacePaneTabsForTarget(target).map((tab) => tab.type)).toEqual([remainingType, tabType])
      expect(
        preferredWorkspacePaneTabForTarget(workspacesStore.getState().workspaces[REPO_ID]!.ui, {
          kind: 'workspace-root',
          workspaceId: REPO_ID,
        }),
      ).toBe(tabType)
    },
  )

  test('close workspace tab command ignores the opener when closing a background (non-active) tab', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/worktree', {
          worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false },
        }),
      ],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), staticEntry('changes')],
      },
    })
    let visibleSessionIds: string[] = []
    const createTerminal = vi.fn(async (base: TerminalSessionBase) => {
      const terminalSessionId = 'term-111111111111111111111'
      recordCreatedTerminalSelection(base, terminalSessionId)
      visibleSessionIds = [...visibleSessionIds, terminalSessionId]
      return terminalSessionId
    })
    const closeTerminalByDescriptor = vi.fn((terminalSessionId: string) => {
      visibleSessionIds = visibleSessionIds.filter((id) => id !== terminalSessionId)
      return Promise.resolve(true)
    })
    const showRepoBranchWorkspacePaneTab = vi.fn((workspaceId, branch, tab) => {
      workspacesStore.getState().setWorkspacePaneTab(workspaceId, branch, tab)
      return true
    })
    const showRepoBranchTerminalSession = vi.fn(() => true)
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => worktreeSnapshotForSessions(visibleSessionIds),
      createTerminal,
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })
    const navigation = navigationWith({ showRepoBranchWorkspacePaneTab, showRepoBranchTerminalSession })

    // Opens a new terminal from "status" (its opener becomes "status"), then
    // the user navigates away to "changes" before closing the terminal.
    expect(
      await runNewTerminalTabCommand({
        filesystemTarget: filesystemTargetForTest(),
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation,
      }),
    ).toBe(true)
    navigation.showRepoBranchWorkspacePaneTab(REPO_ID, 'feature/worktree', 'changes')
    seedInitialObservedWorkspacePaneRouteForTest({
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      route: { kind: 'static', tab: 'changes' },
    })
    expect(preferredWorkspacePaneTab()).toBe('changes')
    showRepoBranchWorkspacePaneTab.mockClear()

    // Closing the (now background) terminal must not force-navigate back to
    // its opener — the opener only matters when the closing tab was active.
    expect(
      await runCloseWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation,
        targetIdentity: 'terminal:term-111111111111111111111',
      }),
    ).toBe(true)
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
    expect(preferredWorkspacePaneTab()).toBe('changes')
  })

  test('close workspace tab command does not close a persisted active tab on a bare branch route', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/worktree', {
          worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false },
        }),
      ],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), staticEntry('history')],
      },
    })
    seedInitialObservedWorkspacePaneRouteForTest({
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      route: null,
    })

    expect(
      await runCloseCurrentWorkspacePaneTabCommand({
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        workspacePaneRoute: null,
        navigation: navigationWith({}, { autoSeedInitialRoute: false }),
      }),
    ).toBe(false)

    expect(openTabsFor('feature/worktree')).toEqual(['status', 'history'])
    expect(preferredWorkspacePaneTab()).toBe('status')
  })

  test('close workspace tab command keeps a targeted close on a bare branch route from activating another tab', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/worktree', {
          worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false },
        }),
      ],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), staticEntry('history')],
      },
    })
    const showRepoBranchWorkspacePaneTab = vi.fn((workspaceId, branch, tab) => {
      workspacesStore.getState().setWorkspacePaneTab(workspaceId, branch, tab)
      return true
    })
    seedInitialObservedWorkspacePaneRouteForTest({
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      route: null,
    })

    expect(
      await runCloseWorkspacePaneTabCommand({
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        workspacePaneRoute: null,
        navigation: navigationWith({ showRepoBranchWorkspacePaneTab }, { autoSeedInitialRoute: false }),
        targetIdentity: 'workspace-pane:status',
      }),
    ).toBe(true)

    expect(openTabsFor('feature/worktree')).toEqual(['history'])
    expect(showRepoBranchWorkspacePaneTab).not.toHaveBeenCalled()
    expect(preferredWorkspacePaneTab()).toBe('status')
  })

  test('close workspace tab command does nothing when a targeted tab identity is already gone', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/worktree', {
          worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false },
        }),
      ],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'status',
      workspacePaneTabsByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
    })

    expect(
      await runCloseWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        targetIdentity: 'terminal:missing-session',
      }),
    ).toBe(false)

    expect(openTabsFor('feature/worktree')).toEqual(['status'])
  })

  test('close workspace tab command does nothing while the terminal host is pending', async () => {
    const repo = seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/worktree', {
          worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false },
        }),
      ],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: { 'feature/worktree': [staticEntry('status')] },
    })
    terminalProjectionHydrationStore.getState().markProjectionReady(REPO_ID, repo.workspaceRuntimeId)
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => ({ ...emptyWorktreeSnapshot(), createPending: true }),
      createTerminal: vi.fn(async () => 'term-111111111111111111111'),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor: vi.fn(async () => true),
    })
    const presentationEffects = { onCommit: vi.fn(), onAbandon: vi.fn() }

    expect(
      await runCloseCurrentWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
        presentationEffects,
      }),
    ).toBe(true)

    expect(preferredWorkspacePaneTab()).toBe('terminal')
    expect(openTabsFor('feature/worktree')).toEqual(['status'])
    expect(presentationEffects.onCommit).not.toHaveBeenCalled()
    expect(presentationEffects.onAbandon).toHaveBeenCalledOnce()
  })

  test('close workspace tab command closes the selected canonical terminal while its live view is pending', async () => {
    const terminalSessionId = 'term-111111111111111111111'
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branchSnapshots: [
        createBranchSnapshot('feature/worktree', {
          worktree: { path: WORKTREE_PATH, isPrimary: false, isLocked: false },
        }),
      ],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [staticEntry('status'), terminalEntry(terminalSessionId)],
      },
    })
    workspacesStore.getState().setSelectedTerminal(WORKTREE_KEY, terminalSessionId)
    const closeTerminalByDescriptor = vi.fn(async () => true)
    setTerminalSessionCommandBridge({
      terminalFilesystemTargetSnapshot: () => emptyWorktreeSnapshot(),
      createTerminal: vi.fn(async () => terminalSessionId),
      selectTerminal: vi.fn(),
      closeTerminalByDescriptor,
    })

    expect(
      await runCloseCurrentWorkspacePaneTabCommand({
        workspacePaneRoute: undefined,
        workspaceId: REPO_ID,
        branchName: 'feature/worktree',
        navigation: navigationWith(),
      }),
    ).toBe(true)

    expect(closeTerminalByDescriptor).toHaveBeenCalledWith(terminalSessionId, expect.any(Object))
  })
})
