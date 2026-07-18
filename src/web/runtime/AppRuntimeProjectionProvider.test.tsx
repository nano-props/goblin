// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import type {
  TerminalAttachResult,
  TerminalSessionSummary,
  TerminalSessionsChangedEvent,
  TerminalSessionsSnapshot,
} from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabsChangedRealtimeMessage, WorkspacePaneTabsEntry } from '#/shared/workspace-pane-tabs.ts'
import type { ClientBridge } from '#/web/client-bridge-types.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { AppRuntimeProjectionProvider } from '#/web/runtime/AppRuntimeProjectionProvider.tsx'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
import { createRepoBranch, resetReposStore, seedRepoWithReadModelForTest } from '#/web/test-utils/bridge.ts'
import { renderInJsdom } from '#/test-utils/render.tsx'
import {
  readWorkspacePaneTabsForTarget,
  writeWorkspacePaneTabsSnapshotQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import {
  runtimeWorkspacePaneTargetForTest,
  setWorkspacePaneTabsForTargetQueryData,
} from '#/web/test-utils/workspace-pane-tabs.ts'
import { terminalSessionBaseForTest } from '#/web/test-utils/terminal-model.ts'

const projectionMocks = vi.hoisted(() => ({
  reconcileServerSessionsSnapshot: vi.fn(() => true),
  terminalSessionsCatalogCoverageRevision: vi.fn(() => 0),
  resynchronizeConnectedViews: vi.fn(),
  reconcileOpenWorkspaceRuntimeMemberships: vi.fn(),
}))

vi.mock('#/web/components/terminal/use-terminal-session-projection.ts', () => ({
  useTerminalSessionProjection: () => projectionMocks,
}))

vi.mock('#/web/stores/repos/repo-session-write-paths.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#/web/stores/repos/repo-session-write-paths.ts')>()),
  reconcileOpenWorkspaceRuntimeMemberships: projectionMocks.reconcileOpenWorkspaceRuntimeMemberships,
}))

const REPO_ID = 'goblin+file:///tmp/goblin-runtime-provider-repo'
const BRANCH_NAME = 'feature/worktree'
const WORKTREE_PATH = '/tmp/goblin-runtime-provider-worktree'

type TestTerminalSessionSummary = TerminalSessionSummary

let sessionsChangedHandler: ((event: TerminalSessionsChangedEvent) => void) | null = null
let workspaceTabsChangedHandler: ((message: WorkspacePaneTabsChangedRealtimeMessage) => void) | null = null
let recoveredHandler: ((clientId: string) => void) | null = null
const kickReconnectMock = vi.fn(() => {})
const recoverSessionsMock =
  vi.fn<(...args: Array<{ repoRoot: string; workspaceRuntimeId: string }>) => Promise<TerminalSessionsSnapshot>>()
const listWorkspaceTabsMock = vi.fn<(...args: Array<{ repoRoot: string }>) => Promise<WorkspacePaneTabsEntry[]>>()

describe('AppRuntimeProjectionProvider', () => {
  beforeEach(() => {
    sessionsChangedHandler = null
    workspaceTabsChangedHandler = null
    recoveredHandler = null
    kickReconnectMock.mockClear()
    projectionMocks.reconcileServerSessionsSnapshot.mockClear()
    projectionMocks.reconcileServerSessionsSnapshot.mockReturnValue(true)
    projectionMocks.terminalSessionsCatalogCoverageRevision.mockReset()
    projectionMocks.terminalSessionsCatalogCoverageRevision.mockReturnValue(0)
    projectionMocks.resynchronizeConnectedViews.mockReset()
    projectionMocks.reconcileOpenWorkspaceRuntimeMemberships.mockReset()
    projectionMocks.reconcileOpenWorkspaceRuntimeMemberships.mockImplementation(async () => ({
      kind: 'settled' as const,
      targets: Object.values(useReposStore.getState().repos).map((repo) => ({
        workspaceId: repo.id,
        workspaceRuntimeId: repo.workspaceRuntimeId,
      })),
      changedTargets: [],
    }))
    recoverSessionsMock.mockReset()
    recoverSessionsMock.mockResolvedValue({ revision: 0, sessions: [] })
    listWorkspaceTabsMock.mockReset()
    listWorkspaceTabsMock.mockResolvedValue([])
    resetReposStore()
    useTerminalProjectionHydrationStore.setState(useTerminalProjectionHydrationStore.getInitialState())
    primaryWindowQueryClient.clear()
    window.sessionStorage.setItem('goblin:terminal-client-id', 'client_local')
    Object.defineProperty(window, '__GOBLIN_BOOTSTRAP__', {
      configurable: true,
      value: {
        runtime: {
          kind: 'web',
          bridgeVersion: CLIENT_BRIDGE_VERSION,
          capabilities: [],
        },
        initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret', clientId: 'client_sharedterminal' },
      },
    })
    setClientBridgeForTests(testBridge())
  })

  afterEach(() => {
    setClientBridgeForTests(null)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  })

  test('kicks reconnect on visibilitychange:visible and persisted pageshow', async () => {
    const result = renderRuntimeProvider(null)
    try {
      kickReconnectMock.mockClear()
      await act(async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(kickReconnectMock).toHaveBeenCalledTimes(1)

      kickReconnectMock.mockClear()
      await act(async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(kickReconnectMock).not.toHaveBeenCalled()

      kickReconnectMock.mockClear()
      await act(async () => {
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
      })
      expect(kickReconnectMock).toHaveBeenCalledTimes(1)

      kickReconnectMock.mockClear()
      await act(async () => {
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }))
      })
      expect(kickReconnectMock).not.toHaveBeenCalled()
    } finally {
      result.unmount()
    }
  })

  test('keeps its projection registry usable across StrictMode effect replay', async () => {
    const repo = seedCurrentRepo()
    const result = renderInJsdom(
      <StrictMode>
        <RuntimeProbe currentRepoId={REPO_ID} />
      </StrictMode>,
    )
    try {
      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalled())
      expect(document.body.textContent).toContain('probe')
    } finally {
      result.unmount()
    }
  })

  test('waits for workspace membership before hydrating terminal server projection', async () => {
    const repo = seedCurrentRepo()
    useReposStore.setState({ workspaceMembershipReady: false })
    recoverSessionsMock.mockResolvedValue({
      revision: 1,
      sessions: [completeServerSession(serverSession('term-111111111111111111111'))],
    })
    const result = renderRuntimeProvider(REPO_ID)
    try {
      expect(recoverSessionsMock).not.toHaveBeenCalled()
      expect(useTerminalProjectionHydrationStore.getState().hydrationByRepo.get(REPO_ID)?.workspaceRuntimeId).not.toBe(
        repo.workspaceRuntimeId,
      )

      await act(async () => {
        useReposStore.setState({ workspaceMembershipReady: true })
      })

      await vi.waitFor(() => {
        expect(projectionMocks.reconcileServerSessionsSnapshot).toHaveBeenCalledWith(
          { repoRoot: REPO_ID, workspaceRuntimeId: repo.workspaceRuntimeId },
          {
            revision: 1,
            sessions: [completeServerSession(serverSession('term-111111111111111111111'))],
          },
          'client_sharedterminal',
        )
        expect(useTerminalProjectionHydrationStore.getState().hydrationByRepo.get(REPO_ID)).toMatchObject({
          workspaceRuntimeId: repo.workspaceRuntimeId,
          phase: 'ready',
        })
      })
    } finally {
      result.unmount()
    }
  })

  test('applies terminal recovery independently from an older workspace tabs revision', async () => {
    const repo = seedCurrentRepo()
    writeWorkspacePaneTabsSnapshotQueryData(REPO_ID, repo.workspaceRuntimeId, { revision: 2, entries: [] })
    recoverSessionsMock.mockResolvedValue({
      revision: 1,
      sessions: [completeServerSession(serverSession('term-111111111111111111111'))],
    })

    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() => {
        expect(projectionMocks.reconcileServerSessionsSnapshot).toHaveBeenCalledWith(
          { repoRoot: REPO_ID, workspaceRuntimeId: repo.workspaceRuntimeId },
          expect.objectContaining({ revision: 1 }),
          'client_sharedterminal',
        )
      })
      expect(primaryWindowQueryClient.getQueryData(['workspace-pane-tabs', REPO_ID, repo.workspaceRuntimeId])).toMatchObject(
        { revision: 2 },
      )
    } finally {
      result.unmount()
    }
  })

  test('refreshes workspace tabs without recovering terminal sessions from workspace tab broadcasts', async () => {
    const repo = seedCurrentRepo()
    setWorkspacePaneTabsForTargetQueryData({
      kind: 'git-worktree' as const,
      repoRoot: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    listWorkspaceTabsMock.mockResolvedValue([
      {
        target: runtimeWorkspacePaneTargetForTest({
          kind: 'git-worktree' as const,
          repoRoot: REPO_ID,
          workspaceRuntimeId: repo.workspaceRuntimeId,
          worktreePath: WORKTREE_PATH,
        }),
        tabs: [workspacePaneStaticTabEntry('history')],
      },
    ])
    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledTimes(1))
      recoverSessionsMock.mockClear()
      recoverSessionsMock.mockResolvedValue({ revision: 1, sessions: [] })

      await act(async () => {
        workspaceTabsChangedHandler?.({
          type: 'workspace-pane-tabs.changed',
          change: 'invalidation',
          repoRoot: REPO_ID,
        })
        await waitForScheduledServerSync()
      })

      await vi.waitFor(() => expect(listWorkspaceTabsMock).toHaveBeenCalledTimes(1))
      expect(recoverSessionsMock).not.toHaveBeenCalled()
      expect(tabsFor(repo.workspaceRuntimeId)).toEqual([workspacePaneStaticTabEntry('history')])
    } finally {
      result.unmount()
    }
  })

  test('skips a revision broadcast already applied by the runtime-open response', async () => {
    const repo = seedCurrentRepo()
    writeWorkspacePaneTabsSnapshotQueryData(REPO_ID, repo.workspaceRuntimeId, { revision: 5, entries: [] })
    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledTimes(1))

      await act(async () => {
        workspaceTabsChangedHandler?.({
          type: 'workspace-pane-tabs.changed',
          change: 'revision',
          repoRoot: REPO_ID,
          workspaceRuntimeId: repo.workspaceRuntimeId,
          revision: 5,
        })
        await waitForScheduledServerSync()
      })
      expect(listWorkspaceTabsMock).not.toHaveBeenCalled()

      await act(async () => {
        workspaceTabsChangedHandler?.({
          type: 'workspace-pane-tabs.changed',
          change: 'revision',
          repoRoot: REPO_ID,
          workspaceRuntimeId: repo.workspaceRuntimeId,
          revision: 6,
        })
        await waitForScheduledServerSync()
      })
      await vi.waitFor(() => expect(listWorkspaceTabsMock).toHaveBeenCalledOnce())
    } finally {
      result.unmount()
    }
  })

  test('keeps terminal session and workspace tab refreshes on their own event channels', async () => {
    const repo = seedCurrentRepo()
    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledTimes(1))
      recoverSessionsMock.mockClear()
      recoverSessionsMock.mockResolvedValue({ revision: 1, sessions: [] })

      await act(async () => {
        sessionsChangedHandler?.({ repoRoot: REPO_ID, workspaceRuntimeId: repo.workspaceRuntimeId, revision: 1 })
        workspaceTabsChangedHandler?.({
          type: 'workspace-pane-tabs.changed',
          change: 'invalidation',
          repoRoot: REPO_ID,
        })
        await waitForScheduledServerSync()
      })

      expect(recoverSessionsMock).toHaveBeenCalledTimes(1)
      expect(listWorkspaceTabsMock).toHaveBeenCalledTimes(1)
    } finally {
      result.unmount()
    }
  })

  test('skips recovery when an origin attach already applied the event revision', async () => {
    const repo = seedCurrentRepo()
    projectionMocks.terminalSessionsCatalogCoverageRevision.mockReturnValue(4)
    recoverSessionsMock.mockResolvedValue({ revision: 4, sessions: [] })
    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() =>
        expect(useTerminalProjectionHydrationStore.getState().hydrationByRepo.get(REPO_ID)?.phase).toBe('ready'),
      )
      recoverSessionsMock.mockClear()

      await act(async () => {
        sessionsChangedHandler?.({ repoRoot: REPO_ID, workspaceRuntimeId: repo.workspaceRuntimeId, revision: 3 })
        sessionsChangedHandler?.({ repoRoot: REPO_ID, workspaceRuntimeId: repo.workspaceRuntimeId, revision: 4 })
        await waitForScheduledServerSync()
      })

      expect(recoverSessionsMock).not.toHaveBeenCalled()
    } finally {
      result.unmount()
    }
  })

  test('recovers a catalog gap that an origin partial effect cannot cover', async () => {
    const repo = seedCurrentRepo()
    projectionMocks.terminalSessionsCatalogCoverageRevision.mockReturnValue(2)
    recoverSessionsMock.mockResolvedValueOnce({ revision: 2, sessions: [] })
    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() =>
        expect(useTerminalProjectionHydrationStore.getState().hydrationByRepo.get(REPO_ID)?.phase).toBe('ready'),
      )
      recoverSessionsMock.mockClear()
      recoverSessionsMock.mockResolvedValueOnce({ revision: 3, sessions: [] })

      await act(async () => {
        sessionsChangedHandler?.({ repoRoot: REPO_ID, workspaceRuntimeId: repo.workspaceRuntimeId, revision: 3 })
      })

      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledOnce())
      expect(recoverSessionsMock).toHaveBeenCalledWith({ repoRoot: REPO_ID, workspaceRuntimeId: repo.workspaceRuntimeId })
    } finally {
      result.unmount()
    }
  })

  test('follows a cold recovery superseded by a concurrent create revision', async () => {
    const repo = seedCurrentRepo()
    const coldRecovery = Promise.withResolvers<TerminalSessionsSnapshot>()
    recoverSessionsMock
      .mockReturnValueOnce(coldRecovery.promise)
      .mockResolvedValueOnce({ revision: 2, sessions: [] })
    projectionMocks.terminalSessionsCatalogCoverageRevision.mockReturnValue(0)
    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledOnce())
      projectionMocks.terminalSessionsCatalogCoverageRevision.mockReturnValue(2)

      await act(async () => {
        coldRecovery.resolve({ revision: 1, sessions: [] })
      })

      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledTimes(2))
      await vi.waitFor(() =>
        expect(useTerminalProjectionHydrationStore.getState().hydrationByRepo.get(REPO_ID)).toMatchObject({
          workspaceRuntimeId: repo.workspaceRuntimeId,
          phase: 'ready',
        }),
      )
      expect(projectionMocks.reconcileServerSessionsSnapshot).toHaveBeenCalledOnce()
      expect(projectionMocks.reconcileServerSessionsSnapshot).toHaveBeenCalledWith(
        { repoRoot: REPO_ID, workspaceRuntimeId: repo.workspaceRuntimeId },
        { revision: 2, sessions: [] },
        'client_sharedterminal',
      )
    } finally {
      result.unmount()
    }
  })

  test('ignores terminal projection events from a replaced runtime epoch', async () => {
    const repo = seedCurrentRepo()
    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledOnce())
      recoverSessionsMock.mockClear()

      await act(async () => {
        sessionsChangedHandler?.({ repoRoot: REPO_ID, workspaceRuntimeId: `${repo.workspaceRuntimeId}-old`, revision: 9 })
        await waitForScheduledServerSync()
      })

      expect(recoverSessionsMock).not.toHaveBeenCalled()
    } finally {
      result.unmount()
    }
  })

  test('lets an in-flight cold recovery satisfy a newer terminal event without issuing a second request', async () => {
    const repo = seedCurrentRepo()
    const recovery = Promise.withResolvers<TerminalSessionsSnapshot>()
    recoverSessionsMock.mockReturnValueOnce(recovery.promise)
    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledOnce())

      await act(async () => {
        sessionsChangedHandler?.({ repoRoot: REPO_ID, workspaceRuntimeId: repo.workspaceRuntimeId, revision: 4 })
        await waitForScheduledServerSync()
        recovery.resolve({ revision: 4, sessions: [] })
      })

      await vi.waitFor(() =>
        expect(useTerminalProjectionHydrationStore.getState().hydrationByRepo.get(REPO_ID)?.phase).toBe('ready'),
      )
      expect(recoverSessionsMock).toHaveBeenCalledOnce()
    } finally {
      result.unmount()
    }
  })

  test('recovers terminal sessions and workspace tabs from server state when app realtime reconnects', async () => {
    const repo = seedCurrentRepo()
    setWorkspacePaneTabsForTargetQueryData({
      kind: 'git-worktree' as const,
      repoRoot: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledTimes(1))
      recoverSessionsMock.mockClear()
      listWorkspaceTabsMock.mockClear()
      recoverSessionsMock.mockResolvedValue({
        revision: 2,
        sessions: [completeServerSession(serverSession('term-111111111111111111111'))],
      })
      listWorkspaceTabsMock.mockResolvedValue([
        {
          target: runtimeWorkspacePaneTargetForTest({
            kind: 'git-worktree' as const,
            repoRoot: REPO_ID,
            workspaceRuntimeId: repo.workspaceRuntimeId,
            worktreePath: WORKTREE_PATH,
          }),
          tabs: [workspacePaneStaticTabEntry('history')],
        },
      ])

      await act(async () => {
        recoveredHandler?.('client_sharedterminal')
      })

      await vi.waitFor(() => {
        expect(projectionMocks.reconcileOpenWorkspaceRuntimeMemberships).toHaveBeenCalledOnce()
        expect(projectionMocks.reconcileServerSessionsSnapshot).toHaveBeenLastCalledWith(
          { repoRoot: REPO_ID, workspaceRuntimeId: repo.workspaceRuntimeId },
          {
            revision: 2,
            sessions: [completeServerSession(serverSession('term-111111111111111111111'))],
          },
          'client_sharedterminal',
        )
        expect(tabsFor(repo.workspaceRuntimeId)).toEqual([workspacePaneStaticTabEntry('history')])
      })

      recoverSessionsMock.mockClear()
      useTerminalProjectionHydrationStore.setState({ refreshCooldownMs: 0 })
      await act(async () => {
        window.dispatchEvent(new Event('focus'))
      })
      await vi.waitFor(() => {
        expect(recoverSessionsMock).toHaveBeenCalledOnce()
        expect(recoverSessionsMock).toHaveBeenCalledWith({
          repoRoot: REPO_ID,
          workspaceRuntimeId: repo.workspaceRuntimeId,
        })
      })
    } finally {
      result.unmount()
    }
  })

  test('coalesces cold recovery, reconnect, and a sessions event before resynchronizing views once', async () => {
    seedCurrentRepo()
    const coldRecovery = Promise.withResolvers<TerminalSessionsSnapshot>()
    recoverSessionsMock
      .mockReturnValueOnce(coldRecovery.promise)
      .mockResolvedValueOnce({ revision: 2, sessions: [] })
    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledOnce())

      await act(async () => {
        recoveredHandler?.('client_sharedterminal')
      })
      await vi.waitFor(() => expect(projectionMocks.reconcileOpenWorkspaceRuntimeMemberships).toHaveBeenCalledOnce())
      await act(async () => {
        sessionsChangedHandler?.({
          repoRoot: REPO_ID,
          workspaceRuntimeId: useReposStore.getState().repos[REPO_ID]!.workspaceRuntimeId,
          revision: 2,
        })
      })
      await act(async () => {
        coldRecovery.resolve({ revision: 0, sessions: [] })
      })

      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledTimes(2))
      await vi.waitFor(() => expect(projectionMocks.resynchronizeConnectedViews).toHaveBeenCalledOnce())
      expect(projectionMocks.reconcileServerSessionsSnapshot).toHaveBeenCalledOnce()
      expect(projectionMocks.reconcileServerSessionsSnapshot).toHaveBeenCalledWith(
        { repoRoot: REPO_ID, workspaceRuntimeId: useReposStore.getState().repos[REPO_ID]!.workspaceRuntimeId },
        { revision: 2, sessions: [] },
        'client_sharedterminal',
      )
      expect(projectionMocks.resynchronizeConnectedViews).toHaveBeenCalledWith(
        REPO_ID,
        useReposStore.getState().repos[REPO_ID]?.workspaceRuntimeId,
      )
    } finally {
      result.unmount()
    }
  })

  test('keeps reconnect resynchronization dormant across a failed fresh follow-up', async () => {
    const repo = seedCurrentRepo()
    const coldRecovery = Promise.withResolvers<TerminalSessionsSnapshot>()
    recoverSessionsMock
      .mockReturnValueOnce(coldRecovery.promise)
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({ revision: 2, sessions: [] })
    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledOnce())
      await act(async () => {
        recoveredHandler?.('client_sharedterminal')
      })
      await vi.waitFor(() => expect(projectionMocks.reconcileOpenWorkspaceRuntimeMemberships).toHaveBeenCalledOnce())
      await act(async () => {
        coldRecovery.resolve({ revision: 1, sessions: [] })
      })

      await vi.waitFor(() =>
        expect(useTerminalProjectionHydrationStore.getState().hydrationByRepo.get(REPO_ID)).toMatchObject({
          workspaceRuntimeId: repo.workspaceRuntimeId,
          phase: 'failed',
          errorMessage: 'network unavailable',
        }),
      )
      expect(projectionMocks.resynchronizeConnectedViews).not.toHaveBeenCalled()

      await act(async () => {
        sessionsChangedHandler?.({ repoRoot: REPO_ID, workspaceRuntimeId: repo.workspaceRuntimeId, revision: 2 })
      })

      await vi.waitFor(() =>
        expect(useTerminalProjectionHydrationStore.getState().hydrationByRepo.get(REPO_ID)).toMatchObject({
          workspaceRuntimeId: repo.workspaceRuntimeId,
          phase: 'ready',
        }),
      )
      expect(recoverSessionsMock).toHaveBeenCalledTimes(3)
      expect(projectionMocks.resynchronizeConnectedViews).toHaveBeenCalledOnce()
    } finally {
      result.unmount()
    }
  })

  test('reconciles a replaced repo epoch before recovering runtime projections', async () => {
    const repo = seedCurrentRepo()
    const nextWorkspaceRuntimeId = 'repo-runtime-123456789012345678901'
    projectionMocks.reconcileOpenWorkspaceRuntimeMemberships.mockImplementationOnce(async () => {
      useReposStore.setState((state) => ({
        repos: {
          ...state.repos,
          [REPO_ID]: { ...state.repos[REPO_ID]!, workspaceRuntimeId: nextWorkspaceRuntimeId },
        },
      }))
      return {
        kind: 'settled' as const,
        targets: [{ workspaceId: REPO_ID, workspaceRuntimeId: nextWorkspaceRuntimeId }],
        changedTargets: [
          { workspaceId: REPO_ID, previousWorkspaceRuntimeId: repo.workspaceRuntimeId, workspaceRuntimeId: nextWorkspaceRuntimeId },
        ],
      }
    })
    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledOnce())
      recoverSessionsMock.mockClear()

      await act(async () => {
        recoveredHandler?.('client_sharedterminal')
      })

      await vi.waitFor(() => {
        expect(recoverSessionsMock).toHaveBeenCalledWith({ repoRoot: REPO_ID, workspaceRuntimeId: nextWorkspaceRuntimeId })
      })
      expect(recoverSessionsMock).not.toHaveBeenCalledWith({
        repoRoot: REPO_ID,
        workspaceRuntimeId: repo.workspaceRuntimeId,
      })
    } finally {
      result.unmount()
    }
  })

  test('initial mount only syncs the current repo session list', async () => {
    const firstRepo = seedCurrentRepo()
    seedSecondRepo()
    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledTimes(1))
      expect(recoverSessionsMock).toHaveBeenCalledWith({ repoRoot: REPO_ID, workspaceRuntimeId: firstRepo.workspaceRuntimeId })
    } finally {
      result.unmount()
    }
  })

  test('focus sync only refreshes the current repo session list', async () => {
    const firstRepo = seedCurrentRepo()
    seedSecondRepo()
    useTerminalProjectionHydrationStore.setState({ refreshCooldownMs: 0 })
    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledTimes(1))
      recoverSessionsMock.mockClear()

      await act(async () => {
        window.dispatchEvent(new Event('focus'))
      })

      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledTimes(1))
      expect(recoverSessionsMock).toHaveBeenCalledWith({ repoRoot: REPO_ID, workspaceRuntimeId: firstRepo.workspaceRuntimeId })
    } finally {
      result.unmount()
    }
  })

  test('drops a recovered terminal projection when the workspace runtime changed before publish', async () => {
    const firstRepo = seedCurrentRepo()
    const recovery = Promise.withResolvers<TerminalSessionsSnapshot>()
    recoverSessionsMock.mockReturnValueOnce(recovery.promise)
    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledTimes(1))

      await useReposStore.getState().closeWorkspace(REPO_ID)
      seedRepoWithReadModelForTest({
        id: REPO_ID,
        workspaceRuntimeId: 'repo-runtime-reopened',
        branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
        currentBranchName: BRANCH_NAME,
        preferredWorkspacePaneTab: 'terminal',
      })
      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledTimes(2))
      await vi.waitFor(() => expect(projectionMocks.reconcileServerSessionsSnapshot).toHaveBeenCalledTimes(1))
      projectionMocks.reconcileServerSessionsSnapshot.mockClear()

      await act(async () => {
        recovery.resolve({
          revision: 1,
          sessions: [
            completeServerSession({
              ...serverSession('term-111111111111111111111'),
              ...terminalSessionBaseForTest({
                repoRoot: REPO_ID,
                workspaceRuntimeId: firstRepo.workspaceRuntimeId,
                branch: BRANCH_NAME,
                worktreePath: WORKTREE_PATH,
              }),
            }),
          ],
        })
        await Promise.resolve()
      })

      expect(projectionMocks.reconcileServerSessionsSnapshot).not.toHaveBeenCalled()
      expect(useTerminalProjectionHydrationStore.getState().hydrationByRepo.get(REPO_ID)).not.toMatchObject({
        workspaceRuntimeId: firstRepo.workspaceRuntimeId,
        phase: 'ready',
      })
    } finally {
      result.unmount()
    }
  })

  test('failed initial terminal projection hydrate marks the repo failed', async () => {
    const repo = seedCurrentRepo()
    recoverSessionsMock.mockRejectedValueOnce(new Error('error.workspace-runtime-stale'))
    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() => {
        expect(useTerminalProjectionHydrationStore.getState().hydrationByRepo.get(REPO_ID)).toMatchObject({
          workspaceRuntimeId: repo.workspaceRuntimeId,
          phase: 'failed',
          errorMessage: 'error.workspace-runtime-stale',
        })
      })
    } finally {
      result.unmount()
    }
  })

  test('active runtime membership rejection marks the pending projection failed', async () => {
    const repo = seedCurrentRepo()
    projectionMocks.reconcileServerSessionsSnapshot.mockReturnValueOnce(false)
    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() => {
        expect(useTerminalProjectionHydrationStore.getState().hydrationByRepo.get(REPO_ID)).toMatchObject({
          workspaceRuntimeId: repo.workspaceRuntimeId,
          phase: 'failed',
          errorMessage: 'Terminal sessions snapshot rejected by the active runtime membership',
        })
      })
      expect(projectionMocks.resynchronizeConnectedViews).not.toHaveBeenCalled()
    } finally {
      result.unmount()
    }
  })

  test('does not publish a pending recovery after provider unmount', async () => {
    const repo = seedCurrentRepo()
    const recovery = Promise.withResolvers<TerminalSessionsSnapshot>()
    recoverSessionsMock.mockReturnValueOnce(recovery.promise)
    const result = renderRuntimeProvider(REPO_ID)
    await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledOnce())

    result.unmount()
    recovery.resolve({
      revision: 1,
      sessions: [completeServerSession(serverSession('term-111111111111111111111'))],
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(projectionMocks.reconcileServerSessionsSnapshot).not.toHaveBeenCalled()
    expect(useTerminalProjectionHydrationStore.getState().hydrationByRepo.get(REPO_ID)).not.toMatchObject({
      workspaceRuntimeId: repo.workspaceRuntimeId,
      phase: 'ready',
    })
  })

  test('invalidates a pending membership recovery when the provider unmounts', async () => {
    const repo = seedCurrentRepo()
    const membershipRecovery = Promise.withResolvers<{
      kind: 'settled'
      targets: Array<{ workspaceId: string; workspaceRuntimeId: string }>
      changedTargets: []
    }>()
    projectionMocks.reconcileOpenWorkspaceRuntimeMemberships.mockReturnValueOnce(membershipRecovery.promise)
    const result = renderRuntimeProvider(REPO_ID)
    await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledOnce())
    recoverSessionsMock.mockClear()
    listWorkspaceTabsMock.mockClear()

    await act(async () => {
      recoveredHandler?.('client_sharedterminal')
    })
    await vi.waitFor(() => expect(projectionMocks.reconcileOpenWorkspaceRuntimeMemberships).toHaveBeenCalledOnce())
    result.unmount()

    membershipRecovery.resolve({
      kind: 'settled',
      targets: [{ workspaceId: REPO_ID, workspaceRuntimeId: repo.workspaceRuntimeId }],
      changedTargets: [],
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(recoverSessionsMock).not.toHaveBeenCalled()
    expect(listWorkspaceTabsMock).not.toHaveBeenCalled()
  })

  test('failed focus projection refresh does not replace an already ready hydrate', async () => {
    const repo = seedCurrentRepo()
    useTerminalProjectionHydrationStore.setState({ refreshCooldownMs: 0 })
    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() => {
        expect(useTerminalProjectionHydrationStore.getState().hydrationByRepo.get(REPO_ID)).toMatchObject({
          workspaceRuntimeId: repo.workspaceRuntimeId,
          phase: 'ready',
        })
      })

      recoverSessionsMock.mockRejectedValueOnce(new Error('error.network'))
      recoverSessionsMock.mockClear()
      await act(async () => {
        window.dispatchEvent(new Event('focus'))
      })

      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledTimes(1))
      expect(useTerminalProjectionHydrationStore.getState().hydrationByRepo.get(REPO_ID)).toMatchObject({
        workspaceRuntimeId: repo.workspaceRuntimeId,
        phase: 'ready',
      })
    } finally {
      result.unmount()
    }
  })
})

function renderRuntimeProvider(currentRepoId: string | null) {
  return renderInJsdom(<RuntimeProbe currentRepoId={currentRepoId} />)
}

function RuntimeProbe({ currentRepoId }: { currentRepoId: string | null }) {
  return (
    <AppRuntimeProjectionProvider currentRepoId={currentRepoId}>
      <span>probe</span>
    </AppRuntimeProjectionProvider>
  )
}

function seedCurrentRepo() {
  return seedRepoWithReadModelForTest({
    id: REPO_ID,
    branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
    currentBranchName: BRANCH_NAME,
    preferredWorkspacePaneTab: 'terminal',
  })
}

function seedSecondRepo() {
  const current = useReposStore.getState()
  const secondRepo = seedRepoWithReadModelForTest({
    id: 'goblin+file:///tmp/goblin-runtime-provider-repo-2',
    branches: [createRepoBranch('feature/other', { worktree: { path: '/tmp/goblin-runtime-provider-worktree-2' } })],
    currentBranchName: 'feature/other',
    preferredWorkspacePaneTab: 'terminal',
    workspaceRuntimeId: 'repo-runtime-second',
  })
  useReposStore.setState((state) => ({
    ...state,
    repos: {
      ...current.repos,
      [secondRepo.id]: secondRepo,
    },
    order: [REPO_ID, secondRepo.id],
    restoredRepoId: REPO_ID,
  }))
}

function testBridge(): ClientBridge {
  return {
    kind: () => 'web',
    hasCapability: () => false,
    getBootstrap: () => window.__GOBLIN_BOOTSTRAP__!,
    invokeIpc: vi.fn(async () => null),
    abortIpc: vi.fn(async () => false),
    onIpcEvent: vi.fn(() => () => {}),
    onEffectIntent: vi.fn(() => () => {}),
    pathForFile: vi.fn(() => ''),
    saveClipboardFiles: vi.fn(async () => []),
    host: () => null,
    appRealtime: () => ({
      kickReconnect: kickReconnectMock,
      onRecovered: vi.fn((cb: (clientId: string) => void) => {
        recoveredHandler = cb
        return () => {
          if (recoveredHandler === cb) recoveredHandler = null
        }
      }),
    }),
    terminal: () => ({
      attach: vi.fn(async () => attachResult()),
      restart: vi.fn(async () => ({
        ...attachResult(),
        terminalProjectionEffect: { kind: 'delta' as const, revision: 1 },
      })),
      write: vi.fn(async () => ({ status: 'accepted' as const })),
      resize: vi.fn(async () => true),
      takeover: vi.fn(async () => ({
        ok: true as const,
        terminalRuntimeSessionId: 'term-111111111111111111111',
        terminalRuntimeGeneration: 1,
        role: 'controller' as const,
        controllerStatus: 'connected' as const,
        controller: { clientId: 'client_local', status: 'connected' as const },
        canonicalCols: 80,
        canonicalRows: 24,
        phase: 'open' as const,
      })),
      close: vi.fn(async () => true),
      pruneTerminals: vi.fn(async () => ({ pruned: 0, remaining: 0 })),
      recoverSessions: recoverSessionsMock,
      notifyBell: vi.fn(async () => true),
      sendTestNotification: vi.fn(async () => true),
      setBadge: vi.fn(() => {}),
      onOutput: vi.fn(() => () => {}),
      onBell: vi.fn(() => () => {}),
      onTitle: vi.fn(() => () => {}),
      onExit: vi.fn(() => () => {}),
      onIdentity: vi.fn(() => () => {}),
      onLifecycle: vi.fn(() => () => {}),
      onSessionsChanged: vi.fn((cb: (event: TerminalSessionsChangedEvent) => void) => {
        sessionsChangedHandler = cb
        return () => {
          if (sessionsChangedHandler === cb) sessionsChangedHandler = null
        }
      }),
      onSessionClosed: vi.fn(() => () => {}),
    }),
    workspacePaneTabs: () => ({
      replace: vi.fn(async () => ({ revision: 1, entries: [] })),
      update: vi.fn(async () => ({ revision: 1, entries: [] })),
      list: vi.fn(async (input) => ({ revision: 1, entries: await listWorkspaceTabsMock(input) })),
      onChanged: vi.fn((cb: (message: WorkspacePaneTabsChangedRealtimeMessage) => void) => {
        workspaceTabsChangedHandler = cb
        return () => {
          if (workspaceTabsChangedHandler === cb) workspaceTabsChangedHandler = null
        }
      }),
    }),
    workspacePaneRuntime: () => ({
      open: vi.fn(async () => ({ ok: false as const, runtimeType: 'terminal' as const, message: 'unavailable' })),
      close: vi.fn(async () => ({ ok: false as const, runtimeType: 'terminal' as const, message: 'unavailable' })),
    }),
  }
}

function attachResult(): Extract<TerminalAttachResult, { ok: true; frame: 'snapshot' }> {
  return {
    ok: true,
    frame: 'snapshot',
    terminalProjectionEffect: { kind: 'none' },
    terminalRuntimeSessionId: 'unused',
    terminalRuntimeGeneration: 1,
    snapshot: '',
    snapshotSeq: 0,
    outputEra: 0,
    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open',
    message: null,
    controller: { clientId: 'client_local', status: 'connected' },
    canonicalCols: 80,
    canonicalRows: 24,
  }
}

function serverSession(terminalSessionId: string): TestTerminalSessionSummary {
  const repo = useReposStore.getState().repos[REPO_ID]
  if (!repo) throw new Error('runtime provider test workspace is unavailable')
  const base = terminalSessionBaseForTest({
    repoRoot: REPO_ID,
    workspaceRuntimeId: repo.workspaceRuntimeId,
    branch: BRANCH_NAME,
    worktreePath: WORKTREE_PATH,
  })
  return {
    ...base,
    terminalRuntimeSessionId: `runtime-${terminalSessionId}`,
    terminalRuntimeGeneration: 1,
    terminalSessionId,
    processName: 'zsh',
    canonicalTitle: null,
    controller: null,
    phase: 'open',
    message: null,
    cols: 80,
    rows: 24,
  }
}

function completeServerSession(session: TestTerminalSessionSummary): TerminalSessionSummary {
  return session
}

function tabsFor(workspaceRuntimeId: string) {
  return readWorkspacePaneTabsForTarget({
    kind: 'git-worktree',
    repoRoot: REPO_ID,
    workspaceRuntimeId,
    worktreePath: WORKTREE_PATH,
  })
}

async function waitForScheduledServerSync(): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
}
