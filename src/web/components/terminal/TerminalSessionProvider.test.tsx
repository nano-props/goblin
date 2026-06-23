// @vitest-environment jsdom

import { act, useEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ELECTRON_RENDERER_CAPABILITIES, RENDERER_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { TerminalSessionProvider } from '#/web/components/terminal/TerminalSessionProvider.tsx'
import { setTerminalSessionRegistryForTests } from '#/web/components/terminal/TerminalSessionRegistry.ts'
import { terminalSessionProviderLog } from '#/web/logger.ts'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import {
  useWorktreeTerminalCount,
  useTerminalSessionSummaries,
} from '#/web/components/terminal/terminal-session-store.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import { setRendererBridgeForTests } from '#/web/renderer-bridge.ts'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'
import { mainWindowQueryClient } from '#/web/main-window-queries.ts'
import { settingsSnapshotQueryKey } from '#/web/settings-queries.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  preferredWorkspacePaneViewForBranch,
  preferredWorkspacePaneViewByBranchRecordWith,
} from '#/web/stores/repos/workspace-pane-preferences.ts'
import { useRepoSyncStore } from '#/web/stores/repo-sync.ts'
import type {
  TerminalBellEvent,
  TerminalDescriptor,
  TerminalOwnershipViewModel,
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
  TerminalSlotSnapshot,
  TerminalSlotSummary,
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
      handleOwnership: ReturnType<typeof vi.fn>
    }>,
)

const geometryMocks = vi.hoisted(() => ({
  preloadTerminalFont: vi.fn(async () => {}),
  proposeTerminalGeometry: vi.fn(() => ({ cols: 100, rows: 30 })),
}))

vi.mock('#/web/components/terminal/terminal-geometry.ts', () => ({
  DEFAULT_TERMINAL_COLS: 80,
  DEFAULT_TERMINAL_ROWS: 24,
  preloadTerminalFont: geometryMocks.preloadTerminalFont,
  proposeTerminalGeometry: geometryMocks.proposeTerminalGeometry,
}))

function selectedWorkspacePaneView(repoId: string) {
  const repo = useReposStore.getState().repos[repoId]
  return repo ? preferredWorkspacePaneViewForBranch(repo.ui, repo.ui.selectedBranch) : null
}

vi.mock('#/web/components/terminal/ManagedTerminalSession.ts', () => {
  class ManagedTerminalSession {
    descriptor: TerminalDescriptor
    private readonly onBell: (descriptor: TerminalDescriptor, event: TerminalBellEvent) => void
    private readonly notify: () => void
    private readonly handleOutputSpy = vi.fn()
    private readonly handleServerTitleSpy = vi.fn()
    private readonly handleOwnershipSpy = vi.fn()
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
        handleOwnership: this.handleOwnershipSpy,
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

    currentSessionId(): string | null {
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
          phase: input.phase,
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

    handleOwnership(event: {
      ptySessionId: string
      role: 'controller' | 'viewer' | 'unowned'
      controllerStatus: 'connected' | 'none'
      canonicalCols: number
      canonicalRows: number
    }) {
      this.handleOwnershipSpy(event)
    }

    handleExit(_event: TerminalExitEvent): boolean {
      return true
    }
  }

  return { ManagedTerminalSession }
})

const REPO_ID = '/tmp/gbl-terminal-provider-repo'
const WORKTREE_PATH = '/tmp/gbl-terminal-provider-worktree'
const SECOND_REPO_ID = '/tmp/gbl-terminal-provider-repo-2'
const SECOND_WORKTREE_PATH = '/tmp/gbl-terminal-provider-worktree-2'

let exitHandler: ((event: TerminalExitEvent) => void) | null = null
let outputHandler: ((event: TerminalOutputEvent) => void) | null = null
let titleHandler: ((event: TerminalTitleEvent) => void) | null = null
let ownershipHandler: ((event: TerminalOwnershipViewModel) => void) | null = null
let sessionsChangedHandler: ((repoRoot: string) => void) | null = null
let workspacePaneChangedHandler: ((repoRoot: string) => void) | null = null
let sessionClosedHandler: ((event: { ptySessionId: string; repoRoot: string }) => void) | null = null
type TestTerminalSessionSummary = Omit<TerminalSlotSummary, 'viewType' | 'viewId'> &
  Partial<Pick<TerminalSlotSummary, 'viewType' | 'viewId'>>
const listSessionsMock = vi.fn<(...args: Array<{ repoRoot: string }>) => Promise<TestTerminalSessionSummary[]>>(
  async () => [],
)
const getSlotSnapshotMock = vi.fn<
  (...args: Array<{ ptySessionId: string }>) => Promise<TerminalSlotSnapshot | null>
>(async () => null)
const closeMock = vi.fn(async () => true)
const createTerminalMock = vi.fn<(input: TerminalCreateInput) => Promise<TerminalCatalogMutationResult>>()
let managedServerSessions: TestTerminalSessionSummary[] = []

function completeServerSession(session: TestTerminalSessionSummary): TerminalSlotSummary {
  return {
    ...session,
    viewType: session.viewType ?? 'terminal',
    viewId: session.viewId ?? session.key,
  }
}

function completeServerSessions(sessions: TestTerminalSessionSummary[]): TerminalSlotSummary[] {
  return sessions.map(completeServerSession)
}

async function emitSessionsChanged(repoRoot = REPO_ID): Promise<void> {
  await act(async () => {
    sessionsChangedHandler?.(repoRoot)
    await waitForScheduledServerSync()
  })
}

async function emitWorkspacePaneChanged(repoRoot = REPO_ID): Promise<void> {
  await act(async () => {
    workspacePaneChangedHandler?.(repoRoot)
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
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  exitHandler = null
  outputHandler = null
  titleHandler = null
  ownershipHandler = null
  sessionsChangedHandler = null
  workspacePaneChangedHandler = null
  sessionClosedHandler = null
  mockSessions.length = 0
  managedServerSessions = []
  listSessionsMock.mockReset()
  listSessionsMock.mockImplementation(async () => managedServerSessions)
  getSlotSnapshotMock.mockReset()
  getSlotSnapshotMock.mockResolvedValue(null)
  closeMock.mockReset()
  closeMock.mockResolvedValue(true)
  createTerminalMock.mockReset()
  createTerminalMock.mockImplementation(async (input) => {
    const currentSessions = await listSessionsMock({ repoRoot: input.repoRoot })
    const slotId =
      input.kind === 'primary'
        ? 'slot-1'
        : `slot-${
            currentSessions.reduce((max, session) => {
              const match = /slot-(\d+)$/.exec(session.key)
              const index = Number.parseInt(match?.[1] ?? '', 10)
              return Number.isFinite(index) ? Math.max(max, index) : max
            }, 0) + 1
          }`
    const key = `${input.repoRoot}\u0000${input.worktreePath}\u0000${slotId}`
    if (input.kind === 'primary' && currentSessions.some((session) => session.key === key)) {
      managedServerSessions = currentSessions
      const reused = currentSessions.find((session) => session.key === key)
      // Reused session also has to supply first-frame hydration
      // fields — the registry validates them on every successful
      // `create` response, not just newly-created ones.
      return {
        ok: true,
        action: 'reused',
        key,
        sessions: completeServerSessions(managedServerSessions),
        ptySessionId: reused?.ptySessionId ?? 'slot-1',
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
    managedServerSessions = [
      ...currentSessions
        .filter((session) => session.key !== key)
        .map((session) => ({
          ...session,
          controller: session.controller?.clientId === input.clientId ? null : session.controller,
        })),
      {
        ptySessionId: slotId,
        key,
        cwd: input.worktreePath,
        controller,
        processName: slotId,
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
    // renderer can paint without a follow-up snapshot fetch.
    // The fields are still optional on the shared type (transitional
    // shape — see docs/terminal-first-frame-fix.md) but the
    // registry validates them at runtime, so the test mock has to
    // supply them.
    return {
      ok: true,
      action: 'created',
      key,
      sessions: completeServerSessions(managedServerSessions),
      ptySessionId: slotId,
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
  window.sessionStorage.setItem('goblin:web-terminal-client-id', 'client_local')
  mainWindowQueryClient.clear()
  mainWindowQueryClient.setQueryData(
    settingsSnapshotQueryKey(),
    defaultSettingsSnapshot({ terminalNotificationsEnabled: false }),
  )
  document.body.innerHTML = ''
  Object.defineProperty(window, 'goblinNative', {
    configurable: true,
    value: {
      runtime: {
        kind: 'electron',
        bridgeVersion: RENDERER_BRIDGE_VERSION,
        capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
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
          ptySessionId: 'pty_session_1_aaaaaaaaa',
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
        getSlotSnapshot: getSlotSnapshotMock,
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
        onOwnership: vi.fn((cb: (event: TerminalOwnershipViewModel) => void) => {
          ownershipHandler = cb
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
        bridgeVersion: RENDERER_BRIDGE_VERSION,
        capabilities: [],
      },
      initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret', clientId: 'client_sharedterminal' },
    },
  })
  setRendererBridgeForTests({
    kind: () => 'electron',
    hasCapability: (capability) =>
      capability === 'settings-ipc' ||
      capability === 'open-settings-window' ||
      capability === 'open-external-url' ||
      capability === 'open-directory-dialog' ||
      capability === 'consume-external-open-paths' ||
      capability === 'open-in-finder' ||
      capability === 'terminal-notifications' ||
      capability === 'terminal-badge',
    getBootstrap: () => ({
      runtime: {
        kind: 'electron',
        bridgeVersion: RENDERER_BRIDGE_VERSION,
        capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
      },
      initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret', clientId: 'client_sharedterminal' },
    }),
    invokeIpc: vi.fn(async () => []),
    abortIpc: vi.fn(async () => false),
    onIpcEvent: vi.fn(() => () => {}),
    onEffectIntent: vi.fn(() => () => {}),
    pathForFile: vi.fn(() => ''),
    saveClipboardFiles: vi.fn(() => Promise.resolve([])),
    shell: () => null,
    terminal: () => ({
      attach: vi.fn(async () => attachResult()),
      restart: vi.fn(async () => attachResult()),
      write: vi.fn(async () => true),
      resize: vi.fn(async () => true),
      takeover: vi.fn(async () => ({
        ok: true as const,
        ptySessionId: 'pty_session_1_aaaaaaaaa',
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
      getSlotSnapshot: getSlotSnapshotMock,
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
      onOwnership: vi.fn((cb: (event: TerminalOwnershipViewModel) => void) => {
        ownershipHandler = cb
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
      onSlotClosed: vi.fn((cb: (event: { ptySessionId: string; repoRoot: string }) => void) => {
        sessionClosedHandler = cb
        return () => {
          if (sessionClosedHandler === cb) sessionClosedHandler = null
        }
      }),
    }),
  })
})

describe('TerminalSessionProvider', () => {
  // The Provider reaches the registry via the renderer-level singleton.
  // Each test must clear the slot so a previous test's bridge wiring
  // doesn't leak into the next one. Mirrors
  // `setTerminalSessionRegistryForTests(null)` in the registry tests.
  afterEach(() => {
    setTerminalSessionRegistryForTests(null)
  })
  test('keeps terminal detail open and switches the selected session when one of multiple terminals exits', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
    })
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      const base = { repoRoot: REPO_ID, branch: 'feature/worktree', worktreePath: WORKTREE_PATH }
      await act(async () => {
        useReposStore.getState().setWorkspacePaneView(REPO_ID, 'terminal')
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
      expect(getProbe().summaries.map((session) => [session.slotId, session.selected, session.hasBell])).toEqual([
        ['slot-1', false, false],
        ['slot-2', true, false],
      ])

      await act(async () => {
        exitHandler?.({ ptySessionId: 'slot-2' })
      })

      expect(closeMock).not.toHaveBeenCalled()
      expect(selectedWorkspacePaneView(REPO_ID)).toBe('terminal')
      expect(getProbe().summaries.map((session) => [session.slotId, session.selected, session.hasBell])).toEqual([
        ['slot-1', true, false],
      ])

      // With the derived-value pattern, the store never re-projects the
      // preferred tab when terminal sessions go to zero. The user's intent
      // is preserved; `useEffectiveWorkspacePaneView` resolves the rendered tab
      // at read time (covered by `workspace-pane-views.test.ts` and
      // `useEffectiveWorkspacePaneView.test.tsx`).
      await act(async () => {
        exitHandler?.({ ptySessionId: 'slot-1' })
      })

      expect(closeMock).not.toHaveBeenCalled()
      expect(selectedWorkspacePaneView(REPO_ID)).toBe('terminal')
    } finally {
      await unmount()
    }
  })

  test('tracks unread bells in provider state and clears them when activating the session', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
    })
    mainWindowQueryClient.setQueryData(
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

      const firstSession = mockSessions.find((session) => session.descriptor.slotId === 'slot-1')
      if (!firstSession) throw new Error('missing slot-1 mock session')

      await act(async () => {
        firstSession.emitBell({
          processName: 'zsh',
          canonicalTitle: '~/Developer/goblin — npm run dev',
          visible: false,
        })
      })

      expect(getProbe().summaries.map((session) => [session.slotId, session.selected, session.hasBell])).toEqual([
        ['slot-1', false, true],
        ['slot-2', true, false],
      ])
      expect(notifyBell).toHaveBeenCalledWith({
        title: 'gbl-terminal-provider-repo',
        body: 'feature/worktree\n~/Developer/goblin — npm run dev',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000slot-1`,
        repoRoot: REPO_ID,
      })

      await act(async () => {
        const firstKey = getProbe().summaries[0]?.key
        if (!firstKey) throw new Error('missing slot-1 key')
        getContext().selectTerminal(terminalWorktreeKey, firstKey)
      })

      expect(getProbe().summaries.map((session) => [session.slotId, session.selected, session.hasBell])).toEqual([
        ['slot-1', true, false],
        ['slot-2', false, false],
      ])
      expect(useReposStore.getState().selectedTerminalByWorktree).toMatchObject({
        [terminalWorktreeKey]: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000slot-1`,
      })
    } finally {
      hasFocus.mockRestore()
      await unmount()
    }
  })

  test('routes realtime output, title, and ownership directly to the matching terminal session', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
    })
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      const base = { repoRoot: REPO_ID, branch: 'feature/worktree', worktreePath: WORKTREE_PATH }
      await act(async () => {
        await getContext().createTerminal(base)
        await getContext().createTerminal(base)
      })

      const first = mockSessions.find((session) => session.descriptor.slotId === 'slot-1')
      const second = mockSessions.find((session) => session.descriptor.slotId === 'slot-2')
      if (!first || !second) throw new Error('missing terminal mock sessions')

      await act(async () => {
        outputHandler?.({ ptySessionId: 'slot-1', data: 'hello', seq: 1, processName: 'zsh' })
        titleHandler?.({ ptySessionId: 'slot-1', canonicalTitle: '~/Developer/goblin — npm run dev' })
        ownershipHandler?.({
          ptySessionId: 'slot-2',
          role: 'controller',
          controllerStatus: 'connected',
          canonicalCols: 100,
          canonicalRows: 30,
          phase: 'open',
        })
      })

      expect(first.handleOutput).toHaveBeenCalledTimes(1)
      expect(first.handleOutput).toHaveBeenCalledWith({
        ptySessionId: 'slot-1',
        data: 'hello',
        seq: 1,
        processName: 'zsh',
      })
      expect(first.handleServerTitle).toHaveBeenCalledTimes(1)
      expect(first.handleServerTitle).toHaveBeenCalledWith('~/Developer/goblin — npm run dev')
      expect(second.handleOwnership).toHaveBeenCalledTimes(1)
      expect(second.handleOwnership).toHaveBeenCalledWith({
        ptySessionId: 'slot-2',
        role: 'controller',
        controllerStatus: 'connected',
        canonicalCols: 100,
        canonicalRows: 30,
        phase: 'open',
      })
      expect(first.handleOwnership).not.toHaveBeenCalled()
    } finally {
      await unmount()
    }
  })

  test('updates reused terminal descriptors when the branch changes on the same worktree', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
    })
    mainWindowQueryClient.setQueryData(
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

      const session = mockSessions.find((item) => item.descriptor.slotId === 'slot-1')
      if (!session) throw new Error('missing slot-1 mock session')

      await act(async () => {
        session.emitBell({ processName: 'zsh', canonicalTitle: '~/Developer/goblin — npm run dev', visible: false })
      })

      expect(notifyBell).toHaveBeenLastCalledWith({
        title: 'gbl-terminal-provider-repo',
        body: 'feature/renamed\n~/Developer/goblin — npm run dev',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000slot-1`,
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
      preferredWorkspacePaneView: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        ptySessionId: 'server_session_1',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000slot-1`,
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
    getSlotSnapshotMock.mockResolvedValue({
      ptySessionId: 'server_session_1',
      snapshot: 'hydrated-screen',
      snapshotSeq: 5,
    })
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await emitSessionsChanged()

      expect(getProbe().summaries).toEqual([
        expect.objectContaining({ slotId: 'slot-1', title: 'zsh', phase: 'open' }),
      ])
      const hydrated = mockSessions.find((session) => session.descriptor.slotId === 'slot-1')
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
      preferredWorkspacePaneView: 'terminal',
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

  test('keeps a newly created terminal active after session sync when create transfers controller ownership', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
    })
    managedServerSessions = [
      {
        ptySessionId: 'server_session_1',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000slot-1`,
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
    listSessionsMock.mockImplementation(async () => managedServerSessions)
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await emitSessionsChanged()
      expect(getProbe().summaries.map((session) => [session.slotId, session.selected])).toEqual([
        ['slot-1', true],
      ])

      const base = { repoRoot: REPO_ID, branch: 'feature/worktree', worktreePath: WORKTREE_PATH }
      await act(async () => {
        await getContext().createTerminal(base)
      })
      expect(getProbe().summaries.map((session) => [session.slotId, session.selected])).toEqual([
        ['slot-1', false],
        ['slot-2', true],
      ])

      await emitSessionsChanged()

      expect(getProbe().summaries.map((session) => [session.slotId, session.selected])).toEqual([
        ['slot-1', false],
        ['slot-2', true],
      ])
    } finally {
      await unmount()
    }
  })

  test('restores the persisted selected terminal for a worktree even when server ownership points at another session', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
    })
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    useReposStore.setState({
      selectedTerminalByWorktree: {
        [terminalWorktreeKey]: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000slot-1`,
      },
    })
    managedServerSessions = [
      {
        ptySessionId: 'server_session_1',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000slot-1`,
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
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000slot-2`,
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
    listSessionsMock.mockImplementation(async () => managedServerSessions)
    const { getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await emitSessionsChanged()

      expect(getProbe().summaries.map((session) => [session.slotId, session.selected])).toEqual([
        ['slot-1', true],
        ['slot-2', false],
      ])
      expect(useReposStore.getState().selectedTerminalByWorktree).toMatchObject({
        [terminalWorktreeKey]: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000slot-1`,
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
      preferredWorkspacePaneView: 'terminal',
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
        preferredWorkspacePaneViewByBranch: preferredWorkspacePaneViewByBranchRecordWith(
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
      preferredWorkspacePaneView: 'terminal',
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
        preferredWorkspacePaneViewByBranch: preferredWorkspacePaneViewByBranchRecordWith(
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
      preferredWorkspacePaneView: 'terminal',
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
      preferredWorkspacePaneView: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        ptySessionId: 'server_session_2',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000slot-2`,
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

      expect(createdKey.endsWith('\u0000slot-3')).toBe(true)
      expect(getProbe().summaries.map((session) => session.slotId)).toEqual(['slot-2', 'slot-3'])
    } finally {
      await unmount()
    }
  })

  test('falls back to locally cached render snapshot after detach when server omits snapshot', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        ptySessionId: 'server_session_3',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000slot-1`,
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
      const session = mockSessions.find((item) => item.descriptor.slotId === 'slot-1')
      if (!session) throw new Error('missing terminal mock session')

      session.setSerializeValue('local-render-cache')
      getContext().detach(key, document.createElement('div'))

      listSessionsMock.mockResolvedValue([
        {
          ptySessionId: 'server_session_3',
          key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000slot-1`,
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
      getSlotSnapshotMock.mockClear()
      getSlotSnapshotMock.mockResolvedValueOnce(null)

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
      preferredWorkspacePaneView: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        ptySessionId: 'server_session_live',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000slot-1`,
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
      const session = mockSessions.find((item) => item.descriptor.slotId === 'slot-1')
      if (!session) throw new Error('missing terminal mock session')

      session.setSerializeValue('stale-local-cache-%')
      getContext().detach(key, document.createElement('div'))

      getSlotSnapshotMock.mockClear()
      getSlotSnapshotMock.mockResolvedValueOnce({
        ptySessionId: 'server_session_live',
        snapshot: 'server-snapshot-clean-2',
        snapshotSeq: 8,
      })

      await emitSessionsChanged()

      expect(getSlotSnapshotMock).toHaveBeenCalledWith({ ptySessionId: 'server_session_live' })
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
      preferredWorkspacePaneView: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        ptySessionId: 'server_session_old',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000slot-1`,
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
    getSlotSnapshotMock.mockResolvedValueOnce({
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
      const session = mockSessions.find((item) => item.descriptor.slotId === 'slot-1')
      if (!session) throw new Error('missing terminal mock session')

      session.setSerializeValue('local-render-cache')
      getContext().detach(key, document.createElement('div'))

      listSessionsMock.mockResolvedValue([
        {
          ptySessionId: 'server_session_new',
          key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000slot-1`,
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
      preferredWorkspacePaneView: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        ptySessionId: 'server_session_live',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000slot-1`,
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
    getSlotSnapshotMock.mockResolvedValueOnce({
      ptySessionId: 'server_session_live',
      snapshot: 'server-snapshot',
      snapshotSeq: 7,
    })
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await emitSessionsChanged()

      const session = mockSessions.find((item) => item.descriptor.slotId === 'slot-1')
      if (!session) throw new Error('missing terminal mock session')

      getSlotSnapshotMock.mockClear()
      getSlotSnapshotMock.mockResolvedValueOnce({
        ptySessionId: 'server_session_live',
        snapshot: 'server-snapshot-2',
        snapshotSeq: 8,
      })

      listSessionsMock.mockResolvedValue([
        {
          ptySessionId: 'server_session_live',
          key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000slot-1`,
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

      expect(getProbe().summaries).toEqual([expect.objectContaining({ slotId: 'slot-1' })])
      expect(getSlotSnapshotMock).toHaveBeenCalledTimes(1)
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
      preferredWorkspacePaneView: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        ptySessionId: 'server_session_live',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000slot-1`,
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
    getSlotSnapshotMock.mockResolvedValueOnce({
      ptySessionId: 'server_session_live',
      snapshot: 'server-snapshot',
      snapshotSeq: 7,
    })
    const { unmount } = await renderProvider()
    getSlotSnapshotMock.mockClear()

    try {
      await emitSessionsChanged()

      expect(getSlotSnapshotMock).toHaveBeenCalledTimes(1)
      getSlotSnapshotMock.mockClear()
      getSlotSnapshotMock.mockResolvedValueOnce({
        ptySessionId: 'server_session_live',
        snapshot: 'server-snapshot-2',
        snapshotSeq: 8,
      })

      await emitSessionsChanged()
      expect(getSlotSnapshotMock).toHaveBeenCalledTimes(1)

      getSlotSnapshotMock.mockClear()
      getSlotSnapshotMock.mockResolvedValueOnce({
        ptySessionId: 'server_session_live',
        snapshot: 'server-snapshot-3',
        snapshotSeq: 9,
      })

      await emitSessionsChanged()
      expect(getSlotSnapshotMock).toHaveBeenCalledTimes(1)
    } finally {
      await unmount()
    }
  })

  test('skips failed snapshot fetches via Promise.allSettled so healthy sessions still hydrate', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        ptySessionId: 'session_fail',
        key: `${REPO_ID} ${WORKTREE_PATH} slot-1`,
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
        key: `${REPO_ID} ${WORKTREE_PATH} slot-2`,
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
    getSlotSnapshotMock.mockImplementation(async ({ ptySessionId }) => {
      if (ptySessionId === 'session_fail') throw new Error('snapshot unavailable')
      return { ptySessionId: 'session_ok', snapshot: 'ok-snapshot', snapshotSeq: 1 }
    })

    const { unmount } = await renderProvider()
    try {
      await emitSessionsChanged()

      const okSession = mockSessions.find((item) => item.descriptor.slotId === 'slot-2')
      if (!okSession) throw new Error('missing slot-2 mock session')
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
      preferredWorkspacePaneView: 'terminal',
    })
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      expect(getProbe()).toMatchObject({ count: 0, terminalIds: [], summaries: [] })

      const base = { repoRoot: REPO_ID, branch: 'feature/worktree', worktreePath: WORKTREE_PATH }
      await act(async () => {
        await getContext().createTerminal(base)
      })
      expect(getProbe()).toMatchObject({ count: 1, terminalIds: ['slot-1'] })

      await act(async () => {
        await getContext().createTerminal(base)
      })
      expect(getProbe()).toMatchObject({ count: 2, terminalIds: ['slot-1', 'slot-2'] })

      await act(async () => {
        exitHandler?.({ ptySessionId: 'slot-2' })
      })
      expect(getProbe()).toMatchObject({ count: 1, terminalIds: ['slot-1'] })
    } finally {
      await unmount()
    }
  })

  test('rejects terminal creation when the server omits the created session from the response', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
    })
    createTerminalMock.mockResolvedValueOnce({
      ok: true as const,
      action: 'created' as const,
      key: `${REPO_ID} ${WORKTREE_PATH} slot-1`,
      sessions: [],
      ptySessionId: 'slot-1',
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
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(
          <TerminalSessionProvider>
            <span>probe</span>
          </TerminalSessionProvider>,
        )
      })
      expect(geometryMocks.preloadTerminalFont).toHaveBeenCalledTimes(1)
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test('T1.2: prewarms the terminal WebSocket when the active repo is set', async () => {
    const prewarm = vi.fn(async () => {})
    setRendererBridgeForTests({
      kind: () => 'electron',
      hasCapability: () => false,
      getBootstrap: () => ({
        runtime: {
          kind: 'electron',
          bridgeVersion: RENDERER_BRIDGE_VERSION,
          capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
        },
        initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret', clientId: 'client_sharedterminal' },
      }),
      invokeIpc: vi.fn(async () => null),
      abortIpc: vi.fn(async () => false),
      onIpcEvent: vi.fn(() => () => {}),
      onEffectIntent: vi.fn(() => () => {}),
      pathForFile: vi.fn(() => ''),
      saveClipboardFiles: vi.fn(async () => []),
      shell: () => null,
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
          ptySessionId: 'pty_session_1_aaaaaaaaa',
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
        getSlotSnapshot: vi.fn(async () => null),
        reorderViews: vi.fn(async () => false),
        notifyBell: vi.fn(async () => false),
        sendTestNotification: vi.fn(async () => false),
        setBadge: () => {},
        onOutput: () => () => {},
        onTitle: () => () => {},
        onExit: () => () => {},
        onOwnership: () => () => {},
        onSessionsChanged: () => () => {},
        onWorkspacePaneChanged: () => () => {},
        onSlotClosed: () => () => {},
      }),
    })

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(
          <TerminalSessionProvider>
            <span>probe</span>
          </TerminalSessionProvider>,
        )
      })

      // No active repo yet → effect's guard skips the prewarm.
      expect(prewarm).not.toHaveBeenCalled()

      // Seed a repo: this sets activeId, the effect fires, prewarm is called.
      // The function takes no parameters (single shared socket, not per-repo).
      seedRepoState({
        id: REPO_ID,
        branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
        selectedBranch: 'feature/worktree',
        preferredWorkspacePaneView: 'terminal',
      })
      await act(async () => {
        await Promise.resolve()
      })
      expect(prewarm).toHaveBeenCalledTimes(1)
      expect(prewarm).toHaveBeenCalledWith()
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })

  test('T5.1: kicks reconnect on visibilitychange:visible and on persisted pageshow', async () => {
    const kickReconnect = vi.fn(() => {})
    setRendererBridgeForTests({
      kind: () => 'electron',
      hasCapability: () => false,
      getBootstrap: () => ({
        runtime: {
          kind: 'electron',
          bridgeVersion: RENDERER_BRIDGE_VERSION,
          capabilities: [...ELECTRON_RENDERER_CAPABILITIES],
        },
        initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret', clientId: 'client_sharedterminal' },
      }),
      invokeIpc: vi.fn(async () => null),
      abortIpc: vi.fn(async () => false),
      onIpcEvent: vi.fn(() => () => {}),
      onEffectIntent: vi.fn(() => () => {}),
      pathForFile: vi.fn(() => ''),
      saveClipboardFiles: vi.fn(async () => []),
      shell: () => null,
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
          ptySessionId: 'pty_session_1_aaaaaaaaa',
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
        getSlotSnapshot: vi.fn(async () => null),
        reorderViews: vi.fn(async () => false),
        notifyBell: vi.fn(async () => false),
        sendTestNotification: vi.fn(async () => false),
        setBadge: () => {},
        onOutput: () => () => {},
        onTitle: () => () => {},
        onExit: () => () => {},
        onOwnership: () => () => {},
        onSessionsChanged: () => () => {},
        onWorkspacePaneChanged: () => () => {},
        onSlotClosed: () => () => {},
      }),
    })

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(
          <TerminalSessionProvider>
            <span>probe</span>
          </TerminalSessionProvider>,
        )
      })

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
      await act(async () => root.unmount())
      container.remove()
      // Reset visibilityState to the jsdom default so other tests
      // aren't affected by our defineProperty.
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    }
  })

  test('P1.7: registry state survives a Provider unmount + remount via the singleton', async () => {
    // Before P1.7, the Provider owned its registry and destroyed it
    // on unmount. After P1.7, the registry is a renderer-level
    // singleton — a remount must reuse the same instance with its
    // session list intact. This test mounts, creates a terminal,
    // unmounts, remounts, and confirms the prior session is still
    // observable in the second mount's context.
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneView: 'terminal',
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
      expect(first.getProbe()).toMatchObject({ count: 1, terminalIds: ['slot-1'] })
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
      // `getTerminalSessionRegistry`. If state survived, the prior
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
      slotId: string
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
    terminalIds: summaries.map((session) => session.slotId),
    summaries: summaries.map((session) => ({
      key: session.key,
      slotId: session.slotId,
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
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  let context: TerminalSessionContextValue | null = null

  await act(async () => {
    root.render(
      <TerminalSessionProvider>
        <CaptureContext onContext={(value) => (context = value)} />
        <RegisterHost worktreeTerminalKey={worktreeTerminalKey(REPO_ID, WORKTREE_PATH)} />
      </TerminalSessionProvider>,
    )
  })

  return {
    getContext: () => {
      if (!context) throw new Error('Terminal session context was not captured')
      return context
    },
    unmount: async () => {
      await act(async () => root.unmount())
      container.remove()
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
      slotId: string
      selected: boolean
      hasBell: boolean
      title: string
      phase: string
    }>
  }
  unmount: () => Promise<void>
}> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  let context: TerminalSessionContextValue | null = null
  let probe: {
    count: number
    terminalIds: string[]
    summaries: Array<{
      key: string
      slotId: string
      selected: boolean
      hasBell: boolean
      title: string
      phase: string
    }>
  } | null = null

  await act(async () => {
    root.render(
      <TerminalSessionProvider>
        <CaptureContext onContext={(value) => (context = value)} />
        <RegisterHost worktreeTerminalKey={worktreeTerminalKey} />
        <CaptureGroupProbe worktreeTerminalKey={worktreeTerminalKey} onProbe={(value) => (probe = value)} />
      </TerminalSessionProvider>,
    )
  })

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
      await act(async () => root.unmount())
      container.remove()
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
