// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import type {
  TerminalAttachResult,
  TerminalSessionSummary,
  TerminalSessionsRecoveryResult,
} from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabsEntry } from '#/shared/workspace-pane-tabs.ts'
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
import { setWorkspacePaneTabsForTargetQueryData } from '#/web/test-utils/workspace-pane-tabs.ts'

const projectionMocks = vi.hoisted(() => ({
  reconcileServerSessionsSnapshot: vi.fn(() => true),
}))

vi.mock('#/web/components/terminal/use-terminal-session-projection.ts', () => ({
  useTerminalSessionProjection: () => projectionMocks,
}))

const REPO_ID = '/tmp/gbl-runtime-provider-repo'
const BRANCH_NAME = 'feature/worktree'
const WORKTREE_PATH = '/tmp/gbl-runtime-provider-worktree'

type TestTerminalSessionSummary = Omit<
  TerminalSessionSummary,
  'repoRuntimeId' | 'repoRoot' | 'branch' | 'worktreePath'
> &
  Partial<Pick<TerminalSessionSummary, 'repoRuntimeId' | 'repoRoot' | 'branch' | 'worktreePath'>>

let sessionsChangedHandler: ((repoRoot: string) => void) | null = null
let workspaceTabsChangedHandler: ((repoRoot: string) => void) | null = null
let recoveredHandler: ((clientId: string) => void) | null = null
const kickReconnectMock = vi.fn(() => {})
const recoverSessionsMock =
  vi.fn<
    (
      ...args: Array<{ repoRoot: string; repoRuntimeId: string }>
    ) => Promise<TerminalSessionsRecoveryResult>
  >()
const listWorkspaceTabsMock = vi.fn<(...args: Array<{ repoRoot: string }>) => Promise<WorkspacePaneTabsEntry[]>>()

describe('AppRuntimeProjectionProvider', () => {
  beforeEach(() => {
    sessionsChangedHandler = null
    workspaceTabsChangedHandler = null
    recoveredHandler = null
    kickReconnectMock.mockClear()
    projectionMocks.reconcileServerSessionsSnapshot.mockClear()
    projectionMocks.reconcileServerSessionsSnapshot.mockReturnValue(true)
    recoverSessionsMock.mockReset()
    recoverSessionsMock.mockResolvedValue({
      terminalSessions: { revision: 0, sessions: [] },
      snapshots: [],
      workspacePaneTabs: { revision: 0, entries: [] },
    })
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

  test('waits for workspace membership before hydrating terminal server projection', async () => {
    const repo = seedCurrentRepo()
    useReposStore.setState({ workspaceMembershipReady: false })
    recoverSessionsMock.mockResolvedValue({
      terminalSessions: {
        revision: 1,
        sessions: [completeServerSession(serverSession('term-111111111111111111111'))],
      },
      snapshots: [],
      workspacePaneTabs: { revision: 0, entries: [] },
    })
    const result = renderRuntimeProvider(REPO_ID)
    try {
      expect(recoverSessionsMock).not.toHaveBeenCalled()
      expect(useTerminalProjectionHydrationStore.getState().hydrationByRepo.get(REPO_ID)?.repoRuntimeId).not.toBe(
        repo.repoRuntimeId,
      )

      await act(async () => {
        useReposStore.setState({ workspaceMembershipReady: true })
      })

      await vi.waitFor(() => {
        expect(projectionMocks.reconcileServerSessionsSnapshot).toHaveBeenCalledWith(
          { repoRoot: REPO_ID, repoRuntimeId: repo.repoRuntimeId },
          {
            revision: 1,
            sessions: [completeServerSession(serverSession('term-111111111111111111111'))],
          },
          'client_sharedterminal',
          expect.any(Map),
        )
        expect(useTerminalProjectionHydrationStore.getState().hydrationByRepo.get(REPO_ID)).toMatchObject({
          repoRuntimeId: repo.repoRuntimeId,
          phase: 'ready',
        })
      })
    } finally {
      result.unmount()
    }
  })

  test('applies terminal recovery independently from an older workspace tabs revision', async () => {
    const repo = seedCurrentRepo()
    writeWorkspacePaneTabsSnapshotQueryData(REPO_ID, repo.repoRuntimeId, { revision: 2, entries: [] })
    recoverSessionsMock.mockResolvedValue({
      terminalSessions: {
        revision: 1,
        sessions: [completeServerSession(serverSession('term-111111111111111111111'))],
      },
      snapshots: [],
      workspacePaneTabs: { revision: 1, entries: [] },
    })

    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() => {
        expect(projectionMocks.reconcileServerSessionsSnapshot).toHaveBeenCalledWith(
          { repoRoot: REPO_ID, repoRuntimeId: repo.repoRuntimeId },
          expect.objectContaining({ revision: 1 }),
          'client_sharedterminal',
          expect.any(Map),
        )
      })
      expect(
        primaryWindowQueryClient.getQueryData(['workspace-pane-tabs', REPO_ID, repo.repoRuntimeId]),
      ).toMatchObject({ revision: 2 })
    } finally {
      result.unmount()
    }
  })

  test('refreshes workspace tabs without recovering terminal sessions from workspace tab broadcasts', async () => {
    const repo = seedCurrentRepo()
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: REPO_ID,
      repoRuntimeId: repo.repoRuntimeId,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    listWorkspaceTabsMock.mockResolvedValue([
      {
        repoRoot: REPO_ID,
        branchName: BRANCH_NAME,
        worktreePath: WORKTREE_PATH,
        tabs: [workspacePaneStaticTabEntry('history')],
      },
    ])
    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledTimes(1))
      recoverSessionsMock.mockClear()

      await act(async () => {
        workspaceTabsChangedHandler?.(REPO_ID)
        await waitForScheduledServerSync()
      })

      await vi.waitFor(() => expect(listWorkspaceTabsMock).toHaveBeenCalledTimes(1))
      expect(recoverSessionsMock).not.toHaveBeenCalled()
      expect(tabsFor(repo.repoRuntimeId)).toEqual([workspacePaneStaticTabEntry('history')])
    } finally {
      result.unmount()
    }
  })

  test('keeps terminal session and workspace tab refreshes on their own event channels', async () => {
    seedCurrentRepo()
    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledTimes(1))
      recoverSessionsMock.mockClear()

      await act(async () => {
        sessionsChangedHandler?.(REPO_ID)
        workspaceTabsChangedHandler?.(REPO_ID)
        await waitForScheduledServerSync()
      })

      expect(recoverSessionsMock).toHaveBeenCalledTimes(1)
      expect(listWorkspaceTabsMock).toHaveBeenCalledTimes(1)
    } finally {
      result.unmount()
    }
  })

  test('recovers terminal sessions and workspace tabs from server state when app realtime reconnects', async () => {
    const repo = seedCurrentRepo()
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: REPO_ID,
      repoRuntimeId: repo.repoRuntimeId,
      branchName: BRANCH_NAME,
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledTimes(1))
      recoverSessionsMock.mockClear()
      listWorkspaceTabsMock.mockClear()
      recoverSessionsMock.mockResolvedValue({
        terminalSessions: {
          revision: 2,
          sessions: [completeServerSession(serverSession('term-111111111111111111111'))],
        },
        snapshots: [],
        workspacePaneTabs: { revision: 0, entries: [] },
      })
      listWorkspaceTabsMock.mockResolvedValue([
        {
          repoRoot: REPO_ID,
          branchName: BRANCH_NAME,
          worktreePath: WORKTREE_PATH,
          tabs: [workspacePaneStaticTabEntry('history')],
        },
      ])

      await act(async () => {
        recoveredHandler?.('client_sharedterminal')
      })

      await vi.waitFor(() => {
        expect(projectionMocks.reconcileServerSessionsSnapshot).toHaveBeenLastCalledWith(
          { repoRoot: REPO_ID, repoRuntimeId: repo.repoRuntimeId },
          {
            revision: 2,
            sessions: [completeServerSession(serverSession('term-111111111111111111111'))],
          },
          'client_sharedterminal',
          expect.any(Map),
        )
        expect(tabsFor(repo.repoRuntimeId)).toEqual([workspacePaneStaticTabEntry('history')])
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
      expect(recoverSessionsMock).toHaveBeenCalledWith({ repoRoot: REPO_ID, repoRuntimeId: firstRepo.repoRuntimeId })
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
      expect(recoverSessionsMock).toHaveBeenCalledWith({ repoRoot: REPO_ID, repoRuntimeId: firstRepo.repoRuntimeId })
    } finally {
      result.unmount()
    }
  })

  test('drops a recovered terminal projection when the repo runtime changed before publish', async () => {
    const firstRepo = seedCurrentRepo()
    const recovery = Promise.withResolvers<TerminalSessionsRecoveryResult>()
    recoverSessionsMock.mockReturnValueOnce(recovery.promise)
    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledTimes(1))

      useReposStore.getState().closeRepo(REPO_ID)
      seedRepoWithReadModelForTest({
        id: REPO_ID,
        repoRuntimeId: 'repo-runtime-reopened',
        branches: [createRepoBranch(BRANCH_NAME, { worktree: { path: WORKTREE_PATH } })],
        currentBranchName: BRANCH_NAME,
        preferredWorkspacePaneTab: 'terminal',
      })
      await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledTimes(2))
      await vi.waitFor(() => expect(projectionMocks.reconcileServerSessionsSnapshot).toHaveBeenCalledTimes(1))
      projectionMocks.reconcileServerSessionsSnapshot.mockClear()

      await act(async () => {
        recovery.resolve({
          terminalSessions: {
            revision: 1,
            sessions: [
              completeServerSession({
                ...serverSession('term-111111111111111111111'),
                repoRuntimeId: firstRepo.repoRuntimeId,
              }),
            ],
          },
          snapshots: [],
          workspacePaneTabs: { revision: 0, entries: [] },
        })
        await Promise.resolve()
      })

      expect(projectionMocks.reconcileServerSessionsSnapshot).not.toHaveBeenCalled()
      expect(useTerminalProjectionHydrationStore.getState().hydrationByRepo.get(REPO_ID)).not.toMatchObject({
        repoRuntimeId: firstRepo.repoRuntimeId,
        phase: 'ready',
      })
    } finally {
      result.unmount()
    }
  })

  test('failed initial terminal projection hydrate marks the repo failed', async () => {
    const repo = seedCurrentRepo()
    recoverSessionsMock.mockRejectedValueOnce(new Error('error.repo-runtime-stale'))
    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() => {
        expect(useTerminalProjectionHydrationStore.getState().hydrationByRepo.get(REPO_ID)).toMatchObject({
          repoRuntimeId: repo.repoRuntimeId,
          phase: 'failed',
          errorMessage: 'error.repo-runtime-stale',
        })
      })
    } finally {
      result.unmount()
    }
  })

  test('does not publish a pending recovery after provider unmount', async () => {
    const repo = seedCurrentRepo()
    const recovery = Promise.withResolvers<TerminalSessionsRecoveryResult>()
    recoverSessionsMock.mockReturnValueOnce(recovery.promise)
    const result = renderRuntimeProvider(REPO_ID)
    await vi.waitFor(() => expect(recoverSessionsMock).toHaveBeenCalledOnce())

    result.unmount()
    recovery.resolve({
      terminalSessions: {
        revision: 1,
        sessions: [completeServerSession(serverSession('term-111111111111111111111'))],
      },
      snapshots: [],
      workspacePaneTabs: { revision: 1, entries: [] },
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(projectionMocks.reconcileServerSessionsSnapshot).not.toHaveBeenCalled()
    expect(useTerminalProjectionHydrationStore.getState().hydrationByRepo.get(REPO_ID)).not.toMatchObject({
      repoRuntimeId: repo.repoRuntimeId,
      phase: 'ready',
    })
  })

  test('failed focus projection refresh does not replace an already ready hydrate', async () => {
    const repo = seedCurrentRepo()
    useTerminalProjectionHydrationStore.setState({ refreshCooldownMs: 0 })
    const result = renderRuntimeProvider(REPO_ID)
    try {
      await vi.waitFor(() => {
        expect(useTerminalProjectionHydrationStore.getState().hydrationByRepo.get(REPO_ID)).toMatchObject({
          repoRuntimeId: repo.repoRuntimeId,
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
        repoRuntimeId: repo.repoRuntimeId,
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
    id: '/tmp/gbl-runtime-provider-repo-2',
    branches: [createRepoBranch('feature/other', { worktree: { path: '/tmp/gbl-runtime-provider-worktree-2' } })],
    currentBranchName: 'feature/other',
    preferredWorkspacePaneTab: 'terminal',
    repoRuntimeId: 'repo-runtime-second',
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
      restart: vi.fn(async () => attachResult()),
      write: vi.fn(async () => true),
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
      onSessionsChanged: vi.fn((cb: (repoRoot: string) => void) => {
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
      onChanged: vi.fn((cb: (repoRoot: string) => void) => {
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

function attachResult(): TerminalAttachResult {
  return {
    ok: true,
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
  return {
    terminalRuntimeSessionId: `runtime-${terminalSessionId}`,
        terminalRuntimeGeneration: 1,
    terminalSessionId,
    processName: 'zsh',
    canonicalTitle: null,
    cwd: WORKTREE_PATH,
    controller: null,
    phase: 'open',
    message: null,
    cols: 80,
    rows: 24,
  }
}

function completeServerSession(session: TestTerminalSessionSummary): TerminalSessionSummary {
  return {
    ...session,
    repoRuntimeId: session.repoRuntimeId ?? useReposStore.getState().repos[REPO_ID]!.repoRuntimeId,
    repoRoot: session.repoRoot ?? REPO_ID,
    branch: session.branch ?? BRANCH_NAME,
    worktreePath: session.worktreePath ?? WORKTREE_PATH,
  }
}

function tabsFor(repoRuntimeId: string) {
  return readWorkspacePaneTabsForTarget({
    repoRoot: REPO_ID,
    repoRuntimeId,
    branchName: BRANCH_NAME,
    worktreePath: WORKTREE_PATH,
  })
}

async function waitForScheduledServerSync(): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
}
