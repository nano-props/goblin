// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { ELECTRON_CLIENT_CAPABILITIES, CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { TerminalSessionProvider } from '#/web/components/terminal/TerminalSessionProvider.tsx'
import { setTerminalSessionProjectionForTests } from '#/web/components/terminal/TerminalSessionProjection.ts'
import { terminalSessionProviderLog } from '#/web/logger.ts'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import {
  useWorktreeTerminalCount,
  useTerminalSessionSummaries,
} from '#/web/components/terminal/terminal-session-store.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-workspace-slot-keys.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { settingsSnapshotQueryKey } from '#/web/settings-queries.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  preferredWorkspacePaneTabForBranch,
  preferredWorkspacePaneTabByBranchRecordWith,
} from '#/web/stores/repos/workspace-pane-preferences.ts'
import { useRepoSyncStore } from '#/web/stores/repo-sync.ts'
import type {
  TerminalBellEvent,
  TerminalDescriptor,
  TerminalIdentityViewModel,
  TerminalLifecycleViewModel,
  TerminalSearchResult,
  TerminalSessionContextValue,
  TerminalSnapshot,
} from '#/web/components/terminal/types.ts'
import type {
  TerminalCatalogMutationResult,
  TerminalCreateInput,
  TerminalExitEvent,
  TerminalAttachResult,
  TerminalOutputEvent,
  TerminalSessionSnapshot,
  TerminalSessionSummary,
  TerminalTitleEvent,
} from '#/shared/terminal-types.ts'

const mockSessions = vi.hoisted(
  () =>
    [] as Array<{
      descriptor: TerminalDescriptor
      emitBell: (event: TerminalBellEvent) => void
      setSerializeValue: (value: string) => void
      hydrate: ReturnType<typeof vi.fn>
      handleOutput: ReturnType<typeof vi.fn>
      handleServerTitle: ReturnType<typeof vi.fn>
      handleIdentity: ReturnType<typeof vi.fn>
      handleLifecycle: ReturnType<typeof vi.fn>
    }>,
)

const geometryMocks = vi.hoisted(() => ({
  preloadTerminalFont: vi.fn(async () => {}),
  estimateTerminalGeometry: vi.fn(() => ({ cols: 100, rows: 30 })),
  estimateManagedTerminalGeometry: vi.fn(() => ({ cols: 100, rows: 30 })),
}))

vi.mock('#/web/components/terminal/terminal-geometry.ts', async () => {
  const actual =
    await vi.importActual<typeof import('#/web/components/terminal/terminal-geometry.ts')>(
      '#/web/components/terminal/terminal-geometry.ts',
    )
  return {
    ...actual,
    preloadTerminalFont: geometryMocks.preloadTerminalFont,
    estimateTerminalGeometry: geometryMocks.estimateTerminalGeometry,
    estimateManagedTerminalGeometry: geometryMocks.estimateManagedTerminalGeometry,
  }
})

function selectedWorkspacePaneTab(repoId: string) {
  const repo = useReposStore.getState().repos[repoId]
  return repo ? preferredWorkspacePaneTabForBranch(repo.ui, repo.ui.selectedBranch) : null
}

vi.mock('#/web/components/terminal/TerminalSession.ts', () => {
  class TerminalSession {
    descriptor: TerminalDescriptor
    private readonly onBell: (descriptor: TerminalDescriptor, event: TerminalBellEvent) => void
    private readonly notify: () => void
    private readonly handleOutputSpy = vi.fn()
    private readonly handleServerTitleSpy = vi.fn()
    private readonly handleIdentitySpy = vi.fn()
    private readonly handleLifecycleSpy = vi.fn()
    private readonly hydrateSpy = vi.fn()
    private readonly detachSpy = vi.fn()
    private serializeValue = ''
    private ptySessionId: string | null = null
    private snapshotValue: TerminalSnapshot

    constructor(
      descriptor: TerminalDescriptor,
      _notify: () => void,
      onBell: (descriptor: TerminalDescriptor, event: TerminalBellEvent) => void,
    ) {
      this.descriptor = descriptor
      this.notify = _notify
      this.onBell = onBell
      this.ptySessionId = null
      this.snapshotValue = {
        phase: 'opening',
        message: null,
        processName: `terminal ${this.descriptor.index}`,
        canonicalTitle: null,
      }
      mockSessions.push({
        descriptor,
        emitBell: (event) => this.onBell(this.descriptor, event),
        setSerializeValue: (value) => {
          this.serializeValue = value
        },
        hydrate: this.hydrateSpy,
        handleOutput: this.handleOutputSpy,
        handleServerTitle: this.handleServerTitleSpy,
        handleIdentity: this.handleIdentitySpy,
        handleLifecycle: this.handleLifecycleSpy,
      })
    }

    updateDescriptor(descriptor: TerminalDescriptor) {
      this.descriptor = descriptor
    }

    attach() {}

    detach() {
      this.detachSpy()
    }

    restart() {}

    focus() {}

    dispose() {}

    snapshot(): TerminalSnapshot {
      return this.snapshotValue
    }

    isTerminalFocusTarget(): boolean {
      return false
    }

    findNext(): TerminalSearchResult {
      return { resultIndex: -1, resultCount: 0, found: false }
    }

    findPrevious(): TerminalSearchResult {
      return { resultIndex: -1, resultCount: 0, found: false }
    }

    clearSearch() {}

    scrollToBottom() {}

    writeInput() {}

    takeover() {}

    serialize(): string {
      return this.serializeValue
    }

    currentPtySessionId(): string | null {
      return this.ptySessionId
    }

    hydrate(input: {
      ptySessionId: string
      phase: 'opening' | 'open' | 'error'
      message: string | null
      processName: string
      canonicalTitle?: string | null
      role: 'controller' | 'viewer' | 'unowned'
      controllerStatus: 'connected' | 'none'
      canonicalCols: number
      canonicalRows: number
      snapshot?: string
      snapshotSeq?: number
    }) {
      this.hydrateSpy(input)
      this.ptySessionId = input.ptySessionId
      this.snapshotValue = {
        phase: input.phase,
        message: input.message,
        processName: input.processName,
        canonicalTitle: input.canonicalTitle ?? null,
        attachment: {
          role: input.role,
          controllerStatus: input.controllerStatus,
          active: input.role === 'controller',
          canTakeover: input.role !== 'controller',
          canonicalCols: input.canonicalCols,
          canonicalRows: input.canonicalRows,
        },
      }
      this.serializeValue = input.snapshot ?? this.serializeValue
      this.notify()
    }

    handleOutput(event: TerminalOutputEvent) {
      this.handleOutputSpy(event)
      this.snapshotValue = {
        ...this.snapshotValue,
        processName: event.processName,
      }
      this.notify()
    }

    handleServerTitle(canonicalTitle: string | null) {
      this.handleServerTitleSpy(canonicalTitle)
      this.snapshotValue = {
        ...this.snapshotValue,
        canonicalTitle,
      }
      this.notify()
    }

    handleIdentity(event: {
      ptySessionId: string
      role: 'controller' | 'viewer' | 'unowned'
      controllerStatus: 'connected' | 'none'
      canonicalCols: number
      canonicalRows: number
    }) {
      this.handleIdentitySpy(event)
    }

    handleLifecycle(event: {
      ptySessionId: string
      phase: 'opening' | 'restarting' | 'open' | 'error' | 'closed'
      message: string | null
      takeoverPending: boolean
    }) {
      this.handleLifecycleSpy(event)
    }

    handleExit(_event: TerminalExitEvent): boolean {
      return true
    }
  }

  return { TerminalSession }
})

const REPO_ID = '/tmp/gbl-terminal-provider-repo'
const WORKTREE_PATH = '/tmp/gbl-terminal-provider-worktree'
const SECOND_REPO_ID = '/tmp/gbl-terminal-provider-repo-2'
const SECOND_WORKTREE_PATH = '/tmp/gbl-terminal-provider-worktree-2'

let exitHandler: ((event: TerminalExitEvent) => void) | null = null
let outputHandler: ((event: TerminalOutputEvent) => void) | null = null
let titleHandler: ((event: TerminalTitleEvent) => void) | null = null
let identityHandler: ((event: TerminalIdentityViewModel) => void) | null = null
let lifecycleHandler: ((event: TerminalLifecycleViewModel) => void) | null = null
let sessionsChangedHandler: ((repoRoot: string) => void) | null = null
let workspacePaneChangedHandler: ((repoRoot: string) => void) | null = null
let sessionClosedHandler: ((event: { ptySessionId: string; repoRoot: string }) => void) | null = null
type TestTerminalSessionSummary = Omit<TerminalSessionSummary, 'viewType' | 'viewId'> &
  Partial<Pick<TerminalSessionSummary, 'viewType' | 'viewId'>>
const listSessionsMock = vi.fn<(...args: Array<{ repoRoot: string }>) => Promise<TestTerminalSessionSummary[]>>(
  async () => [],
)
const getSessionSnapshotMock = vi.fn<
  (...args: Array<{ ptySessionId: string }>) => Promise<TerminalSessionSnapshot | null>
>(async () => null)
const closeMock = vi.fn(async () => true)
const createTerminalMock = vi.fn<(input: TerminalCreateInput) => Promise<TerminalCatalogMutationResult>>()
let serverSessions: TestTerminalSessionSummary[] = []

function completeServerSession(session: TestTerminalSessionSummary): TerminalSessionSummary {
  return {
    ...session,
    viewType: session.viewType ?? 'terminal',
    viewId: session.viewId ?? session.key,
  }
}

function completeServerSessions(sessions: TestTerminalSessionSummary[]): TerminalSessionSummary[] {
  return sessions.map(completeServerSession)
}

async function emitSessionsChanged(repoRoot = REPO_ID): Promise<void> {
  await act(async () => {
    sessionsChangedHandler?.(repoRoot)
    await waitForScheduledServerSync()
  })
}

async function waitForScheduledServerSync(): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
}

function attachResult(): TerminalAttachResult {
  return {
    ok: true,
    ptySessionId: 'unused',
    snapshot: '',
    snapshotSeq: 0,
    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open',
    message: null,
    controller: { clientId: 'client_local', status: 'connected' },
    canonicalCols: 80,
    canonicalRows: 24,
  }
}

beforeEach(() => {
  exitHandler = null
  outputHandler = null
  titleHandler = null
  identityHandler = null
  sessionsChangedHandler = null
  workspacePaneChangedHandler = null
  sessionClosedHandler = null
  mockSessions.length = 0
  serverSessions = []
  listSessionsMock.mockReset()
  listSessionsMock.mockImplementation(async () => serverSessions)
  getSessionSnapshotMock.mockReset()
  getSessionSnapshotMock.mockResolvedValue(null)
  closeMock.mockReset()
  closeMock.mockResolvedValue(true)
  createTerminalMock.mockReset()
  createTerminalMock.mockImplementation(async (input) => {
    const currentSessions = await listSessionsMock({ repoRoot: input.repoRoot })
    const sessionId =
      input.kind === 'primary'
        ? 'session-1'
        : `session-${
            currentSessions.reduce((max, session) => {
              const match = /session-(\d+)$/.exec(session.key)
              const index = Number.parseInt(match?.[1] ?? '', 10)
              return Number.isFinite(index) ? Math.max(max, index) : max
            }, 0) + 1
          }`
    const key = `${input.repoRoot}\u0000${input.worktreePath}\u0000${sessionId}`
    if (input.kind === 'primary' && currentSessions.some((session) => session.key === key)) {
      serverSessions = currentSessions
      const reused = currentSessions.find((session) => session.key === key)
      // Reused session also has to supply first-frame hydration
      // fields — the registry validates them on every successful
      // `create` response, not just newly-created ones.
      return {
        ok: true,
        action: 'reused',
        key,
        sessions: completeServerSessions(serverSessions),
        ptySessionId: reused?.ptySessionId ?? 'session-1',
        snapshot: '',
        snapshotSeq: 0,
        processName: reused?.processName ?? 'zsh',
        canonicalTitle: reused?.canonicalTitle ?? null,
        phase: reused?.phase ?? 'open',
        message: reused?.message ?? null,
        controller: reused?.controller ?? null,
        canonicalCols: reused?.cols ?? 80,
        canonicalRows: reused?.rows ?? 24,
      }
    }
    const controller = input.clientId ? { clientId: input.clientId, status: 'connected' as const } : null
    serverSessions = [
      ...currentSessions
        .filter((session) => session.key !== key)
        .map((session) => ({
          ...session,
          controller: session.controller?.clientId === input.clientId ? null : session.controller,
        })),
      {
        ptySessionId: sessionId,
        key,
        cwd: input.worktreePath,
        controller,
        processName: sessionId,
        canonicalTitle: null,
        phase: 'open',
        message: null,
        cols: 80,
        rows: 24,
        displayOrder: 1,
      },
    ]
    // New first-frame hydration contract: `create` returns
    // `ptySessionId` + `snapshot` + `snapshotSeq` directly so the
    // client can paint without a follow-up snapshot fetch.
    // The fields are still optional on the shared type (transitional
    // shape — see docs/terminal-first-frame-fix.md) but the
    // registry validates them at runtime, so the test mock has to
    // supply them.
    return {
      ok: true,
      action: 'created',
      key,
      sessions: completeServerSessions(serverSessions),
      ptySessionId: sessionId,
      snapshot: '',
      snapshotSeq: 0,
      processName: 'zsh',
      canonicalTitle: null,
      phase: 'open',
      message: null,
      controller,
      canonicalCols: 80,
      canonicalRows: 24,
    }
  })
  resetReposStore()
  useRepoSyncStore.setState(useRepoSyncStore.getInitialState())
  window.sessionStorage.setItem('goblin:terminal-client-id', 'client_local')
  primaryWindowQueryClient.clear()
  primaryWindowQueryClient.setQueryData(
    settingsSnapshotQueryKey(),
    defaultSettingsSnapshot({ terminalNotificationsEnabled: false }),
  )
  document.body.innerHTML = ''
  Object.defineProperty(window, 'goblinNative', {
    configurable: true,
    value: {
      runtime: {
        kind: 'electron',
        bridgeVersion: CLIENT_BRIDGE_VERSION,
        capabilities: [...ELECTRON_CLIENT_CAPABILITIES],
      },
      initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret', clientId: 'client_sharedterminal' },
      invokeIpc: vi.fn(async () => []),
      abortIpc: vi.fn(),
      onEvent: vi.fn(() => () => {}),
      pathForFile: vi.fn(() => ''),
      terminal: {
        attach: vi.fn(async () => ({
          ok: true,
          ptySessionId: 'unused',
          replay: '',
          replaySeq: 0,
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'open',
          message: null,
        })),
        restart: vi.fn(async () => ({
          ok: true,
          ptySessionId: 'unused',
          replay: '',
          replaySeq: 0,
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'open',
          message: null,
        })),
        write: vi.fn(async () => true),
        resize: vi.fn(async () => true),
        takeover: vi.fn(async () => ({
          ok: true as const,
          ptySessionId: 'session-1',
          role: 'controller' as const,
          controllerStatus: 'connected' as const,
          controller: { clientId: 'client_local', status: 'connected' as const },
          canonicalCols: 80,
          canonicalRows: 24,
          phase: 'open' as const,
        })),
        close: closeMock,
        notifyBell: vi.fn(async () => true),
        setBadge: vi.fn(async () => {}),
        create: createTerminalMock,
        pruneTerminals: vi.fn(async () => ({ pruned: 0, remaining: 0 })),
        listSessions: async (input: { repoRoot: string }) => completeServerSessions(await listSessionsMock(input)),
        listViews: vi.fn(async () => []),
        getSessionSnapshot: getSessionSnapshotMock,
        onOutput: vi.fn((cb: (event: TerminalOutputEvent) => void) => {
          outputHandler = cb
          return () => {}
        }),
        onTitle: vi.fn((cb: (event: TerminalTitleEvent) => void) => {
          titleHandler = cb
          return () => {}
        }),
        onExit: vi.fn((cb: (event: TerminalExitEvent) => void) => {
          exitHandler = cb
          return () => {}
        }),
        onIdentity: vi.fn((cb: (event: TerminalIdentityViewModel) => void) => {
          identityHandler = cb
          return () => {}
        }),
        onLifecycle: vi.fn((cb: (event: TerminalLifecycleViewModel) => void) => {
          lifecycleHandler = cb
          return () => {}
        }),
        onSessionsChanged: vi.fn((cb: (repoRoot: string) => void) => {
          sessionsChangedHandler = cb
          return () => {
            if (sessionsChangedHandler === cb) sessionsChangedHandler = null
          }
        }),
        onWorkspacePaneChanged: vi.fn((cb: (repoRoot: string) => void) => {
          workspacePaneChangedHandler = cb
          return () => {
            if (workspacePaneChangedHandler === cb) workspacePaneChangedHandler = null
          }
        }),
      },
    },
  })
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
  setClientBridgeForTests({
    kind: () => 'electron',
    hasCapability: (capability) =>
      capability === 'settings-ipc' ||
      capability === 'open-settings-window' ||
      capability === 'open-external-url' ||
      capability === 'open-directory-dialog' ||
      capability === 'consume-external-open-paths' ||
      capability === 'terminal-notifications' ||
      capability === 'terminal-badge',
    getBootstrap: () => ({
      runtime: {
        kind: 'electron',
        bridgeVersion: CLIENT_BRIDGE_VERSION,
        capabilities: [...ELECTRON_CLIENT_CAPABILITIES],
      },
      initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret', clientId: 'client_sharedterminal' },
    }),
    invokeIpc: vi.fn(async () => []),
    abortIpc: vi.fn(async () => false),
    onIpcEvent: vi.fn(() => () => {}),
    onEffectIntent: vi.fn(() => () => {}),
    pathForFile: vi.fn(() => ''),
    saveClipboardFiles: vi.fn(() => Promise.resolve([])),
    host: () => null,
    terminal: () => ({
      attach: vi.fn(async () => attachResult()),
      restart: vi.fn(async () => attachResult()),
      write: vi.fn(async () => true),
      resize: vi.fn(async () => true),
      takeover: vi.fn(async () => ({
        ok: true as const,
        ptySessionId: 'session-1',
        role: 'controller' as const,
        controllerStatus: 'connected' as const,
        controller: { clientId: 'client_local', status: 'connected' as const },
        canonicalCols: 80,
        canonicalRows: 24,
        phase: 'open' as const,
      })),
      close: closeMock,
      create: createTerminalMock,
      pruneTerminals: vi.fn(async () => ({ pruned: 0, remaining: 0 })),
      listSessions: async (input) => completeServerSessions(await listSessionsMock(input)),
      listViews: vi.fn(async () => []),
      openView: vi.fn(async () => true),
      closeView: vi.fn(async () => true),
      prewarm: vi.fn(async () => {}),
      kickReconnect: vi.fn(() => {}),
      getSessionSnapshot: getSessionSnapshotMock,
      reorderViews: vi.fn(async () => true),
      notifyBell: window.goblinNative.terminal.notifyBell ?? vi.fn(async () => true),
      sendTestNotification: vi.fn(async () => true),
      setBadge: window.goblinNative.terminal.setBadge ?? vi.fn(() => {}),
      onOutput: vi.fn((cb: (event: TerminalOutputEvent) => void) => {
        outputHandler = cb
        return () => {}
      }),
      onTitle: vi.fn((cb: (event: TerminalTitleEvent) => void) => {
        titleHandler = cb
        return () => {}
      }),
      onExit: vi.fn((cb: (event: TerminalExitEvent) => void) => {
        exitHandler = cb
        return () => {}
      }),
      onIdentity: vi.fn((cb: (event: TerminalIdentityViewModel) => void) => {
        identityHandler = cb
        return () => {}
      }),
      onLifecycle: vi.fn((cb: (event: TerminalLifecycleViewModel) => void) => {
        lifecycleHandler = cb
        return () => {}
      }),
      onSessionsChanged: vi.fn((cb: (repoRoot: string) => void) => {
        sessionsChangedHandler = cb
        return () => {
          if (sessionsChangedHandler === cb) sessionsChangedHandler = null
        }
      }),
      onWorkspacePaneChanged: vi.fn((cb: (repoRoot: string) => void) => {
        workspacePaneChangedHandler = cb
        return () => {
          if (workspacePaneChangedHandler === cb) workspacePaneChangedHandler = null
        }
      }),
      onSessionClosed: vi.fn((cb: (event: { ptySessionId: string; repoRoot: string }) => void) => {
        sessionClosedHandler = cb
        return () => {
          if (sessionClosedHandler === cb) sessionClosedHandler = null
        }
      }),
    }),
  })
})

describe('TerminalSessionProvider', () => {
  // The Provider reaches the registry via the client-level singleton.
  // Each test must clear the slot so a previous test's bridge wiring
  // doesn't leak into the next one. Mirrors
  // `setTerminalSessionProjectionForTests(null)` in the registry tests.
  afterEach(() => {
    setTerminalSessionProjectionForTests(null)
  })
  test('keeps terminal detail open and switches the selected session when one of multiple terminals exits', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      const base = { repoRoot: REPO_ID, branch: 'feature/worktree', worktreePath: WORKTREE_PATH }
      await act(async () => {
        useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'terminal')
        await getContext().createTerminal(base)
        await getContext().createTerminal(base)
      })

      expect(createTerminalMock).toHaveBeenCalledTimes(2)
      expect(createTerminalMock).toHaveBeenNthCalledWith(1, {
        ...base,
        kind: 'primary',
        clientId: 'client_local',
        cols: 100,
        rows: 30,
      })
      expect(createTerminalMock).toHaveBeenNthCalledWith(2, {
        ...base,
        kind: 'additional',
        clientId: 'client_local',
        cols: 100,
        rows: 30,
      })
      expect(getProbe().summaries.map((session) => [session.sessionId, session.selected, session.hasBell])).toEqual([
        ['session-1', false, false],
        ['session-2', true, false],
      ])

      await act(async () => {
        exitHandler?.({ ptySessionId: 'session-2' })
      })

      expect(closeMock).not.toHaveBeenCalled()
      expect(selectedWorkspacePaneTab(REPO_ID)).toBe('terminal')
      expect(getProbe().summaries.map((session) => [session.sessionId, session.selected, session.hasBell])).toEqual([
        ['session-1', true, false],
      ])

      // With the derived-value pattern, the store never re-projects the
      // preferred tab when terminal sessions go to zero. The user's intent
      // is preserved; `resolveRenderableWorkspacePaneTab` resolves the rendered tab
      // at read time (covered by `workspace-pane-tabs.ts` and
      // `workspace-pane-tab.test.ts`).
      await act(async () => {
        exitHandler?.({ ptySessionId: 'session-1' })
      })

      expect(closeMock).not.toHaveBeenCalled()
      expect(selectedWorkspacePaneTab(REPO_ID)).toBe('terminal')
    } finally {
      await unmount()
    }
  })

  test('tracks unread bells in provider state and clears them when activating the session', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    primaryWindowQueryClient.setQueryData(
      settingsSnapshotQueryKey(),
      defaultSettingsSnapshot({ terminalNotificationsEnabled: true }),
    )
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const notifyBell = vi.fn(async () => true)
    Object.assign(window.goblinNative.terminal, { notifyBell })
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      const base = { repoRoot: REPO_ID, branch: 'feature/worktree', worktreePath: WORKTREE_PATH }
      await act(async () => {
        await getContext().createTerminal(base)
        await getContext().createTerminal(base)
      })

      const firstSession = mockSessions.find((session) => session.descriptor.sessionId === 'session-1')
      if (!firstSession) throw new Error('missing session-1 mock session')

      await act(async () => {
        firstSession.emitBell({
          processName: 'zsh',
          canonicalTitle: '~/Developer/goblin — npm run dev',
          visible: false,
        })
      })

      expect(getProbe().summaries.map((session) => [session.sessionId, session.selected, session.hasBell])).toEqual([
        ['session-1', false, true],
        ['session-2', true, false],
      ])
      expect(notifyBell).toHaveBeenCalledWith({
        title: 'gbl-terminal-provider-repo',
        body: 'feature/worktree\n~/Developer/goblin — npm run dev',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000session-1`,
        repoRoot: REPO_ID,
      })

      await act(async () => {
        const firstKey = getProbe().summaries[0]?.key
        if (!firstKey) throw new Error('missing session-1 key')
        getContext().selectTerminal(terminalWorktreeKey, firstKey)
      })

      expect(getProbe().summaries.map((session) => [session.sessionId, session.selected, session.hasBell])).toEqual([
        ['session-1', true, false],
        ['session-2', false, false],
      ])
      expect(useReposStore.getState().selectedTerminalSessionByWorktree).toMatchObject({
        [terminalWorktreeKey]: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000session-1`,
      })
    } finally {
      hasFocus.mockRestore()
      await unmount()
    }
  })

  test('routes realtime output, title, and identity directly to the matching terminal session', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getContext, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      const base = { repoRoot: REPO_ID, branch: 'feature/worktree', worktreePath: WORKTREE_PATH }
      await act(async () => {
        await getContext().createTerminal(base)
        await getContext().createTerminal(base)
      })

      const first = mockSessions.find((session) => session.descriptor.sessionId === 'session-1')
      const second = mockSessions.find((session) => session.descriptor.sessionId === 'session-2')
      if (!first || !second) throw new Error('missing terminal mock sessions')

      await act(async () => {
        outputHandler?.({ ptySessionId: 'session-1', data: 'hello', seq: 1, processName: 'zsh' })
        titleHandler?.({ ptySessionId: 'session-1', canonicalTitle: '~/Developer/goblin — npm run dev' })
        identityHandler?.({
          ptySessionId: 'session-2',
          role: 'controller',
          controllerStatus: 'connected',
          canonicalCols: 100,
          canonicalRows: 30,
        })
        lifecycleHandler?.({
          ptySessionId: 'session-2',
          phase: 'open',
          message: null,
          takeoverPending: false,
        })
      })

      expect(first.handleOutput).toHaveBeenCalledTimes(1)
      expect(first.handleOutput).toHaveBeenCalledWith({
        ptySessionId: 'session-1',
        data: 'hello',
        seq: 1,
        processName: 'zsh',
      })
      expect(first.handleServerTitle).toHaveBeenCalledTimes(1)
      expect(first.handleServerTitle).toHaveBeenCalledWith('~/Developer/goblin — npm run dev')
      expect(second.handleIdentity).toHaveBeenCalledTimes(1)
      expect(second.handleIdentity).toHaveBeenCalledWith({
        ptySessionId: 'session-2',
        role: 'controller',
        controllerStatus: 'connected',
        canonicalCols: 100,
        canonicalRows: 30,
      })
      expect(second.handleLifecycle).toHaveBeenCalledWith({
        ptySessionId: 'session-2',
        phase: 'open',
        message: null,
        takeoverPending: false,
      })
      expect(first.handleIdentity).not.toHaveBeenCalled()
    } finally {
      await unmount()
    }
  })

  test('updates reused terminal descriptors when the branch changes on the same worktree', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    primaryWindowQueryClient.setQueryData(
      settingsSnapshotQueryKey(),
      defaultSettingsSnapshot({ terminalNotificationsEnabled: true }),
    )
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const notifyBell = vi.fn(async () => true)
    Object.assign(window.goblinNative.terminal, { notifyBell })
    const { getContext, unmount } = await renderProvider()

    try {
      const base = { repoRoot: REPO_ID, branch: 'feature/worktree', worktreePath: WORKTREE_PATH }
      await act(async () => {
        await getContext().createTerminal(base)
      })

      await act(async () => {
        useReposStore.setState((state) => ({
          repos: {
            ...state.repos,
            [REPO_ID]: state.repos[REPO_ID]
              ? {
                  ...state.repos[REPO_ID],
                  data: {
                    ...state.repos[REPO_ID]!.data,
                    branches: [createRepoBranch('feature/renamed', { worktree: { path: WORKTREE_PATH } })],
                  },
                  ui: {
                    ...state.repos[REPO_ID]!.ui,
                    selectedBranch: 'feature/renamed',
                  },
                }
              : state.repos[REPO_ID],
          },
        }))
        await Promise.resolve()
      })

      const session = mockSessions.find((item) => item.descriptor.sessionId === 'session-1')
      if (!session) throw new Error('missing session-1 mock session')

      await act(async () => {
        session.emitBell({ processName: 'zsh', canonicalTitle: '~/Developer/goblin — npm run dev', visible: false })
      })

      expect(notifyBell).toHaveBeenLastCalledWith({
        title: 'gbl-terminal-provider-repo',
        body: 'feature/renamed\n~/Developer/goblin — npm run dev',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000session-1`,
        repoRoot: REPO_ID,
      })
    } finally {
      hasFocus.mockRestore()
      await unmount()
    }
  })

  test('reconciles externally created and removed terminal sessions across windows', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        ptySessionId: 'server_session_1',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000session-1`,
        cwd: WORKTREE_PATH,
        controller: { clientId: 'client_remote', status: 'connected' },
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        cols: 120,
        rows: 40,
        displayOrder: 1,
      },
    ])
    getSessionSnapshotMock.mockResolvedValue({
      ptySessionId: 'server_session_1',
      snapshot: 'hydrated-screen',
      snapshotSeq: 5,
    })
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await emitSessionsChanged()

      expect(getProbe().summaries).toEqual([
        expect.objectContaining({ sessionId: 'session-1', title: 'zsh', phase: 'open' }),
      ])
      const hydrated = mockSessions.find((session) => session.descriptor.sessionId === 'session-1')
      expect(hydrated?.hydrate).toHaveBeenCalledWith(
        expect.objectContaining({
          ptySessionId: 'server_session_1',
          processName: 'zsh',
          role: 'viewer',
          controllerStatus: 'connected',
          canonicalCols: 120,
          canonicalRows: 40,
          snapshot: 'hydrated-screen',
          snapshotSeq: 5,
        }),
      )

      listSessionsMock.mockResolvedValue([])
      await emitSessionsChanged()

      expect(getProbe().summaries).toEqual([])
    } finally {
      await unmount()
    }
  })

  test('coalesces compatibility session and workspace pane change broadcasts', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await vi.waitFor(() => expect(listSessionsMock).toHaveBeenCalledTimes(1))
      listSessionsMock.mockClear()

      await act(async () => {
        sessionsChangedHandler?.(REPO_ID)
        workspacePaneChangedHandler?.(REPO_ID)
        await waitForScheduledServerSync()
      })

      expect(listSessionsMock).toHaveBeenCalledTimes(1)
    } finally {
      await unmount()
    }
  })

  test('keeps a newly created terminal active after session sync when create transfers controller control', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    serverSessions = [
      {
        ptySessionId: 'server_session_1',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000session-1`,
        cwd: WORKTREE_PATH,
        controller: { clientId: 'client_local', status: 'connected' },
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        cols: 80,
        rows: 24,
        displayOrder: 1,
      },
    ]
    listSessionsMock.mockImplementation(async () => serverSessions)
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await emitSessionsChanged()
      expect(getProbe().summaries.map((session) => [session.sessionId, session.selected])).toEqual([
        ['session-1', true],
      ])

      const base = { repoRoot: REPO_ID, branch: 'feature/worktree', worktreePath: WORKTREE_PATH }
      await act(async () => {
        await getContext().createTerminal(base)
      })
      expect(getProbe().summaries.map((session) => [session.sessionId, session.selected])).toEqual([
        ['session-1', false],
        ['session-2', true],
      ])

      await emitSessionsChanged()

      expect(getProbe().summaries.map((session) => [session.sessionId, session.selected])).toEqual([
        ['session-1', false],
        ['session-2', true],
      ])
    } finally {
      await unmount()
    }
  })

  test('restores the persisted selected terminal for a worktree even when server control points at another session', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    useReposStore.setState({
      selectedTerminalSessionByWorktree: {
        [terminalWorktreeKey]: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000session-1`,
      },
    })
    serverSessions = [
      {
        ptySessionId: 'server_session_1',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000session-1`,
        cwd: WORKTREE_PATH,
        controller: null,
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        cols: 80,
        rows: 24,
        displayOrder: 1,
      },
      {
        ptySessionId: 'server_session_2',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000session-2`,
        cwd: WORKTREE_PATH,
        controller: { clientId: 'client_local', status: 'connected' },
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        cols: 80,
        rows: 24,
        displayOrder: 1,
      },
    ]
    listSessionsMock.mockImplementation(async () => serverSessions)
    const { getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await emitSessionsChanged()

      expect(getProbe().summaries.map((session) => [session.sessionId, session.selected])).toEqual([
        ['session-1', true],
        ['session-2', false],
      ])
      expect(useReposStore.getState().selectedTerminalSessionByWorktree).toMatchObject({
        [terminalWorktreeKey]: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000session-1`,
      })
    } finally {
      await unmount()
    }
  })

  test('initial mount only syncs the current repo session list', async () => {
    const firstRepo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    const secondRepo = {
      ...firstRepo,
      id: SECOND_REPO_ID,
      instanceToken: firstRepo.instanceToken + 1,
      data: {
        ...firstRepo.data,
        branches: [createRepoBranch('feature/other', { worktree: { path: SECOND_WORKTREE_PATH } })],
        worktreesByPath: {
          [SECOND_WORKTREE_PATH]: {
            path: SECOND_WORKTREE_PATH,
            branch: 'feature/other',
            isMain: false,
            isLocked: false,
          },
        },
      },
      ui: {
        ...firstRepo.ui,
        selectedBranch: 'feature/other',
        preferredWorkspacePaneTabByBranch: preferredWorkspacePaneTabByBranchRecordWith(
          firstRepo.ui,
          'feature/other',
          'terminal',
        ),
      },
    } satisfies typeof firstRepo
    useReposStore.setState((state) => ({
      ...state,
      repos: {
        ...state.repos,
        [SECOND_REPO_ID]: secondRepo,
      },
      order: [REPO_ID, SECOND_REPO_ID],
    }))
    const { unmount } = await renderProviderWithProbe(worktreeTerminalKey(REPO_ID, WORKTREE_PATH))

    try {
      await vi.waitFor(() => expect(listSessionsMock).toHaveBeenCalledTimes(1))
      expect(listSessionsMock).toHaveBeenCalledWith({ repoRoot: REPO_ID })
    } finally {
      await unmount()
    }
  })

  test('focus sync only refreshes the current repo session list', async () => {
    const firstRepo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    const secondRepo = {
      ...firstRepo,
      id: SECOND_REPO_ID,
      instanceToken: firstRepo.instanceToken + 1,
      data: {
        ...firstRepo.data,
        branches: [createRepoBranch('feature/other', { worktree: { path: SECOND_WORKTREE_PATH } })],
        worktreesByPath: {
          [SECOND_WORKTREE_PATH]: {
            path: SECOND_WORKTREE_PATH,
            branch: 'feature/other',
            isMain: false,
            isLocked: false,
          },
        },
      },
      ui: {
        ...firstRepo.ui,
        selectedBranch: 'feature/other',
        preferredWorkspacePaneTabByBranch: preferredWorkspacePaneTabByBranchRecordWith(
          firstRepo.ui,
          'feature/other',
          'terminal',
        ),
      },
    } satisfies typeof firstRepo
    useReposStore.setState((state) => ({
      ...state,
      repos: {
        ...state.repos,
        [SECOND_REPO_ID]: secondRepo,
      },
      order: [REPO_ID, SECOND_REPO_ID],
    }))
    useRepoSyncStore.setState({ cooldownMs: 0 })
    const { unmount } = await renderProviderWithProbe(worktreeTerminalKey(REPO_ID, WORKTREE_PATH))

    try {
      await vi.waitFor(() => expect(listSessionsMock).toHaveBeenCalledTimes(1))
      listSessionsMock.mockClear()
      await act(async () => {
        window.dispatchEvent(new Event('focus'))
      })
      await vi.waitFor(() => expect(listSessionsMock).toHaveBeenCalledTimes(1))
      expect(listSessionsMock).toHaveBeenCalledWith({ repoRoot: REPO_ID })
    } finally {
      await unmount()
    }
  })

  test('does not resync sessions when repo changes do not affect terminal worktree mapping', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    const { unmount } = await renderProviderWithProbe(worktreeTerminalKey(REPO_ID, WORKTREE_PATH))

    try {
      await vi.waitFor(() => expect(listSessionsMock).toHaveBeenCalledTimes(1))
      listSessionsMock.mockClear()
      await act(async () => {
        useReposStore.setState((state) => ({
          ...state,
          repos: {
            ...state.repos,
            [REPO_ID]: {
              ...state.repos[REPO_ID]!,
              remote: {
                ...state.repos[REPO_ID]!.remote,
                fetchFailed: true,
              },
            },
          },
        }))
      })
      await Promise.resolve()
      expect(listSessionsMock).not.toHaveBeenCalled()
    } finally {
      await unmount()
    }
  })

  test('allocates the next terminal index after syncing sessions from another window', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        ptySessionId: 'server_session_2',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000session-2`,
        cwd: WORKTREE_PATH,
        controller: { clientId: 'client_remote', status: 'connected' },
        processName: 'node',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        cols: 100,
        rows: 30,
        displayOrder: 1,
      },
    ])
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await emitSessionsChanged()

      let createdKey = ''
      await act(async () => {
        createdKey = await getContext().createTerminal({
          repoRoot: REPO_ID,
          branch: 'feature/worktree',
          worktreePath: WORKTREE_PATH,
        })
      })

      expect(createdKey.endsWith('\u0000session-3')).toBe(true)
      expect(getProbe().summaries.map((session) => session.sessionId)).toEqual(['session-2', 'session-3'])
    } finally {
      await unmount()
    }
  })

  test('falls back to locally cached render snapshot after detach when server omits snapshot', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        ptySessionId: 'server_session_3',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000session-1`,
        cwd: WORKTREE_PATH,
        controller: { clientId: 'client_remote', status: 'connected' },
        processName: 'bash',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        cols: 100,
        rows: 30,
        displayOrder: 1,
      },
    ])
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await emitSessionsChanged()

      const key = getProbe().summaries[0]?.key
      if (!key) throw new Error('missing terminal key')
      const session = mockSessions.find((item) => item.descriptor.sessionId === 'session-1')
      if (!session) throw new Error('missing terminal mock session')

      session.setSerializeValue('local-render-cache')
      getContext().detach(key, document.createElement('div'))

      listSessionsMock.mockResolvedValue([
        {
          ptySessionId: 'server_session_3',
          key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000session-1`,
          cwd: WORKTREE_PATH,
          controller: { clientId: 'client_remote', status: 'connected' },
          processName: 'bash',
          canonicalTitle: null,
          phase: 'open',
          message: null,
          cols: 100,
          rows: 30,
          displayOrder: 1,
        },
      ])
      getSessionSnapshotMock.mockClear()
      getSessionSnapshotMock.mockResolvedValueOnce(null)

      await emitSessionsChanged()

      expect(session.hydrate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          snapshot: 'local-render-cache',
          snapshotSeq: expect.any(Number),
        }),
      )
    } finally {
      await unmount()
    }
  })

  test('prefers authoritative server snapshots over non-server render cache for the same session', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        ptySessionId: 'server_session_live',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000session-1`,
        cwd: WORKTREE_PATH,
        controller: { clientId: 'client_remote', status: 'connected' },
        processName: 'bash',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        cols: 100,
        rows: 30,
        displayOrder: 1,
      },
    ])
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await emitSessionsChanged()

      const key = getProbe().summaries[0]?.key
      if (!key) throw new Error('missing terminal key')
      const session = mockSessions.find((item) => item.descriptor.sessionId === 'session-1')
      if (!session) throw new Error('missing terminal mock session')

      session.setSerializeValue('stale-local-cache-%')
      getContext().detach(key, document.createElement('div'))

      getSessionSnapshotMock.mockClear()
      getSessionSnapshotMock.mockResolvedValueOnce({
        ptySessionId: 'server_session_live',
        snapshot: 'server-snapshot-clean-2',
        snapshotSeq: 8,
      })

      await emitSessionsChanged()

      expect(getSessionSnapshotMock).toHaveBeenCalledWith({ ptySessionId: 'server_session_live' })
      expect(session.hydrate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          snapshot: 'server-snapshot-clean-2',
        }),
      )
      expect(session.hydrate).toHaveBeenLastCalledWith(
        expect.not.objectContaining({
          snapshot: 'stale-local-cache-%',
        }),
      )
    } finally {
      await unmount()
    }
  })

  test('does not reuse locally cached render snapshot for a different recycled session id', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        ptySessionId: 'server_session_old',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000session-1`,
        cwd: WORKTREE_PATH,
        controller: { clientId: 'client_remote', status: 'connected' },
        processName: 'bash',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        cols: 100,
        rows: 30,
        displayOrder: 1,
      },
    ])
    getSessionSnapshotMock.mockResolvedValueOnce({
      ptySessionId: 'server_session_old',
      snapshot: 'old-snapshot',
      snapshotSeq: 7,
    })
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await emitSessionsChanged()

      const key = getProbe().summaries[0]?.key
      if (!key) throw new Error('missing terminal key')
      const session = mockSessions.find((item) => item.descriptor.sessionId === 'session-1')
      if (!session) throw new Error('missing terminal mock session')

      session.setSerializeValue('local-render-cache')
      getContext().detach(key, document.createElement('div'))

      listSessionsMock.mockResolvedValue([
        {
          ptySessionId: 'server_session_new',
          key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000session-1`,
          cwd: WORKTREE_PATH,
          controller: { clientId: 'client_remote', status: 'connected' },
          processName: 'bash',
          canonicalTitle: null,
          phase: 'open',
          message: null,
          cols: 100,
          rows: 30,
          displayOrder: 1,
        },
      ])

      await emitSessionsChanged()

      expect(session.hydrate).toHaveBeenLastCalledWith(
        expect.not.objectContaining({
          snapshot: 'local-render-cache',
        }),
      )
    } finally {
      await unmount()
    }
  })

  test('refetches server snapshots on every sync and hydrates with latest', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        ptySessionId: 'server_session_live',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000session-1`,
        cwd: WORKTREE_PATH,
        controller: { clientId: 'client_remote', status: 'connected' },
        processName: 'bash',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        cols: 100,
        rows: 30,
        displayOrder: 1,
      },
    ])
    getSessionSnapshotMock.mockResolvedValueOnce({
      ptySessionId: 'server_session_live',
      snapshot: 'server-snapshot',
      snapshotSeq: 7,
    })
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await emitSessionsChanged()

      const session = mockSessions.find((item) => item.descriptor.sessionId === 'session-1')
      if (!session) throw new Error('missing terminal mock session')

      getSessionSnapshotMock.mockClear()
      getSessionSnapshotMock.mockResolvedValueOnce({
        ptySessionId: 'server_session_live',
        snapshot: 'server-snapshot-2',
        snapshotSeq: 8,
      })

      listSessionsMock.mockResolvedValue([
        {
          ptySessionId: 'server_session_live',
          key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000session-1`,
          cwd: WORKTREE_PATH,
          controller: { clientId: 'client_remote', status: 'connected' },
          processName: 'bash',
          canonicalTitle: null,
          phase: 'open',
          message: null,
          cols: 100,
          rows: 30,
          displayOrder: 1,
        },
      ])

      await emitSessionsChanged()

      expect(getProbe().summaries).toEqual([expect.objectContaining({ sessionId: 'session-1' })])
      expect(getSessionSnapshotMock).toHaveBeenCalledTimes(1)
      expect(session.hydrate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          snapshot: 'server-snapshot-2',
        }),
      )
    } finally {
      await unmount()
    }
  })

  test('refetches server snapshots on every sync without local caching', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        ptySessionId: 'server_session_live',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000session-1`,
        cwd: WORKTREE_PATH,
        controller: { clientId: 'client_remote', status: 'connected' },
        processName: 'bash',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        cols: 100,
        rows: 30,
        displayOrder: 1,
      },
    ])
    getSessionSnapshotMock.mockResolvedValueOnce({
      ptySessionId: 'server_session_live',
      snapshot: 'server-snapshot',
      snapshotSeq: 7,
    })
    const { unmount } = await renderProvider()
    getSessionSnapshotMock.mockClear()

    try {
      await emitSessionsChanged()

      expect(getSessionSnapshotMock).toHaveBeenCalledTimes(1)
      getSessionSnapshotMock.mockClear()
      getSessionSnapshotMock.mockResolvedValueOnce({
        ptySessionId: 'server_session_live',
        snapshot: 'server-snapshot-2',
        snapshotSeq: 8,
      })

      await emitSessionsChanged()
      expect(getSessionSnapshotMock).toHaveBeenCalledTimes(1)

      getSessionSnapshotMock.mockClear()
      getSessionSnapshotMock.mockResolvedValueOnce({
        ptySessionId: 'server_session_live',
        snapshot: 'server-snapshot-3',
        snapshotSeq: 9,
      })

      await emitSessionsChanged()
      expect(getSessionSnapshotMock).toHaveBeenCalledTimes(1)
    } finally {
      await unmount()
    }
  })

  test('skips failed snapshot fetches via Promise.allSettled so healthy sessions still hydrate', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        ptySessionId: 'session_fail',
        key: `${REPO_ID}\0${WORKTREE_PATH}\0session-1`,
        cwd: WORKTREE_PATH,
        controller: { clientId: 'client_remote', status: 'connected' },
        processName: 'bash',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        cols: 80,
        rows: 24,
        displayOrder: 1,
      },
      {
        ptySessionId: 'session_ok',
        key: `${REPO_ID}\0${WORKTREE_PATH}\0session-2`,
        cwd: WORKTREE_PATH,
        controller: { clientId: 'client_remote', status: 'connected' },
        processName: 'bash',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        cols: 80,
        rows: 24,
        displayOrder: 2,
      },
    ])
    // First snapshot rejects, second resolves. The provider uses
    // Promise.allSettled (not Promise.all) so the rejection does not
    // cancel the whole reconcile. Rejections are surfaced via
    // result.reason and logged via terminalSessionProviderLog.debug;
    // healthy results are collected into the snapshot map. A
    // regression to Promise.all would either cancel reconcile
    // entirely or surface the rejection to the caller as an
    // unhandled promise.
    const debugSpy = vi.spyOn(terminalSessionProviderLog, 'debug').mockImplementation(() => {})
    getSessionSnapshotMock.mockImplementation(async ({ ptySessionId }) => {
      if (ptySessionId === 'session_fail') throw new Error('snapshot unavailable')
      return { ptySessionId: 'session_ok', snapshot: 'ok-snapshot', snapshotSeq: 1 }
    })

    const { unmount } = await renderProvider()
    try {
      await emitSessionsChanged()

      const okSession = mockSessions.find((item) => item.descriptor.sessionId === 'session-2')
      if (!okSession) throw new Error('missing session-2 mock session')
      expect(okSession.hydrate).toHaveBeenLastCalledWith(
        expect.objectContaining({ ptySessionId: 'session_ok', snapshot: 'ok-snapshot', snapshotSeq: 1 }),
      )
      // The failed session's rejection is logged but does not poison
      // the other session's hydrate path.
      expect(debugSpy).toHaveBeenCalledWith('failed to load terminal session snapshot', {
        ptySessionId: 'session_fail',
        err: expect.any(Error),
      })
    } finally {
      debugSpy.mockRestore()
      await unmount()
    }
  })

  test('exposes reactive worktree metadata through external-store facade hooks', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      expect(getProbe()).toMatchObject({ count: 0, terminalIds: [], summaries: [] })

      const base = { repoRoot: REPO_ID, branch: 'feature/worktree', worktreePath: WORKTREE_PATH }
      await act(async () => {
        await getContext().createTerminal(base)
      })
      expect(getProbe()).toMatchObject({ count: 1, terminalIds: ['session-1'] })

      await act(async () => {
        await getContext().createTerminal(base)
      })
      expect(getProbe()).toMatchObject({ count: 2, terminalIds: ['session-1', 'session-2'] })

      await act(async () => {
        exitHandler?.({ ptySessionId: 'session-2' })
      })
      expect(getProbe()).toMatchObject({ count: 1, terminalIds: ['session-1'] })
    } finally {
      await unmount()
    }
  })

  test('rejects terminal creation when the server omits the created session from the response', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    createTerminalMock.mockResolvedValueOnce({
      ok: true as const,
      action: 'created' as const,
      key: `${REPO_ID}\0${WORKTREE_PATH}\0session-1`,
      sessions: [],
      ptySessionId: 'session-1',
      snapshot: '',
      snapshotSeq: 0,
      processName: 'zsh',
      canonicalTitle: null,
      phase: 'open' as const,
      message: null,
      controller: { clientId: 'client_local', status: 'connected' as const },
      canonicalCols: 80,
      canonicalRows: 24,
    })
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await expect(
        getContext().createTerminal({
          repoRoot: REPO_ID,
          branch: 'feature/worktree',
          worktreePath: WORKTREE_PATH,
        }),
      ).rejects.toThrow('error.terminal-create-failed')
      expect(getProbe()).toMatchObject({ count: 0, terminalIds: [] })
    } finally {
      await unmount()
    }
  })

  test('T1.1: prewarms preloadTerminalFont on provider mount', async () => {
    geometryMocks.preloadTerminalFont.mockClear()
    // Mount the Provider with no children that go through the host
    // registration path (no RegisterHost, no probes) so the only
    // preloadTerminalFont call comes from the new useEffect in
    // TerminalSessionProvider itself.
    const result = renderInJsdom(
      <TerminalSessionProvider>
        <span>probe</span>
      </TerminalSessionProvider>,
    )
    try {
      expect(geometryMocks.preloadTerminalFont).toHaveBeenCalledTimes(1)
    } finally {
      await act(async () => {
        result.unmount()
      })
    }
  })

  test('T1.2: prewarms the terminal WebSocket when the active repo is set', async () => {
    const prewarm = vi.fn(async () => {})
    setClientBridgeForTests({
      kind: () => 'electron',
      hasCapability: () => false,
      getBootstrap: () => ({
        runtime: {
          kind: 'electron',
          bridgeVersion: CLIENT_BRIDGE_VERSION,
          capabilities: [...ELECTRON_CLIENT_CAPABILITIES],
        },
        initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret', clientId: 'client_sharedterminal' },
      }),
      invokeIpc: vi.fn(async () => null),
      abortIpc: vi.fn(async () => false),
      onIpcEvent: vi.fn(() => () => {}),
      onEffectIntent: vi.fn(() => () => {}),
      pathForFile: vi.fn(() => ''),
      saveClipboardFiles: vi.fn(async () => []),
      host: () => null,
      terminal: () => ({
        attach: vi.fn(async () => ({ ok: false as const, message: 'unavailable' })),
        restart: vi.fn(async () => ({ ok: false as const, message: 'unavailable' })),
        write: vi.fn(async () => false),
        resize: vi.fn(async () => false),
        takeover: vi.fn(async () => ({ ok: false as const, message: 'unavailable' })),
        close: vi.fn(async () => false),
        create: vi.fn(async () => ({
          ok: true as const,
          action: 'created' as const,
          key: 'k',
          sessions: [],
          ptySessionId: 'session-1',
          snapshot: '',
          snapshotSeq: 0,
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'open' as const,
          message: null,
          controller: null,
          canonicalCols: 80,
          canonicalRows: 24,
        })),
        pruneTerminals: vi.fn(async () => ({ pruned: 0, remaining: 0 })),
        listSessions: vi.fn(async () => []),
        listViews: vi.fn(async () => []),
        openView: vi.fn(async () => false),
        closeView: vi.fn(async () => false),
        prewarm,
        kickReconnect: vi.fn(() => {}),
        getSessionSnapshot: vi.fn(async () => null),
        reorderViews: vi.fn(async () => false),
        notifyBell: vi.fn(async () => false),
        sendTestNotification: vi.fn(async () => false),
        setBadge: () => {},
        onOutput: () => () => {},
        onTitle: () => () => {},
        onExit: () => () => {},
        onIdentity: () => () => {},
        onLifecycle: () => () => {},
        onSessionsChanged: () => () => {},
        onWorkspacePaneChanged: () => () => {},
        onSessionClosed: () => () => {},
      }),
    })

    const result = renderInJsdom(
      <TerminalSessionProvider>
        <span>probe</span>
      </TerminalSessionProvider>,
    )
    try {
      // No active repo yet → effect's guard skips the prewarm.
      expect(prewarm).not.toHaveBeenCalled()

      // Seed a repo: this sets activeId, the effect fires, prewarm is called.
      // The function takes no parameters (single shared socket, not per-repo).
      seedRepoState({
        id: REPO_ID,
        branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
        selectedBranch: 'feature/worktree',
        preferredWorkspacePaneTab: 'terminal',
      })
      await act(async () => {
        await Promise.resolve()
      })
      expect(prewarm).toHaveBeenCalledTimes(1)
      expect(prewarm).toHaveBeenCalledWith()
    } finally {
      await act(async () => {
        result.unmount()
      })
    }
  })

  test('T5.1: kicks reconnect on visibilitychange:visible and on persisted pageshow', async () => {
    const kickReconnect = vi.fn(() => {})
    setClientBridgeForTests({
      kind: () => 'electron',
      hasCapability: () => false,
      getBootstrap: () => ({
        runtime: {
          kind: 'electron',
          bridgeVersion: CLIENT_BRIDGE_VERSION,
          capabilities: [...ELECTRON_CLIENT_CAPABILITIES],
        },
        initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret', clientId: 'client_sharedterminal' },
      }),
      invokeIpc: vi.fn(async () => null),
      abortIpc: vi.fn(async () => false),
      onIpcEvent: vi.fn(() => () => {}),
      onEffectIntent: vi.fn(() => () => {}),
      pathForFile: vi.fn(() => ''),
      saveClipboardFiles: vi.fn(async () => []),
      host: () => null,
      terminal: () => ({
        attach: vi.fn(async () => ({ ok: false as const, message: 'unavailable' })),
        restart: vi.fn(async () => ({ ok: false as const, message: 'unavailable' })),
        write: vi.fn(async () => false),
        resize: vi.fn(async () => false),
        takeover: vi.fn(async () => ({ ok: false as const, message: 'unavailable' })),
        close: vi.fn(async () => false),
        create: vi.fn(async () => ({
          ok: true as const,
          action: 'created' as const,
          key: 'k',
          sessions: [],
          ptySessionId: 'session-1',
          snapshot: '',
          snapshotSeq: 0,
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'open' as const,
          message: null,
          controller: null,
          canonicalCols: 80,
          canonicalRows: 24,
        })),
        pruneTerminals: vi.fn(async () => ({ pruned: 0, remaining: 0 })),
        listSessions: vi.fn(async () => []),
        listViews: vi.fn(async () => []),
        openView: vi.fn(async () => false),
        closeView: vi.fn(async () => false),
        prewarm: vi.fn(async () => {}),
        kickReconnect,
        getSessionSnapshot: vi.fn(async () => null),
        reorderViews: vi.fn(async () => false),
        notifyBell: vi.fn(async () => false),
        sendTestNotification: vi.fn(async () => false),
        setBadge: () => {},
        onOutput: () => () => {},
        onTitle: () => () => {},
        onExit: () => () => {},
        onIdentity: () => () => {},
        onLifecycle: () => () => {},
        onSessionsChanged: () => () => {},
        onWorkspacePaneChanged: () => () => {},
        onSessionClosed: () => () => {},
      }),
    })

    const result = renderInJsdom(
      <TerminalSessionProvider>
        <span>probe</span>
      </TerminalSessionProvider>,
    )
    try {
      // visibilitychange:visible → kick
      kickReconnect.mockClear()
      await act(async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(kickReconnect).toHaveBeenCalledTimes(1)

      // visibilitychange:hidden → no kick
      kickReconnect.mockClear()
      await act(async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(kickReconnect).not.toHaveBeenCalled()

      // pageshow with persisted=true → kick (bfcache restore)
      kickReconnect.mockClear()
      await act(async () => {
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
      })
      expect(kickReconnect).toHaveBeenCalledTimes(1)

      // pageshow with persisted=false → no kick (regular full load)
      kickReconnect.mockClear()
      await act(async () => {
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }))
      })
      expect(kickReconnect).not.toHaveBeenCalled()
    } finally {
      await act(async () => {
        result.unmount()
      })
      // Reset visibilityState to the jsdom default so other tests
      // aren't affected by our defineProperty.
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    }
  })

  test('P1.7: registry state survives a Provider unmount + remount via the singleton', async () => {
    // Before P1.7, the Provider owned its registry and destroyed it
    // on unmount. After P1.7, the registry is a client-level
    // singleton — a remount must reuse the same instance with its
    // session list intact. This test mounts, creates a terminal,
    // unmounts, remounts, and confirms the prior session is still
    // observable in the second mount's context.
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)

    const first = await renderProviderWithProbe(terminalWorktreeKey)
    try {
      await act(async () => {
        await first.getContext().createTerminal({
          repoRoot: REPO_ID,
          branch: 'feature/worktree',
          worktreePath: WORKTREE_PATH,
        })
      })
      expect(first.getProbe()).toMatchObject({ count: 1, terminalIds: ['session-1'] })
    } finally {
      await first.unmount()
    }

    // The singleton slot was cleared by the per-describe
    // `afterEach`. To simulate "the user navigates away and back",
    // we don't clear it here — we mount a fresh Provider that
    // should reuse the same registry. Inject the singleton by
    // installing via the test seam before the second mount.
    // (In production this is automatic; in tests we have to
    // carry the singleton across.)
    const second = await renderProviderWithProbe(terminalWorktreeKey)
    try {
      // The second mount reaches the singleton via
      // `getTerminalSessionProjection`. If state survived, the prior
      // session is observable; if not, count is 0. The point is
      // that we did NOT have to clear the slot between mounts.
      expect(second.getProbe().count).toBeGreaterThanOrEqual(1)
    } finally {
      await second.unmount()
    }
  })
})

function CaptureContext({ onContext }: { onContext: (value: TerminalSessionContextValue) => void }) {
  onContext(useTerminalSessionContext())
  return null
}

function CaptureGroupProbe({
  worktreeTerminalKey,
  onProbe,
}: {
  worktreeTerminalKey: string
  onProbe: (value: {
    count: number
    terminalIds: string[]
    summaries: Array<{
      key: string
      sessionId: string
      selected: boolean
      hasBell: boolean
      title: string
      phase: string
    }>
  }) => void
}) {
  const summaries = useTerminalSessionSummaries(worktreeTerminalKey)
  onProbe({
    count: useWorktreeTerminalCount(worktreeTerminalKey),
    terminalIds: summaries.map((session) => session.sessionId),
    summaries: summaries.map((session) => ({
      key: session.key,
      sessionId: session.sessionId,
      selected: session.selected,
      hasBell: session.hasBell,
      title: session.title,
      phase: session.phase,
    })),
  })
  return null
}

async function renderProvider(): Promise<{
  getContext: () => TerminalSessionContextValue
  unmount: () => Promise<void>
}> {
  return renderProviderWithHost()
}

async function renderProviderWithHost(): Promise<{
  getContext: () => TerminalSessionContextValue
  unmount: () => Promise<void>
}> {
  let context: TerminalSessionContextValue | null = null
  const result = renderInJsdom(
    <TerminalSessionProvider>
      <CaptureContext onContext={(value) => (context = value)} />
      <RegisterHost worktreeTerminalKey={worktreeTerminalKey(REPO_ID, WORKTREE_PATH)} />
    </TerminalSessionProvider>,
  )
  await act(async () => {})

  return {
    getContext: () => {
      if (!context) throw new Error('Terminal session context was not captured')
      return context
    },
    unmount: async () => {
      await act(async () => {
        result.unmount()
      })
    },
  }
}

async function renderProviderWithProbe(worktreeTerminalKey: string): Promise<{
  getContext: () => TerminalSessionContextValue
  getProbe: () => {
    count: number
    terminalIds: string[]
    summaries: Array<{
      key: string
      sessionId: string
      selected: boolean
      hasBell: boolean
      title: string
      phase: string
    }>
  }
  unmount: () => Promise<void>
}> {
  let context: TerminalSessionContextValue | null = null
  let probe: {
    count: number
    terminalIds: string[]
    summaries: Array<{
      key: string
      sessionId: string
      selected: boolean
      hasBell: boolean
      title: string
      phase: string
    }>
  } | null = null
  const result = renderInJsdom(
    <TerminalSessionProvider>
      <CaptureContext onContext={(value) => (context = value)} />
      <RegisterHost worktreeTerminalKey={worktreeTerminalKey} />
      <CaptureGroupProbe worktreeTerminalKey={worktreeTerminalKey} onProbe={(value) => (probe = value)} />
    </TerminalSessionProvider>,
  )
  await act(async () => {})

  return {
    getContext: () => {
      if (!context) throw new Error('Terminal session context was not captured')
      return context
    },
    getProbe: () => {
      if (!probe) throw new Error('Terminal worktree probe was not captured')
      return probe
    },
    unmount: async () => {
      await act(async () => {
        result.unmount()
      })
    },
  }
}

function RegisterHost({ worktreeTerminalKey }: { worktreeTerminalKey: string }) {
  const context = useTerminalSessionContext()
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const host = ref.current
    if (!host) return
    context.registerHost(worktreeTerminalKey, host)
    return () => {
      context.unregisterHost(worktreeTerminalKey, host)
    }
  }, [context, worktreeTerminalKey])

  return <div ref={ref} />
}
