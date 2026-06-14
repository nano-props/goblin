// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { ELECTRON_RENDERER_CAPABILITIES, RENDERER_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { TerminalSessionProvider } from '#/web/components/terminal/TerminalSessionProvider.tsx'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import {
  useWorktreeTerminalCount,
  useTerminalSessionSummaries,
} from '#/web/components/terminal/terminal-session-store.ts'
import { RepoSyncTracker } from '#/web/components/terminal/repo-sync-tracker.ts'
import { worktreeTerminalKey } from '#/web/components/terminal/terminal-session-keys.ts'
import { setRendererBridgeForTests } from '#/web/renderer-bridge.ts'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'
import { mainWindowQueryClient } from '#/web/main-window-queries.ts'
import { settingsSnapshotQueryKey } from '#/web/settings-queries.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/stores/repos/test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type {
  TerminalBellEvent,
  TerminalDescriptor,
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
} from '#/shared/terminal.ts'

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
    private sessionId: string | null = null
    private snapshotValue: TerminalSnapshot

    constructor(
      descriptor: TerminalDescriptor,
      _notify: () => void,
      onBell: (descriptor: TerminalDescriptor, event: TerminalBellEvent) => void,
    ) {
      this.descriptor = descriptor
      this.notify = _notify
      this.onBell = onBell
      this.sessionId = null
      this.snapshotValue = {
        phase: 'open',
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
      return this.sessionId
    }

    hydrate(input: {
      sessionId: string
      processName: string
      canonicalTitle?: string | null
      role: 'controller' | 'viewer' | 'unowned'
      controllerStatus: 'connected' | 'grace' | 'none'
      canonicalCols: number
      canonicalRows: number
      snapshot?: string
      snapshotSeq?: number
    }) {
      this.hydrateSpy(input)
      this.sessionId = input.sessionId
      this.snapshotValue = {
        phase: 'open',
        message: null,
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

    handleOwnership(event: {
      sessionId: string
      role: 'controller' | 'viewer' | 'unowned'
      controllerStatus: 'connected' | 'grace' | 'none'
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
let ownershipHandler:
  | ((event: {
      sessionId: string
      role: 'controller' | 'viewer' | 'unowned'
      controllerStatus: 'connected' | 'grace' | 'none'
      canonicalCols: number
      canonicalRows: number
    }) => void)
  | null = null
let sessionsChangedHandler: ((repoRoot: string) => void) | null = null
const listSessionsMock = vi.fn<(...args: Array<{ repoRoot: string }>) => Promise<TerminalSessionSummary[]>>(
  async () => [],
)
const getSessionSnapshotMock = vi.fn<
  (...args: Array<{ sessionId: string }>) => Promise<TerminalSessionSnapshot | null>
>(async () => null)
const closeMock = vi.fn(async () => true)
const createTerminalMock = vi.fn<(input: TerminalCreateInput) => Promise<TerminalCatalogMutationResult>>()
let managedServerSessions: TerminalSessionSummary[] = []

function attachResult(): TerminalAttachResult {
  return {
    ok: true,
    sessionId: 'unused',
    replay: '',
    replaySeq: 0,
    processName: 'zsh',
    canonicalTitle: null,
    controller: { attachmentId: 'attachment_local', status: 'connected' },
  }
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  exitHandler = null
  outputHandler = null
  titleHandler = null
  ownershipHandler = null
  sessionsChangedHandler = null
  mockSessions.length = 0
  managedServerSessions = []
  listSessionsMock.mockReset()
  listSessionsMock.mockImplementation(async () => managedServerSessions)
  getSessionSnapshotMock.mockReset()
  getSessionSnapshotMock.mockResolvedValue(null)
  closeMock.mockReset()
  closeMock.mockResolvedValue(true)
  createTerminalMock.mockReset()
  createTerminalMock.mockImplementation(async (input) => {
    const currentSessions = await listSessionsMock({ repoRoot: input.repoRoot })
    const terminalId =
      input.kind === 'primary'
        ? 'terminal-1'
        : `terminal-${
            currentSessions.reduce((max, session) => {
              const match = /terminal-(\d+)$/.exec(session.key)
              const index = Number.parseInt(match?.[1] ?? '', 10)
              return Number.isFinite(index) ? Math.max(max, index) : max
            }, 0) + 1
          }`
    const key = `${input.repoRoot}\u0000${input.worktreePath}\u0000${terminalId}`
    if (input.kind === 'primary' && currentSessions.some((session) => session.key === key)) {
      managedServerSessions = currentSessions
      return { ok: true, action: 'reused', key, sessions: managedServerSessions }
    }
    const controller = input.attachmentId ? { attachmentId: input.attachmentId, status: 'connected' as const } : null
    managedServerSessions = [
      ...currentSessions
        .filter((session) => session.key !== key)
        .map((session) => ({
          ...session,
          controller: session.controller?.attachmentId === input.attachmentId ? null : session.controller,
        })),
      {
        sessionId: terminalId,
        key,
        cwd: input.worktreePath,
        controller,
        processName: terminalId,
        canonicalTitle: null,
        cols: 80,
        rows: 24,
        displayOrder: 1,
      },
    ]
    return { ok: true, action: 'created', key, sessions: managedServerSessions }
  })
  resetReposStore()
  window.sessionStorage.setItem('goblin:web-terminal-attachment-id', 'attachment_local')
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
      homeDir: '/Users/test',
      platform: 'web',
      initialI18n: null,
      initialSettings: null,
      initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret', clientId: 'client_sharedterminal' },
      invokeIpc: vi.fn(async () => []),
      abortIpc: vi.fn(),
      onEvent: vi.fn(() => () => {}),
      pathForFile: vi.fn(() => ''),
      terminal: {
        attach: vi.fn(async () => ({
          ok: true,
          sessionId: 'unused',
          replay: '',
          replaySeq: 0,
          processName: 'zsh',
          canonicalTitle: null,
        })),
        restart: vi.fn(async () => ({
          ok: true,
          sessionId: 'unused',
          replay: '',
          replaySeq: 0,
          processName: 'zsh',
          canonicalTitle: null,
        })),
        write: vi.fn(async () => true),
        resize: vi.fn(async () => true),
        takeover: vi.fn(async () => ({
          ok: true as const,
          sessionId: 'session-1',
          controller: { attachmentId: 'attachment_local', status: 'connected' as const },
          canonicalCols: 80,
          canonicalRows: 24,
        })),
        close: closeMock,
        notifyBell: vi.fn(async () => true),
        setBadge: vi.fn(async () => {}),
        create: createTerminalMock,
        pruneTerminals: vi.fn(async () => ({ pruned: 0, remaining: 0 })),
        listSessions: listSessionsMock,
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
        onOwnership: vi.fn(
          (
            cb: (event: {
              sessionId: string
              role: 'controller' | 'viewer' | 'unowned'
              controllerStatus: 'connected' | 'grace' | 'none'
              canonicalCols: number
              canonicalRows: number
            }) => void,
          ) => {
            ownershipHandler = cb
            return () => {}
          },
        ),
        onSessionsChanged: vi.fn((cb: (repoRoot: string) => void) => {
          sessionsChangedHandler = cb
          return () => {
            if (sessionsChangedHandler === cb) sessionsChangedHandler = null
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
      homeDir: '/Users/test',
      platform: 'web',
      initialI18n: null,
      initialSettings: null,
      initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret', clientId: 'client_sharedterminal' },
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
      homeDir: '/Users/test',
      platform: 'web',
      initialI18n: null,
      initialSettings: null,
      initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret', clientId: 'client_sharedterminal' },
    }),
    invokeIpc: vi.fn(async () => []),
    abortIpc: vi.fn(async () => false),
    onIpcEvent: vi.fn(() => () => {}),
    onEffectIntent: vi.fn(() => () => {}),
    pathForFile: vi.fn(() => ''),
    shell: () => null,
    terminal: () => ({
      attach: vi.fn(async () => attachResult()),
      restart: vi.fn(async () => attachResult()),
      write: vi.fn(async () => true),
      resize: vi.fn(async () => true),
      takeover: vi.fn(async () => ({
        ok: true as const,
        sessionId: 'session-1',
        controller: { attachmentId: 'attachment_local', status: 'connected' as const },
        canonicalCols: 80,
        canonicalRows: 24,
      })),
      close: closeMock,
      create: createTerminalMock,
      pruneTerminals: vi.fn(async () => ({ pruned: 0, remaining: 0 })),
      listSessions: listSessionsMock,
      getSessionSnapshot: getSessionSnapshotMock,
      reorder: vi.fn(async () => true),
      notifyBell: window.goblinNative.terminal.notifyBell,
      sendTestNotification: vi.fn(async () => true),
      setBadge: window.goblinNative.terminal.setBadge,
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
      onOwnership: vi.fn(
        (
          cb: (event: {
            sessionId: string
            role: 'controller' | 'viewer' | 'unowned'
            controllerStatus: 'connected' | 'grace' | 'none'
            canonicalCols: number
            canonicalRows: number
          }) => void,
        ) => {
          ownershipHandler = cb
          return () => {}
        },
      ),
      onSessionsChanged: vi.fn((cb: (repoRoot: string) => void) => {
        sessionsChangedHandler = cb
        return () => {
          if (sessionsChangedHandler === cb) sessionsChangedHandler = null
        }
      }),
    }),
  })
})

describe('TerminalSessionProvider', () => {
  test('keeps terminal detail open and switches the selected session when one of multiple terminals exits', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      detailTab: 'terminal',
    })
    useReposStore.setState({ detailCollapsed: false })
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      const base = { repoRoot: REPO_ID, branch: 'feature/worktree', worktreePath: WORKTREE_PATH }
      await act(async () => {
        useReposStore.getState().setDetailTab(REPO_ID, 'terminal')
        await getContext().createTerminal(base)
        await getContext().createTerminal(base)
      })

      expect(createTerminalMock).toHaveBeenCalledTimes(2)
      expect(createTerminalMock).toHaveBeenNthCalledWith(1, {
        ...base,
        kind: 'primary',
        attachmentId: 'attachment_local',
      })
      expect(createTerminalMock).toHaveBeenNthCalledWith(2, {
        ...base,
        kind: 'additional',
        attachmentId: 'attachment_local',
      })
      expect(getProbe().summaries.map((session) => [session.terminalId, session.selected, session.hasBell])).toEqual([
        ['terminal-1', false, false],
        ['terminal-2', true, false],
      ])

      await act(async () => {
        exitHandler?.({ sessionId: 'terminal-2' })
      })

      expect(closeMock).not.toHaveBeenCalled()
      expect(useReposStore.getState().repos[REPO_ID]?.ui.preferredDetailTab).toBe('terminal')
      expect(useReposStore.getState().detailCollapsed).toBe(false)
      expect(getProbe().summaries.map((session) => [session.terminalId, session.selected, session.hasBell])).toEqual([
        ['terminal-1', true, false],
      ])

      // With the derived-value pattern, the store never re-projects the
      // preferred tab when terminal sessions go to zero. The user's intent
      // is preserved; `useEffectiveDetailTab` resolves the rendered tab
      // at read time (covered by `detail-tabs.test.ts` and
      // `useEffectiveDetailTab.test.tsx`).
      await act(async () => {
        exitHandler?.({ sessionId: 'terminal-1' })
      })

      expect(closeMock).not.toHaveBeenCalled()
      expect(useReposStore.getState().repos[REPO_ID]?.ui.preferredDetailTab).toBe('terminal')
      expect(useReposStore.getState().detailCollapsed).toBe(false)
    } finally {
      await unmount()
    }
  })

  test('tracks unread bells in provider state and clears them when activating the session', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      detailTab: 'terminal',
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

      const firstSession = mockSessions.find((session) => session.descriptor.terminalId === 'terminal-1')
      if (!firstSession) throw new Error('missing terminal-1 mock session')

      await act(async () => {
        firstSession.emitBell({
          processName: 'zsh',
          canonicalTitle: '~/Developer/goblin — npm run dev',
          visible: false,
        })
      })

      expect(getProbe().summaries.map((session) => [session.terminalId, session.selected, session.hasBell])).toEqual([
        ['terminal-1', false, true],
        ['terminal-2', true, false],
      ])
      expect(notifyBell).toHaveBeenCalledWith({
        title: 'gbl-terminal-provider-repo',
        body: 'feature/worktree\n~/Developer/goblin — npm run dev',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000terminal-1`,
        repoRoot: REPO_ID,
      })

      await act(async () => {
        const firstKey = getProbe().summaries[0]?.key
        if (!firstKey) throw new Error('missing terminal-1 key')
        getContext().selectTerminal(terminalWorktreeKey, firstKey)
      })

      expect(getProbe().summaries.map((session) => [session.terminalId, session.selected, session.hasBell])).toEqual([
        ['terminal-1', true, false],
        ['terminal-2', false, false],
      ])
      expect(useReposStore.getState().selectedTerminalByWorktree).toMatchObject({
        [terminalWorktreeKey]: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000terminal-1`,
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
      detailTab: 'terminal',
    })
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      const base = { repoRoot: REPO_ID, branch: 'feature/worktree', worktreePath: WORKTREE_PATH }
      await act(async () => {
        await getContext().createTerminal(base)
        await getContext().createTerminal(base)
      })

      const first = mockSessions.find((session) => session.descriptor.terminalId === 'terminal-1')
      const second = mockSessions.find((session) => session.descriptor.terminalId === 'terminal-2')
      if (!first || !second) throw new Error('missing terminal mock sessions')

      await act(async () => {
        outputHandler?.({ sessionId: 'terminal-1', data: 'hello', seq: 1, processName: 'zsh' })
        titleHandler?.({ sessionId: 'terminal-1', canonicalTitle: '~/Developer/goblin — npm run dev' })
        ownershipHandler?.({
          sessionId: 'terminal-2',
          role: 'controller',
          controllerStatus: 'connected',
          canonicalCols: 100,
          canonicalRows: 30,
        })
      })

      expect(first.handleOutput).toHaveBeenCalledTimes(1)
      expect(first.handleOutput).toHaveBeenCalledWith({
        sessionId: 'terminal-1',
        data: 'hello',
        seq: 1,
        processName: 'zsh',
      })
      expect(first.handleServerTitle).toHaveBeenCalledTimes(1)
      expect(first.handleServerTitle).toHaveBeenCalledWith('~/Developer/goblin — npm run dev')
      expect(second.handleOwnership).toHaveBeenCalledTimes(1)
      expect(second.handleOwnership).toHaveBeenCalledWith({
        sessionId: 'terminal-2',
        role: 'controller',
        controllerStatus: 'connected',
        canonicalCols: 100,
        canonicalRows: 30,
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
      detailTab: 'terminal',
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

      const session = mockSessions.find((item) => item.descriptor.terminalId === 'terminal-1')
      if (!session) throw new Error('missing terminal-1 mock session')

      await act(async () => {
        session.emitBell({ processName: 'zsh', canonicalTitle: '~/Developer/goblin — npm run dev', visible: false })
      })

      expect(notifyBell).toHaveBeenLastCalledWith({
        title: 'gbl-terminal-provider-repo',
        body: 'feature/renamed\n~/Developer/goblin — npm run dev',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000terminal-1`,
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
      detailTab: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        sessionId: 'server_session_1',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000terminal-1`,
        cwd: WORKTREE_PATH,
        controller: { attachmentId: 'attachment_remote', status: 'connected' },
        processName: 'zsh',
        canonicalTitle: null,
        cols: 120,
        rows: 40,
        displayOrder: 1,
      },
    ])
    getSessionSnapshotMock.mockResolvedValue({
      sessionId: 'server_session_1',
      snapshot: 'hydrated-screen',
      snapshotSeq: 5,
    })
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await act(async () => {
        sessionsChangedHandler?.(REPO_ID)
        await Promise.resolve()
      })

      expect(getProbe().summaries).toEqual([
        expect.objectContaining({ terminalId: 'terminal-1', title: 'zsh', phase: 'open' }),
      ])
      const hydrated = mockSessions.find((session) => session.descriptor.terminalId === 'terminal-1')
      expect(hydrated?.hydrate).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'server_session_1',
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
      await act(async () => {
        sessionsChangedHandler?.(REPO_ID)
        await Promise.resolve()
      })

      expect(getProbe().summaries).toEqual([])
    } finally {
      await unmount()
    }
  })

  test('keeps a newly created terminal active after session sync when create transfers controller ownership', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      detailTab: 'terminal',
    })
    managedServerSessions = [
      {
        sessionId: 'server_session_1',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000terminal-1`,
        cwd: WORKTREE_PATH,
        controller: { attachmentId: 'attachment_local', status: 'connected' },
        processName: 'zsh',
        canonicalTitle: null,
        cols: 80,
        rows: 24,
        displayOrder: 1,
      },
    ]
    listSessionsMock.mockImplementation(async () => managedServerSessions)
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await act(async () => {
        sessionsChangedHandler?.(REPO_ID)
        await Promise.resolve()
      })
      expect(getProbe().summaries.map((session) => [session.terminalId, session.selected])).toEqual([
        ['terminal-1', true],
      ])

      const base = { repoRoot: REPO_ID, branch: 'feature/worktree', worktreePath: WORKTREE_PATH }
      await act(async () => {
        await getContext().createTerminal(base)
      })
      expect(getProbe().summaries.map((session) => [session.terminalId, session.selected])).toEqual([
        ['terminal-1', false],
        ['terminal-2', true],
      ])

      await act(async () => {
        sessionsChangedHandler?.(REPO_ID)
        await Promise.resolve()
      })

      expect(getProbe().summaries.map((session) => [session.terminalId, session.selected])).toEqual([
        ['terminal-1', false],
        ['terminal-2', true],
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
      detailTab: 'terminal',
    })
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    useReposStore.setState({
      selectedTerminalByWorktree: {
        [terminalWorktreeKey]: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000terminal-1`,
      },
    })
    managedServerSessions = [
      {
        sessionId: 'server_session_1',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000terminal-1`,
        cwd: WORKTREE_PATH,
        controller: null,
        processName: 'zsh',
        canonicalTitle: null,
        cols: 80,
        rows: 24,
        displayOrder: 1,
      },
      {
        sessionId: 'server_session_2',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000terminal-2`,
        cwd: WORKTREE_PATH,
        controller: { attachmentId: 'attachment_local', status: 'connected' },
        processName: 'zsh',
        canonicalTitle: null,
        cols: 80,
        rows: 24,
        displayOrder: 1,
      },
    ]
    listSessionsMock.mockImplementation(async () => managedServerSessions)
    const { getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await act(async () => {
        sessionsChangedHandler?.(REPO_ID)
        await Promise.resolve()
      })

      expect(getProbe().summaries.map((session) => [session.terminalId, session.selected])).toEqual([
        ['terminal-1', true],
        ['terminal-2', false],
      ])
      expect(useReposStore.getState().selectedTerminalByWorktree).toMatchObject({
        [terminalWorktreeKey]: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000terminal-1`,
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
      detailTab: 'terminal',
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
        preferredDetailTab: 'terminal',
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
      detailTab: 'terminal',
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
        preferredDetailTab: 'terminal',
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
    const { unmount } = await renderProviderWithProbe(
      worktreeTerminalKey(REPO_ID, WORKTREE_PATH),
      new RepoSyncTracker(0),
    )

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
      detailTab: 'terminal',
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
      detailTab: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        sessionId: 'server_session_2',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000terminal-2`,
        cwd: WORKTREE_PATH,
        controller: { attachmentId: 'attachment_remote', status: 'connected' },
        processName: 'node',
        canonicalTitle: null,
        cols: 100,
        rows: 30,
        displayOrder: 1,
      },
    ])
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await act(async () => {
        sessionsChangedHandler?.(REPO_ID)
        await Promise.resolve()
      })

      let createdKey = ''
      await act(async () => {
        createdKey = await getContext().createTerminal({
          repoRoot: REPO_ID,
          branch: 'feature/worktree',
          worktreePath: WORKTREE_PATH,
        })
      })

      expect(createdKey.endsWith('\u0000terminal-3')).toBe(true)
      expect(getProbe().summaries.map((session) => session.terminalId)).toEqual(['terminal-2', 'terminal-3'])
    } finally {
      await unmount()
    }
  })

  test('falls back to locally cached render snapshot after detach when server omits snapshot', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      detailTab: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        sessionId: 'server_session_3',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000terminal-1`,
        cwd: WORKTREE_PATH,
        controller: { attachmentId: 'attachment_remote', status: 'connected' },
        processName: 'bash',
        canonicalTitle: null,
        cols: 100,
        rows: 30,
        displayOrder: 1,
      },
    ])
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await act(async () => {
        sessionsChangedHandler?.(REPO_ID)
        await Promise.resolve()
      })

      const key = getProbe().summaries[0]?.key
      if (!key) throw new Error('missing terminal key')
      const session = mockSessions.find((item) => item.descriptor.terminalId === 'terminal-1')
      if (!session) throw new Error('missing terminal mock session')

      session.setSerializeValue('local-render-cache')
      getContext().detach(key, document.createElement('div'))

      listSessionsMock.mockResolvedValue([
        {
          sessionId: 'server_session_3',
          key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000terminal-1`,
          cwd: WORKTREE_PATH,
          controller: { attachmentId: 'attachment_remote', status: 'connected' },
          processName: 'bash',
          canonicalTitle: null,
          cols: 100,
          rows: 30,
          displayOrder: 1,
        },
      ])
      getSessionSnapshotMock.mockClear()
      getSessionSnapshotMock.mockResolvedValueOnce(null)

      await act(async () => {
        sessionsChangedHandler?.(REPO_ID)
        await Promise.resolve()
      })

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
      detailTab: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        sessionId: 'server_session_live',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000terminal-1`,
        cwd: WORKTREE_PATH,
        controller: { attachmentId: 'attachment_remote', status: 'connected' },
        processName: 'bash',
        canonicalTitle: null,
        cols: 100,
        rows: 30,
        displayOrder: 1,
      },
    ])
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await act(async () => {
        sessionsChangedHandler?.(REPO_ID)
        await Promise.resolve()
      })

      const key = getProbe().summaries[0]?.key
      if (!key) throw new Error('missing terminal key')
      const session = mockSessions.find((item) => item.descriptor.terminalId === 'terminal-1')
      if (!session) throw new Error('missing terminal mock session')

      session.setSerializeValue('stale-local-cache-%')
      getContext().detach(key, document.createElement('div'))

      getSessionSnapshotMock.mockClear()
      getSessionSnapshotMock.mockResolvedValueOnce({
        sessionId: 'server_session_live',
        snapshot: 'server-snapshot-clean-2',
        snapshotSeq: 8,
      })

      await act(async () => {
        sessionsChangedHandler?.(REPO_ID)
        await Promise.resolve()
      })

      expect(getSessionSnapshotMock).toHaveBeenCalledWith({ sessionId: 'server_session_live' })
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
      detailTab: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        sessionId: 'server_session_old',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000terminal-1`,
        cwd: WORKTREE_PATH,
        controller: { attachmentId: 'attachment_remote', status: 'connected' },
        processName: 'bash',
        canonicalTitle: null,
        cols: 100,
        rows: 30,
        displayOrder: 1,
      },
    ])
    getSessionSnapshotMock.mockResolvedValueOnce({
      sessionId: 'server_session_old',
      snapshot: 'old-snapshot',
      snapshotSeq: 7,
    })
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await act(async () => {
        sessionsChangedHandler?.(REPO_ID)
        await Promise.resolve()
      })

      const key = getProbe().summaries[0]?.key
      if (!key) throw new Error('missing terminal key')
      const session = mockSessions.find((item) => item.descriptor.terminalId === 'terminal-1')
      if (!session) throw new Error('missing terminal mock session')

      session.setSerializeValue('local-render-cache')
      getContext().detach(key, document.createElement('div'))

      listSessionsMock.mockResolvedValue([
        {
          sessionId: 'server_session_new',
          key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000terminal-1`,
          cwd: WORKTREE_PATH,
          controller: { attachmentId: 'attachment_remote', status: 'connected' },
          processName: 'bash',
          canonicalTitle: null,
          cols: 100,
          rows: 30,
          displayOrder: 1,
        },
      ])

      await act(async () => {
        sessionsChangedHandler?.(REPO_ID)
        await Promise.resolve()
      })

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
      detailTab: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        sessionId: 'server_session_live',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000terminal-1`,
        cwd: WORKTREE_PATH,
        controller: { attachmentId: 'attachment_remote', status: 'connected' },
        processName: 'bash',
        canonicalTitle: null,
        cols: 100,
        rows: 30,
        displayOrder: 1,
      },
    ])
    getSessionSnapshotMock.mockResolvedValueOnce({
      sessionId: 'server_session_live',
      snapshot: 'server-snapshot',
      snapshotSeq: 7,
    })
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await act(async () => {
        sessionsChangedHandler?.(REPO_ID)
        await Promise.resolve()
      })

      const session = mockSessions.find((item) => item.descriptor.terminalId === 'terminal-1')
      if (!session) throw new Error('missing terminal mock session')

      getSessionSnapshotMock.mockClear()
      getSessionSnapshotMock.mockResolvedValueOnce({
        sessionId: 'server_session_live',
        snapshot: 'server-snapshot-2',
        snapshotSeq: 8,
      })

      listSessionsMock.mockResolvedValue([
        {
          sessionId: 'server_session_live',
          key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000terminal-1`,
          cwd: WORKTREE_PATH,
          controller: { attachmentId: 'attachment_remote', status: 'connected' },
          processName: 'bash',
          canonicalTitle: null,
          cols: 100,
          rows: 30,
          displayOrder: 1,
        },
      ])

      await act(async () => {
        sessionsChangedHandler?.(REPO_ID)
        await Promise.resolve()
      })

      expect(getProbe().summaries).toEqual([expect.objectContaining({ terminalId: 'terminal-1' })])
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
      detailTab: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        sessionId: 'server_session_live',
        key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000terminal-1`,
        cwd: WORKTREE_PATH,
        controller: { attachmentId: 'attachment_remote', status: 'connected' },
        processName: 'bash',
        canonicalTitle: null,
        cols: 100,
        rows: 30,
        displayOrder: 1,
      },
    ])
    getSessionSnapshotMock.mockResolvedValueOnce({
      sessionId: 'server_session_live',
      snapshot: 'server-snapshot',
      snapshotSeq: 7,
    })
    const { unmount } = await renderProvider()
    getSessionSnapshotMock.mockClear()

    try {
      await act(async () => {
        sessionsChangedHandler?.(REPO_ID)
        await Promise.resolve()
      })

      expect(getSessionSnapshotMock).toHaveBeenCalledTimes(1)
      getSessionSnapshotMock.mockClear()
      getSessionSnapshotMock.mockResolvedValueOnce({
        sessionId: 'server_session_live',
        snapshot: 'server-snapshot-2',
        snapshotSeq: 8,
      })

      await act(async () => {
        sessionsChangedHandler?.(REPO_ID)
        await Promise.resolve()
      })
      expect(getSessionSnapshotMock).toHaveBeenCalledTimes(1)

      getSessionSnapshotMock.mockClear()
      getSessionSnapshotMock.mockResolvedValueOnce({
        sessionId: 'server_session_live',
        snapshot: 'server-snapshot-3',
        snapshotSeq: 9,
      })

      await act(async () => {
        sessionsChangedHandler?.(REPO_ID)
        await Promise.resolve()
      })
      expect(getSessionSnapshotMock).toHaveBeenCalledTimes(1)
    } finally {
      await unmount()
    }
  })

  test('exposes reactive worktree metadata through external-store facade hooks', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      detailTab: 'terminal',
    })
    const terminalWorktreeKey = worktreeTerminalKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      expect(getProbe()).toMatchObject({ count: 0, terminalIds: [], summaries: [] })

      const base = { repoRoot: REPO_ID, branch: 'feature/worktree', worktreePath: WORKTREE_PATH }
      await act(async () => {
        await getContext().createTerminal(base)
      })
      expect(getProbe()).toMatchObject({ count: 1, terminalIds: ['terminal-1'] })

      await act(async () => {
        await getContext().createTerminal(base)
      })
      expect(getProbe()).toMatchObject({ count: 2, terminalIds: ['terminal-1', 'terminal-2'] })

      await act(async () => {
        exitHandler?.({ sessionId: 'terminal-2' })
      })
      expect(getProbe()).toMatchObject({ count: 1, terminalIds: ['terminal-1'] })
    } finally {
      await unmount()
    }
  })

  test('rejects terminal creation when the server omits the created session from the response', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      detailTab: 'terminal',
    })
    createTerminalMock.mockResolvedValueOnce({
      ok: true,
      action: 'created',
      key: `${REPO_ID}\u0000${WORKTREE_PATH}\u0000terminal-1`,
      sessions: [],
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
      terminalId: string
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
    terminalIds: summaries.map((session) => session.terminalId),
    summaries: summaries.map((session) => ({
      key: session.key,
      terminalId: session.terminalId,
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
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  let context: TerminalSessionContextValue | null = null

  await act(async () => {
    root.render(
      <TerminalSessionProvider>
        <CaptureContext onContext={(value) => (context = value)} />
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

async function renderProviderWithProbe(
  worktreeTerminalKey: string,
  syncTracker?: RepoSyncTracker,
): Promise<{
  getContext: () => TerminalSessionContextValue
  getProbe: () => {
    count: number
    terminalIds: string[]
    summaries: Array<{
      key: string
      terminalId: string
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
      terminalId: string
      selected: boolean
      hasBell: boolean
      title: string
      phase: string
    }>
  } | null = null

  await act(async () => {
    root.render(
      <TerminalSessionProvider syncTracker={syncTracker}>
        <CaptureContext onContext={(value) => (context = value)} />
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
