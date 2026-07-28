// @vitest-environment jsdom

import { resetWorkspacesStore, seedRepoWithReadModelForTest, createRepoBranch } from '#/web/test-utils/repo-store.ts'
import { act } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushMicrotasks, waitForNextMacrotask } from '#/test-utils/microtasks.ts'
import type * as WorkspaceSessionWritePaths from '#/web/stores/workspaces/workspace-session-write-paths.ts'
import { CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import type {
  TerminalAttachResult,
  TerminalRestartResult,
  TerminalSessionSummary,
  TerminalSessionsChangedEvent,
  TerminalSessionsSnapshot,
} from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabsChangedRealtimeMessage, WorkspacePaneTabsEntry } from '#/shared/workspace-pane-tabs.ts'
import type { ClientBridge } from '#/web/client-bridge-types.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { AppRuntimeProjectionProvider } from '#/web/runtime/AppRuntimeProjectionProvider.tsx'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
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
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'

const projectionMocks = vi.hoisted(() => ({
  reconcileServerSessionsSnapshot: vi.fn(() => true),
  terminalSessionsCatalogCoverageRevision: vi.fn(() => 0),
  resynchronizeConnectedViews: vi.fn(),
  reconcileOpenWorkspaceRuntimeMemberships: vi.fn(),
}))

vi.mock('#/web/client-page-id.ts', () => ({ readClientPageId: () => 'client_sharedterminal' }))

vi.mock('#/web/components/terminal/use-terminal-session-projection.ts', () => ({
  useTerminalSessionProjection: () => projectionMocks,
}))

vi.mock('#/web/stores/workspaces/workspace-session-write-paths.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof WorkspaceSessionWritePaths>()),
  reconcileOpenWorkspaceRuntimeMemberships: projectionMocks.reconcileOpenWorkspaceRuntimeMemberships,
}))

const REPO_ID = workspaceIdForTest('goblin+file:///tmp/goblin-runtime-provider-repo')
const BRANCH_NAME = 'feature/worktree'
const WORKTREE_PATH = '/tmp/goblin-runtime-provider-worktree'

type TestTerminalSessionSummary = TerminalSessionSummary

let sessionsChangedHandler: ((event: TerminalSessionsChangedEvent) => void) | null = null
let workspaceTabsChangedHandler: ((message: WorkspacePaneTabsChangedRealtimeMessage) => void) | null = null
let recoveredHandler: ((clientId: string) => void) | null = null
const kickReconnectMock = vi.fn(() => {})
const recoverSessionsMock =
  vi.fn<
    (...args: Array<{ workspaceId: typeof REPO_ID; workspaceRuntimeId: string }>) => Promise<TerminalSessionsSnapshot>
  >()
const listWorkspaceTabsMock = vi.fn<(...args: Array<{ workspaceId: string }>) => Promise<WorkspacePaneTabsEntry[]>>()

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
      targets: Object.values(useWorkspacesStore.getState().workspaces).map((repo) => ({
        workspaceId: repo.id,
        workspaceRuntimeId: repo.workspaceRuntimeId,
      })),
      changedTargets: [],
    }))
    recoverSessionsMock.mockReset()
    recoverSessionsMock.mockResolvedValue({ revision: 0, sessions: [] })
    listWorkspaceTabsMock.mockReset()
    listWorkspaceTabsMock.mockResolvedValue([])
    resetWorkspacesStore()
    useTerminalProjectionHydrationStore.setState(useTerminalProjectionHydrationStore.getInitialState())
    primaryWindowQueryClient.clear()
    Object.defineProperty(window, '__GOBLIN_BOOTSTRAP__', {
      configurable: true,
      value: {
        runtime: {
          kind: 'web',
          bridgeVersion: CLIENT_BRIDGE_VERSION,
          capabilities: [],
        },
        initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
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

  test('hydrates terminal projection under StrictMode effect replay', async () => {
    const repo = seedCurrentRepo()
    const coldRecovery = Promise.withResolvers<TerminalSessionsSnapshot>()
    recoverSessionsMock.mockReturnValue(coldRecovery.promise)
    const result = renderInJsdom(
      <StrictMode>
        <RuntimeProbe currentWorkspaceId={REPO_ID} />
      </StrictMode>,
    )
    try {
      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalled())
      await act(async () => {
        coldRecovery.resolve({ revision: 0, sessions: [] })
      })
      await vi.waitFor(() =>
        expect(useTerminalProjectionHydrationStore.getState().hydrationByWorkspace.get(REPO_ID)).toMatchObject({
          workspaceRuntimeId: repo.workspaceRuntimeId,
          phase: 'ready',
        }),
      )
      expect(document.body.textContent).toContain('probe')
    } finally {
      result.unmount()
    }
  })

  test('waits for workspace membership before hydrating terminal server projection', async () => {
    const repo = seedCurrentRepo()
    useWorkspacesStore.setState({ workspaceMembershipReady: false })
    recoverSessionsMock.mockResolvedValue({
      revision: 1,
      sessions: [completeServerSession(serverSession('term-111111111111111111111'))],
    })
    const result = renderRuntimeProvider(REPO_ID)
    try {
      expect(recoverSessionsMock).not.toHaveBeenCalled()
      expect(
        useTerminalProjectionHydrationStore.getState().hydrationByWorkspace.get(REPO_ID)?.workspaceRuntimeId,
      ).not.toBe(repo.workspaceRuntimeId)

      await act(async () => {
        useWorkspacesStore.setState({ workspaceMembershipReady: true })
      })

      await vi.waitFor(() => {
        expect(projectionMocks.reconcileServerSessionsSnapshot).toHaveBeenCalledWith(
          { workspaceId: REPO_ID, workspaceRuntimeId: repo.workspaceRuntimeId },
          {
            revision: 1,
            sessions: [completeServerSession(serverSession('term-111111111111111111111'))],
          },
          'client_sharedterminal',
        )
        expect(useTerminalProjectionHydrationStore.getState().hydrationByWorkspace.get(REPO_ID)).toMatchObject({
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
          { workspaceId: REPO_ID, workspaceRuntimeId: repo.workspaceRuntimeId },
          expect.objectContaining({ revision: 1 }),
          'client_sharedterminal',
        )
      })
      expect(
        primaryWindowQueryClient.getQueryData(['workspace-pane-tabs', REPO_ID, repo.workspaceRuntimeId]),
      ).toMatchObject({ revision: 2 })
    } finally {
      result.unmount()
    }
  })

  test('refreshes workspace tabs without recovering terminal sessions from workspace tab broadcasts', async () => {
    const repo = seedCurrentRepo()
    setWorkspacePaneTabsForTargetQueryData({
      kind: 'git-worktree' as const,
      workspaceId: REPO_ID,
      workspaceRuntimeId: repo.workspaceRuntimeId,
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    listWorkspaceTabsMock.mockResolvedValue([
      {
        target: runtimeWorkspacePaneTargetForTest({
          kind: 'git-worktree' as const,
          workspaceId: REPO_ID,
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
          workspaceId: REPO_ID,
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

  test('skips recovery when an origin attach already applied the event revision', async () => {
    const repo = seedCurrentRepo()
    projectionMocks.terminalSessionsCatalogCoverageRevision.mockReturnValue(4)
    recoverSessionsMock.mockResolvedValue({ revision: 4, sessions: [] })
    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() =>
        expect(useTerminalProjectionHydrationStore.getState().hydrationByWorkspace.get(REPO_ID)?.phase).toBe('ready'),
      )
      recoverSessionsMock.mockClear()

      await act(async () => {
        sessionsChangedHandler?.({ workspaceId: REPO_ID, workspaceRuntimeId: repo.workspaceRuntimeId, revision: 3 })
        sessionsChangedHandler?.({ workspaceId: REPO_ID, workspaceRuntimeId: repo.workspaceRuntimeId, revision: 4 })
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
        expect(useTerminalProjectionHydrationStore.getState().hydrationByWorkspace.get(REPO_ID)?.phase).toBe('ready'),
      )
      recoverSessionsMock.mockClear()
      recoverSessionsMock.mockResolvedValueOnce({ revision: 3, sessions: [] })

      await act(async () => {
        sessionsChangedHandler?.({ workspaceId: REPO_ID, workspaceRuntimeId: repo.workspaceRuntimeId, revision: 3 })
      })

      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledOnce())
      expect(recoverSessionsMock).toHaveBeenCalledWith({
        workspaceId: REPO_ID,
        workspaceRuntimeId: repo.workspaceRuntimeId,
      })
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
        sessionsChangedHandler?.({
          workspaceId: REPO_ID,
          workspaceRuntimeId: `${repo.workspaceRuntimeId}-old`,
          revision: 9,
        })
        await waitForScheduledServerSync()
      })

      expect(recoverSessionsMock).not.toHaveBeenCalled()
    } finally {
      result.unmount()
    }
  })

  test('recovers terminal sessions and workspace tabs from server state when app realtime reconnects', async () => {
    const repo = seedCurrentRepo()
    setWorkspacePaneTabsForTargetQueryData({
      kind: 'git-worktree' as const,
      workspaceId: REPO_ID,
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
            workspaceId: REPO_ID,
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
          { workspaceId: REPO_ID, workspaceRuntimeId: repo.workspaceRuntimeId },
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
          workspaceId: REPO_ID,
          workspaceRuntimeId: repo.workspaceRuntimeId,
        })
      })
    } finally {
      result.unmount()
    }
  })

  test('reconciles a replaced repo epoch before recovering runtime projections', async () => {
    const repo = seedCurrentRepo()
    const nextWorkspaceRuntimeId = 'repo-runtime-123456789012345678901'
    projectionMocks.reconcileOpenWorkspaceRuntimeMemberships.mockImplementationOnce(async () => {
      useWorkspacesStore.setState((state) => ({
        workspaces: {
          ...state.workspaces,
          [REPO_ID]: { ...state.workspaces[REPO_ID]!, workspaceRuntimeId: nextWorkspaceRuntimeId },
        },
      }))
      return {
        kind: 'settled' as const,
        targets: [{ workspaceId: REPO_ID, workspaceRuntimeId: nextWorkspaceRuntimeId }],
        changedTargets: [
          {
            workspaceId: REPO_ID,
            previousWorkspaceRuntimeId: repo.workspaceRuntimeId,
            workspaceRuntimeId: nextWorkspaceRuntimeId,
          },
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
        expect(recoverSessionsMock).toHaveBeenCalledWith({
          workspaceId: REPO_ID,
          workspaceRuntimeId: nextWorkspaceRuntimeId,
        })
      })
      expect(recoverSessionsMock).not.toHaveBeenCalledWith({
        workspaceId: REPO_ID,
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
      expect(recoverSessionsMock).toHaveBeenCalledWith({
        workspaceId: REPO_ID,
        workspaceRuntimeId: firstRepo.workspaceRuntimeId,
      })
    } finally {
      result.unmount()
    }
  })

  test('does not recover terminal sessions when unrelated workspace metadata changes', async () => {
    const repo = seedCurrentRepo()
    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledOnce())
      recoverSessionsMock.mockClear()
      const changedRepo = structuredClone(repo)
      if (changedRepo.capability.kind !== 'git') throw new Error('expected Git workspace')
      changedRepo.capability.git.remote.fetchFailed = true

      await act(async () => {
        useWorkspacesStore.setState((state) => ({
          workspaces: { ...state.workspaces, [REPO_ID]: changedRepo },
        }))
      })

      expect(recoverSessionsMock).not.toHaveBeenCalled()
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
      await vi.waitFor(() =>
        expect(useTerminalProjectionHydrationStore.getState().hydrationByWorkspace.get(REPO_ID)).toMatchObject({
          workspaceRuntimeId: firstRepo.workspaceRuntimeId,
          phase: 'ready',
        }),
      )
      recoverSessionsMock.mockClear()

      await act(async () => {
        window.dispatchEvent(new Event('focus'))
      })

      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledTimes(1))
      expect(recoverSessionsMock).toHaveBeenCalledWith({
        workspaceId: REPO_ID,
        workspaceRuntimeId: firstRepo.workspaceRuntimeId,
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
        expect(useTerminalProjectionHydrationStore.getState().hydrationByWorkspace.get(REPO_ID)).toMatchObject({
          workspaceRuntimeId: repo.workspaceRuntimeId,
          phase: 'failed',
          errorMessage: 'error.workspace-runtime-stale',
        })
      })
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
    await flushMicrotasks(2)

    expect(projectionMocks.reconcileServerSessionsSnapshot).not.toHaveBeenCalled()
    expect(useTerminalProjectionHydrationStore.getState().hydrationByWorkspace.get(REPO_ID)).not.toMatchObject({
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
    await flushMicrotasks(2)

    expect(recoverSessionsMock).not.toHaveBeenCalled()
    expect(listWorkspaceTabsMock).not.toHaveBeenCalled()
  })
})

function renderRuntimeProvider(currentWorkspaceId: WorkspaceId | null) {
  return renderInJsdom(<RuntimeProbe currentWorkspaceId={currentWorkspaceId} />)
}

function RuntimeProbe({ currentWorkspaceId }: { currentWorkspaceId: WorkspaceId | null }) {
  return (
    <AppRuntimeProjectionProvider currentWorkspaceId={currentWorkspaceId}>
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
  const current = useWorkspacesStore.getState()
  const secondRepo = seedRepoWithReadModelForTest({
    id: workspaceIdForTest('goblin+file:///tmp/goblin-runtime-provider-repo-2'),
    branches: [createRepoBranch('feature/other', { worktree: { path: '/tmp/goblin-runtime-provider-worktree-2' } })],
    currentBranchName: 'feature/other',
    preferredWorkspacePaneTab: 'terminal',
    workspaceRuntimeId: 'repo-runtime-second',
  })
  useWorkspacesStore.setState((state) => ({
    ...state,
    workspaces: {
      ...current.workspaces,
      [secondRepo.id]: secondRepo,
    },
    workspaceOrder: [REPO_ID, secondRepo.id],
    restoredWorkspaceId: REPO_ID,
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
      restart: vi.fn(async () => restartResult()),
      write: vi.fn(async () => ({ status: 'accepted' as const })),
      resize: vi.fn(async () => ({ ok: false as const, message: 'not configured' })),
      takeover: vi.fn(async () => ({
        ok: true as const,
        terminalRuntimeSessionId: 'term-111111111111111111111',
        terminalRuntimeGeneration: 1,
        identityRevision: 1,
        role: 'controller' as const,
        controllerStatus: 'connected' as const,
        controller: { clientId: 'client_local', status: 'connected' as const },
        canonicalSize: { cols: 80, rows: 24 },
        phase: 'open' as const,
      })),
      close: vi.fn(async () => true),
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
    identityRevision: 0,
    snapshot: '',
    snapshotSeq: 0,
    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open',
    message: null,
    controller: { clientId: 'client_local', status: 'connected' },
    canonicalSize: { cols: 80, rows: 24 },
  }
}

function restartResult(): Extract<TerminalRestartResult, { ok: true }> {
  return {
    ok: true,
    frame: 'stream',
    terminalProjectionEffect: { kind: 'delta', revision: 1 },
    terminalRuntimeSessionId: 'unused',
    terminalRuntimeGeneration: 1,
    identityRevision: 0,
    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open',
    message: null,
    controller: { clientId: 'client_local', status: 'connected' },
    canonicalSize: { cols: 80, rows: 24 },
  }
}

function serverSession(terminalSessionId: string): TestTerminalSessionSummary {
  const repo = useWorkspacesStore.getState().workspaces[REPO_ID]
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
    identityRevision: 0,
    terminalSessionId,
    processName: 'zsh',
    canonicalTitle: null,
    controller: null,
    phase: 'open',
    message: null,
    canonicalSize: { cols: 80, rows: 24 },
  }
}

function completeServerSession(session: TestTerminalSessionSummary): TerminalSessionSummary {
  return session
}

function tabsFor(workspaceRuntimeId: string) {
  return readWorkspacePaneTabsForTarget({
    kind: 'git-worktree',
    workspaceId: REPO_ID,
    workspaceRuntimeId,
    worktreePath: WORKTREE_PATH,
  })
}

async function waitForScheduledServerSync(): Promise<void> {
  await waitForNextMacrotask()
}
