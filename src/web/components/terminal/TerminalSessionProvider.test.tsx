// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { ELECTRON_CLIENT_CAPABILITIES, CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { TerminalSessionProvider } from '#/web/components/terminal/TerminalSessionProvider.tsx'
import { setTerminalSessionProjectionForTests } from '#/web/components/terminal/TerminalSessionProjection.ts'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import {
  useTerminalWorktreeCount,
  useTerminalSessionSummaries,
} from '#/web/components/terminal/terminal-session-store.ts'
import { formatTerminalWorktreeKey } from '#/shared/terminal-worktree-key.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { settingsSnapshotQueryKey } from '#/web/settings-query-cache.ts'
import { createRepoBranch, resetReposStore, seedRepoState } from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  preferredWorkspacePaneTabForTarget,
  preferredWorkspacePaneTabByTargetRecordWith,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/repos/workspace-pane-preferences.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { useRepoSyncStore } from '#/web/stores/repo-sync.ts'
import type {
  TerminalDescriptor,
  TerminalIdentityRealtimeEvent,
  TerminalLifecycleRealtimeEvent,
  TerminalSearchResult,
  TerminalSessionContextValue,
  TerminalSnapshot,
} from '#/web/components/terminal/types.ts'
import type {
  TerminalCreateResult,
  TerminalCreateInput,
  TerminalBellRealtimeEvent,
  TerminalExitEvent,
  TerminalAttachResult,
  TerminalOutputEvent,
  TerminalSessionSummary,
  TerminalTitleEvent,
  WorkspacePaneTabsEntry,
} from '#/shared/terminal-types.ts'
import { workspacePaneStaticTabEntry, workspacePaneTerminalTabEntry } from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import {
  readWorkspacePaneTabsForTarget,
  setWorkspacePaneTabsForTargetQueryData,
  workspacePaneTabsQueryKey,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { setRepoSnapshotQueryData } from '#/web/repo-data-query.ts'

const mockSessions = vi.hoisted(
  () =>
    [] as Array<{
      descriptor: TerminalDescriptor
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
  const actual = await vi.importActual<typeof import('#/web/components/terminal/terminal-geometry.ts')>(
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
  return repo
    ? preferredWorkspacePaneTabForTarget(repo.ui, workspacePaneTabsTargetForRepoBranch({ repoRoot: repo.id, branches: readRepoBranchQueryProjection(repo)?.branches ?? [] }, repo.ui.selectedBranch))
    : null
}

function workspaceTabsQueryKeyForRepo(repoId: string) {
  return workspacePaneTabsQueryKey(repoId, useReposStore.getState().repos[repoId]!.instanceId)
}

function repoTerminalBase() {
  return {
    repoRoot: REPO_ID,
    repoInstanceId: useReposStore.getState().repos[REPO_ID]!.instanceId,
    branch: 'feature/worktree',
    worktreePath: WORKTREE_PATH,
  }
}

vi.mock('#/web/components/terminal/TerminalSession.ts', () => {
  class TerminalSession {
    descriptor: TerminalDescriptor
    private readonly notify: () => void
    private readonly handleOutputSpy = vi.fn()
    private readonly handleServerTitleSpy = vi.fn()
    private readonly handleIdentitySpy = vi.fn()
    private readonly handleLifecycleSpy = vi.fn()
    private readonly hydrateSpy = vi.fn()
    private readonly detachSpy = vi.fn()
    private terminalRuntimeSessionId: string | null = null
    private snapshotValue: TerminalSnapshot

    constructor(descriptor: TerminalDescriptor, _notify: () => void) {
      this.descriptor = descriptor
      this.notify = _notify
      this.terminalRuntimeSessionId = null
      this.snapshotValue = {
        phase: 'opening',
        message: null,
        processName: `terminal ${this.descriptor.index}`,
        canonicalTitle: null,
      }
      mockSessions.push({
        descriptor,
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

    isVisible(): boolean {
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

    currentTerminalRuntimeSessionId(): string | null {
      return this.terminalRuntimeSessionId
    }

    hydrate(input: {
      terminalRuntimeSessionId: string
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
      this.terminalRuntimeSessionId = input.terminalRuntimeSessionId
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
      terminalRuntimeSessionId: string
      role: 'controller' | 'viewer' | 'unowned'
      controllerStatus: 'connected' | 'none'
      canonicalCols: number
      canonicalRows: number
    }) {
      this.handleIdentitySpy(event)
    }

    handleLifecycle(event: {
      terminalRuntimeSessionId: string
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
let bellHandler: ((event: TerminalBellRealtimeEvent) => void) | null = null
let titleHandler: ((event: TerminalTitleEvent) => void) | null = null
let identityHandler: ((event: TerminalIdentityRealtimeEvent) => void) | null = null
let lifecycleHandler: ((event: TerminalLifecycleRealtimeEvent) => void) | null = null
let sessionsChangedHandler: ((repoRoot: string) => void) | null = null
let workspaceTabsChangedHandler: ((repoRoot: string) => void) | null = null
let sessionClosedHandler:
  | ((event: {
      terminalRuntimeSessionId: string
      terminalSessionId: string
      repoRoot: string
      worktreePath: string
    }) => void)
  | null = null
type TestTerminalSessionSummary = Omit<TerminalSessionSummary, 'repoInstanceId' | 'repoRoot' | 'worktreePath'> &
  Partial<Pick<TerminalSessionSummary, 'repoInstanceId' | 'repoRoot' | 'worktreePath'>>
const listSessionsMock = vi.fn<
  (...args: Array<{ repoRoot: string; repoInstanceId?: string }>) => Promise<TestTerminalSessionSummary[]>
>(async () => [])
const listWorkspaceTabsMock = vi.fn<(...args: Array<{ repoRoot: string }>) => Promise<WorkspacePaneTabsEntry[]>>(
  async () => [],
)
const closeMock = vi.fn(async () => true)
const createTerminalMock = vi.fn<(input: TerminalCreateInput) => Promise<TerminalCreateResult>>()
let serverSessions: TestTerminalSessionSummary[] = []

function completeServerSession(session: TestTerminalSessionSummary): TerminalSessionSummary {
  return {
    ...session,
    terminalSessionId: normalizeTestSessionId(session.terminalSessionId),
    repoInstanceId: session.repoInstanceId ?? 'repo-instance-test',
    repoRoot: session.repoRoot ?? REPO_ID,
    worktreePath: session.worktreePath ?? WORKTREE_PATH,
  }
}

function completeServerSessions(sessions: TestTerminalSessionSummary[]): TerminalSessionSummary[] {
  return sessions.map(completeServerSession)
}

function workspaceTabsWithTerminal(terminalSessionId: string) {
  return [workspacePaneStaticTabEntry('status'), workspacePaneTerminalTabEntry(terminalSessionId)]
}

function tabsFor(repoRoot: string, branchName: string): WorkspacePaneTabEntry[] {
  const repo = useReposStore.getState().repos[repoRoot]
  const target = repo ? workspacePaneTabsTargetForRepoBranch({ repoRoot: repo.id, branches: readRepoBranchQueryProjection(repo)?.branches ?? [] }, branchName) : null
  return target ? readWorkspacePaneTabsForTarget({ ...target, repoInstanceId: repo.instanceId }) : []
}

function normalizeTestSessionId(terminalSessionId: string): string {
  return terminalSessionId.split('\0').at(-1) ?? terminalSessionId
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
    terminalRuntimeSessionId: 'unused',
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
  bellHandler = null
  titleHandler = null
  identityHandler = null
  sessionsChangedHandler = null
  workspaceTabsChangedHandler = null
  sessionClosedHandler = null
  mockSessions.length = 0
  serverSessions = []
  listSessionsMock.mockReset()
  listSessionsMock.mockImplementation(async () => serverSessions)
  listWorkspaceTabsMock.mockReset()
  listWorkspaceTabsMock.mockResolvedValue([])
  closeMock.mockReset()
  closeMock.mockResolvedValue(true)
  createTerminalMock.mockReset()
  createTerminalMock.mockImplementation(async (input) => {
    const currentSessions = await listSessionsMock({
      repoRoot: input.repoRoot,
      repoInstanceId: input.repoInstanceId,
    })
    const allocatedSessionId =
      input.kind === 'primary'
        ? 'session-1'
        : `session-${
            currentSessions.reduce((max, session) => {
              const match = /session-(\d+)$/.exec(session.terminalSessionId)
              const index = Number.parseInt(match?.[1] ?? '', 10)
              return Number.isFinite(index) ? Math.max(max, index) : max
            }, 0) + 1
          }`
    const terminalSessionId = allocatedSessionId
    if (
      input.kind === 'primary' &&
      currentSessions.some((session) => session.terminalSessionId === terminalSessionId)
    ) {
      serverSessions = currentSessions
      const reused = currentSessions.find((session) => session.terminalSessionId === terminalSessionId)
      // Reused session also has to supply first-frame hydration
      // fields — the registry validates them on every successful
      // `create` response, not just newly-created ones.
      return {
        ok: true,
        action: 'reused',
        terminalSessionId,
        tabs: workspaceTabsWithTerminal(terminalSessionId),
        sessions: completeServerSessions(serverSessions),
        terminalRuntimeSessionId: reused?.terminalRuntimeSessionId ?? 'session-1',
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
        .filter((session) => session.terminalSessionId !== terminalSessionId)
        .map((session) => ({
          ...session,
          controller: session.controller?.clientId === input.clientId ? null : session.controller,
        })),
      {
        terminalRuntimeSessionId: terminalSessionId,
        terminalSessionId,
        repoInstanceId: input.repoInstanceId,
        repoRoot: input.repoRoot,
        worktreePath: input.worktreePath,
        cwd: input.worktreePath,
        controller,
        processName: terminalSessionId,
        canonicalTitle: null,
        phase: 'open',
        message: null,
        cols: 80,
        rows: 24,
      },
    ]
    // First-frame hydration contract: `create` returns
    // `terminalRuntimeSessionId` + `snapshot` + `snapshotSeq` directly so the
    // client can paint without a follow-up snapshot fetch.
    return {
      ok: true,
      action: 'created',
      terminalSessionId,
      tabs: workspaceTabsWithTerminal(terminalSessionId),
      sessions: completeServerSessions(serverSessions),
      terminalRuntimeSessionId: terminalSessionId,
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
          terminalRuntimeSessionId: 'unused',
          snapshot: '',
          snapshotSeq: 0,
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'open',
          message: null,
          controller: { clientId: 'client_local', status: 'connected' as const },
          canonicalCols: 80,
          canonicalRows: 24,
        })),
        restart: vi.fn(async () => ({
          ok: true,
          terminalRuntimeSessionId: 'unused',
          snapshot: '',
          snapshotSeq: 0,
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'open',
          message: null,
          controller: { clientId: 'client_local', status: 'connected' as const },
          canonicalCols: 80,
          canonicalRows: 24,
        })),
        write: vi.fn(async () => true),
        resize: vi.fn(async () => true),
        takeover: vi.fn(async () => ({
          ok: true as const,
          terminalRuntimeSessionId: 'session-1',
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
        listWorkspaceTabs: async (input: { repoRoot: string }) => await listWorkspaceTabsMock(input),
        onOutput: vi.fn((cb: (event: TerminalOutputEvent) => void) => {
          outputHandler = cb
          return () => {}
        }),
        onBell: vi.fn((cb: (event: TerminalBellRealtimeEvent) => void) => {
          bellHandler = cb
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
        onIdentity: vi.fn((cb: (event: TerminalIdentityRealtimeEvent) => void) => {
          identityHandler = cb
          return () => {}
        }),
        onLifecycle: vi.fn((cb: (event: TerminalLifecycleRealtimeEvent) => void) => {
          lifecycleHandler = cb
          return () => {}
        }),
        onSessionsChanged: vi.fn((cb: (repoRoot: string) => void) => {
          sessionsChangedHandler = cb
          return () => {
            if (sessionsChangedHandler === cb) sessionsChangedHandler = null
          }
        }),
        onWorkspaceTabsChanged: vi.fn((cb: (repoRoot: string) => void) => {
          workspaceTabsChangedHandler = cb
          return () => {
            if (workspaceTabsChangedHandler === cb) workspaceTabsChangedHandler = null
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
        terminalRuntimeSessionId: 'session-1',
        role: 'controller' as const,
        controllerStatus: 'connected' as const,
        controller: { clientId: 'client_local', status: 'connected' as const },
        canonicalCols: 80,
        canonicalRows: 24,
        phase: 'open' as const,
      })),
      close: closeMock,
      create: createTerminalMock,
      replaceWorkspaceTabs: vi.fn(async (input) => input.tabs),
      updateWorkspaceTabs: vi.fn(async () => []),
      pruneTerminals: vi.fn(async () => ({ pruned: 0, remaining: 0 })),
      listSessions: async (input) => completeServerSessions(await listSessionsMock(input)),
      listWorkspaceTabs: async (input: { repoRoot: string }) => await listWorkspaceTabsMock(input),
      prewarm: vi.fn(async () => {}),
      kickReconnect: vi.fn(() => {}),
      notifyBell: window.goblinNative.terminal.notifyBell ?? vi.fn(async () => true),
      sendTestNotification: vi.fn(async () => true),
      setBadge: window.goblinNative.terminal.setBadge ?? vi.fn(() => {}),
      onOutput: vi.fn((cb: (event: TerminalOutputEvent) => void) => {
        outputHandler = cb
        return () => {}
      }),
      onBell: vi.fn((cb: (event: TerminalBellRealtimeEvent) => void) => {
        bellHandler = cb
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
      onIdentity: vi.fn((cb: (event: TerminalIdentityRealtimeEvent) => void) => {
        identityHandler = cb
        return () => {}
      }),
      onLifecycle: vi.fn((cb: (event: TerminalLifecycleRealtimeEvent) => void) => {
        lifecycleHandler = cb
        return () => {}
      }),
      onSessionsChanged: vi.fn((cb: (repoRoot: string) => void) => {
        sessionsChangedHandler = cb
        return () => {
          if (sessionsChangedHandler === cb) sessionsChangedHandler = null
        }
      }),
      onWorkspaceTabsChanged: vi.fn((cb: (repoRoot: string) => void) => {
        workspaceTabsChangedHandler = cb
        return () => {
          if (workspaceTabsChangedHandler === cb) workspaceTabsChangedHandler = null
        }
      }),
      onSessionClosed: vi.fn(
        (
          cb: (event: {
            terminalRuntimeSessionId: string
            terminalSessionId: string
            repoRoot: string
            worktreePath: string
          }) => void,
        ) => {
          sessionClosedHandler = cb
          return () => {
            if (sessionClosedHandler === cb) sessionClosedHandler = null
          }
        },
      ),
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
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      const base = repoTerminalBase()
      await act(async () => {
        useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'terminal')
        await getContext().createTerminal(base)
        await getContext().createTerminal(base)
      })

      expect(createTerminalMock).toHaveBeenCalledTimes(2)
      expect(createTerminalMock).toHaveBeenNthCalledWith(1, {
        ...base,
        kind: 'primary',
        clientId: 'client_sharedterminal',
        cols: 100,
        rows: 30,
      })
      expect(createTerminalMock).toHaveBeenNthCalledWith(2, {
        ...base,
        kind: 'additional',
        clientId: 'client_sharedterminal',
        cols: 100,
        rows: 30,
      })
      expect(
        getProbe().summaries.map((session) => [session.terminalSessionId, session.selected, session.hasBell]),
      ).toEqual([
        ['session-1', false, false],
        ['session-2', true, false],
      ])

      await act(async () => {
        exitHandler?.({ terminalRuntimeSessionId: 'session-2', terminalSessionId: 'session-2' })
      })

      expect(closeMock).not.toHaveBeenCalled()
      expect(selectedWorkspacePaneTab(REPO_ID)).toBe('terminal')
      expect(
        getProbe().summaries.map((session) => [session.terminalSessionId, session.selected, session.hasBell]),
      ).toEqual([['session-1', true, false]])

      // With the derived-value pattern, the store never re-projects the
      // preferred tab when terminal sessions go to zero. The user's intent
      // is preserved; `resolveRenderableWorkspacePaneTab` resolves the rendered tab
      // at read time (covered by `workspace-pane-tabs.ts` and
      // `workspace-pane-tab.test.ts`).
      await act(async () => {
        exitHandler?.({ terminalRuntimeSessionId: 'session-1', terminalSessionId: 'session-1' })
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
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      const base = repoTerminalBase()
      await act(async () => {
        await getContext().createTerminal(base)
        await getContext().createTerminal(base)
      })

      await act(async () => {
        bellHandler?.({
          terminalRuntimeSessionId: 'session-1',
          terminalSessionId: 'session-1',
          repoRoot: REPO_ID,
          worktreePath: WORKTREE_PATH,
          processName: 'zsh',
          canonicalTitle: '~/Developer/goblin — npm run dev',
        })
      })

      expect(
        getProbe().summaries.map((session) => [session.terminalSessionId, session.selected, session.hasBell]),
      ).toEqual([
        ['session-1', false, true],
        ['session-2', true, false],
      ])
      expect(notifyBell).toHaveBeenCalledWith({
        title: 'gbl-terminal-provider-repo',
        body: 'feature/worktree\n~/Developer/goblin — npm run dev',
        terminalSessionId: 'session-1',
        terminalWorktreeKey,
        repoRoot: REPO_ID,
      })

      await act(async () => {
        const firstTerminalSessionId = getProbe().summaries[0]?.terminalSessionId
        if (!firstTerminalSessionId) throw new Error('missing session-1 terminalSessionId')
        getContext().selectTerminal(terminalWorktreeKey, firstTerminalSessionId)
      })

      expect(
        getProbe().summaries.map((session) => [session.terminalSessionId, session.selected, session.hasBell]),
      ).toEqual([
        ['session-1', true, false],
        ['session-2', false, false],
      ])
      expect(useReposStore.getState().selectedTerminalSessionIdByTerminalWorktree).toMatchObject({
        [terminalWorktreeKey]: 'session-1',
      })
    } finally {
      hasFocus.mockRestore()
      await unmount()
    }
  })

  test('tracks unread bells from server realtime events without a live xterm bell', async () => {
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
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      const base = repoTerminalBase()
      await act(async () => {
        await getContext().createTerminal(base)
        await getContext().createTerminal(base)
      })

      await act(async () => {
        bellHandler?.({
          terminalRuntimeSessionId: 'session-1',
          terminalSessionId: 'session-1',
          repoRoot: REPO_ID,
          worktreePath: WORKTREE_PATH,
          processName: 'zsh',
          canonicalTitle: null,
        })
      })

      expect(
        getProbe().summaries.map((session) => [session.terminalSessionId, session.selected, session.hasBell]),
      ).toEqual([
        ['session-1', false, true],
        ['session-2', true, false],
      ])
      expect(notifyBell).toHaveBeenCalledWith({
        title: 'gbl-terminal-provider-repo',
        body: 'feature/worktree\nzsh',
        terminalSessionId: 'session-1',
        terminalWorktreeKey,
        repoRoot: REPO_ID,
      })
    } finally {
      hasFocus.mockRestore()
      await unmount()
    }
  })

  test('applies a server bell that arrives before the session projection materializes', async () => {
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
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await act(async () => {
        bellHandler?.({
          terminalRuntimeSessionId: 'session-1',
          terminalSessionId: 'session-1',
          repoRoot: REPO_ID,
          worktreePath: WORKTREE_PATH,
          processName: 'zsh',
          canonicalTitle: 'build running',
        })
        await getContext().createTerminal(repoTerminalBase())
      })

      expect(getProbe().summaries.map((session) => [session.terminalSessionId, session.hasBell])).toEqual([
        ['session-1', true],
      ])
      expect(notifyBell).toHaveBeenCalledWith({
        title: 'gbl-terminal-provider-repo',
        body: 'feature/worktree\nbuild running',
        terminalSessionId: 'session-1',
        terminalWorktreeKey,
        repoRoot: REPO_ID,
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
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH)
    const { getContext, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      const base = repoTerminalBase()
      await act(async () => {
        await getContext().createTerminal(base)
        await getContext().createTerminal(base)
      })

      const first = mockSessions.find((session) => session.descriptor.terminalSessionId === 'session-1')
      const second = mockSessions.find((session) => session.descriptor.terminalSessionId === 'session-2')
      if (!first || !second) throw new Error('missing terminal mock sessions')

      await act(async () => {
        outputHandler?.({
          terminalRuntimeSessionId: 'session-1',
          terminalSessionId: 'session-1',
          data: 'hello',
          seq: 1,
          processName: 'zsh',
        })
        titleHandler?.({
          terminalRuntimeSessionId: 'session-1',
          terminalSessionId: 'session-1',
          repoRoot: REPO_ID,
          worktreePath: WORKTREE_PATH,
          canonicalTitle: '~/Developer/goblin — npm run dev',
        })
        identityHandler?.({
          terminalRuntimeSessionId: 'session-2',
          terminalSessionId: 'session-2',
          role: 'controller',
          controllerStatus: 'connected',
          canonicalCols: 100,
          canonicalRows: 30,
        })
        lifecycleHandler?.({
          terminalRuntimeSessionId: 'session-2',
          terminalSessionId: 'session-2',
          phase: 'open',
          message: null,
          takeoverPending: false,
        })
      })

      expect(first.handleOutput).toHaveBeenCalledTimes(1)
      expect(first.handleOutput).toHaveBeenCalledWith({
        terminalRuntimeSessionId: 'session-1',
        terminalSessionId: 'session-1',
        data: 'hello',
        seq: 1,
        processName: 'zsh',
      })
      expect(first.handleServerTitle).toHaveBeenCalledTimes(1)
      expect(first.handleServerTitle).toHaveBeenCalledWith('~/Developer/goblin — npm run dev')
      expect(second.handleIdentity).toHaveBeenCalledTimes(1)
      expect(second.handleIdentity).toHaveBeenCalledWith({
        terminalRuntimeSessionId: 'session-2',
        terminalSessionId: 'session-2',
        role: 'controller',
        controllerStatus: 'connected',
        canonicalCols: 100,
        canonicalRows: 30,
      })
      expect(second.handleLifecycle).toHaveBeenCalledWith({
        terminalRuntimeSessionId: 'session-2',
        terminalSessionId: 'session-2',
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
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH)
    const { getContext, unmount } = await renderProvider()

    try {
      const base = repoTerminalBase()
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
        setRepoSnapshotQueryData(REPO_ID, useReposStore.getState().repos[REPO_ID]!.instanceId, {
          current: 'feature/renamed',
          branches: [createRepoBranch('feature/renamed', { worktree: { path: WORKTREE_PATH } })],
        })
        await Promise.resolve()
      })

      await vi.waitFor(() => {
        expect(
          readTerminalSessionCommandBridge()?.terminalWorktreeSnapshot(terminalWorktreeKey).selectedDescriptor?.branch,
        ).toBe('feature/renamed')
      })

      await act(async () => {
        notifyBell.mockClear()
        bellHandler?.({
          terminalRuntimeSessionId: 'session-1',
          terminalSessionId: 'session-1',
          repoRoot: REPO_ID,
          worktreePath: WORKTREE_PATH,
          processName: 'zsh',
          canonicalTitle: '~/Developer/goblin — npm run dev',
        })
      })

      expect(notifyBell).toHaveBeenLastCalledWith({
        title: 'gbl-terminal-provider-repo',
        body: 'feature/renamed\n~/Developer/goblin — npm run dev',
        terminalSessionId: 'session-1',
        terminalWorktreeKey,
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
        terminalRuntimeSessionId: 'server_session_1',
        terminalSessionId: 'session-1',
        cwd: WORKTREE_PATH,
        controller: { clientId: 'client_remote', status: 'connected' },
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        cols: 120,
        rows: 40,
      },
    ])
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH)
    const { getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await emitSessionsChanged()

      expect(getProbe().summaries).toEqual([
        expect.objectContaining({ terminalSessionId: 'session-1', title: 'zsh', phase: 'open' }),
      ])
      const hydrated = mockSessions.find((session) => session.descriptor.terminalSessionId === 'session-1')
      expect(hydrated?.hydrate).toHaveBeenCalledWith(
        expect.objectContaining({
          terminalRuntimeSessionId: 'server_session_1',
          processName: 'zsh',
          role: 'viewer',
          controllerStatus: 'connected',
          canonicalCols: 120,
          canonicalRows: 40,
          snapshot: '',
          snapshotSeq: 0,
        }),
      )

      listSessionsMock.mockResolvedValue([])
      await emitSessionsChanged()

      expect(getProbe().summaries).toEqual([])
    } finally {
      await unmount()
    }
  })

  test('invalidates workspace tabs query from session-closed events', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [
          workspacePaneStaticTabEntry('status'),
          workspacePaneTerminalTabEntry('session-1'),
          workspacePaneStaticTabEntry('history'),
        ],
      },
    })
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: REPO_ID,
      repoInstanceId: useReposStore.getState().repos[REPO_ID]!.instanceId,
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      tabs: [
        workspacePaneStaticTabEntry('status'),
        workspacePaneTerminalTabEntry('session-1'),
        workspacePaneStaticTabEntry('history'),
      ],
    })
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH)
    const { unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      listWorkspaceTabsMock.mockResolvedValue([
        {
          repoRoot: REPO_ID,
          branchName: 'feature/worktree',
          worktreePath: WORKTREE_PATH,
          tabs: [workspacePaneStaticTabEntry('history')],
        },
      ])

      await act(async () => {
        sessionClosedHandler?.({
          terminalRuntimeSessionId: 'server_session_1',
          terminalSessionId: 'session-1',
          repoRoot: REPO_ID,
          worktreePath: WORKTREE_PATH,
        })
      })

      await vi.waitFor(() => {
        expect(tabsFor(REPO_ID, 'feature/worktree')).toEqual([workspacePaneStaticTabEntry('history')])
      })
    } finally {
      await unmount()
    }
  })

  test('refreshes workspace tabs query from workspace-tabs-changed broadcasts', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [workspacePaneStaticTabEntry('status')],
      },
    })
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: REPO_ID,
      repoInstanceId: useReposStore.getState().repos[REPO_ID]!.instanceId,
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      tabs: [workspacePaneStaticTabEntry('status')],
    })
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH)
    const { unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      listWorkspaceTabsMock.mockResolvedValue([
        {
          repoRoot: REPO_ID,
          branchName: 'feature/worktree',
          worktreePath: WORKTREE_PATH,
          tabs: [workspacePaneStaticTabEntry('history')],
        },
      ])

      await act(async () => {
        workspaceTabsChangedHandler?.(REPO_ID)
        await waitForScheduledServerSync()
      })

      await vi.waitFor(() => {
        expect(tabsFor(REPO_ID, 'feature/worktree')).toEqual([workspacePaneStaticTabEntry('history')])
      })
    } finally {
      await unmount()
    }
  })

  test('coalesces session and workspace tabs change broadcasts', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH)
    const { unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await vi.waitFor(() => expect(listSessionsMock).toHaveBeenCalledTimes(1))
      listSessionsMock.mockClear()

      await act(async () => {
        sessionsChangedHandler?.(REPO_ID)
        workspaceTabsChangedHandler?.(REPO_ID)
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
        terminalRuntimeSessionId: 'server_session_1',
        terminalSessionId: 'session-1',
        cwd: WORKTREE_PATH,
        controller: { clientId: 'client_local', status: 'connected' },
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        cols: 80,
        rows: 24,
      },
    ]
    listSessionsMock.mockImplementation(async () => serverSessions)
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await emitSessionsChanged()
      expect(getProbe().summaries.map((session) => [session.terminalSessionId, session.selected])).toEqual([
        ['session-1', true],
      ])

      const base = repoTerminalBase()
      await act(async () => {
        await getContext().createTerminal(base)
      })
      expect(getProbe().summaries.map((session) => [session.terminalSessionId, session.selected])).toEqual([
        ['session-1', false],
        ['session-2', true],
      ])

      await emitSessionsChanged()

      expect(getProbe().summaries.map((session) => [session.terminalSessionId, session.selected])).toEqual([
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
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH)
    useReposStore.setState({
      selectedTerminalSessionIdByTerminalWorktree: {
        [terminalWorktreeKey]: 'session-1',
      },
    })
    serverSessions = [
      {
        terminalRuntimeSessionId: 'server_session_1',
        terminalSessionId: 'session-1',
        cwd: WORKTREE_PATH,
        controller: null,
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        cols: 80,
        rows: 24,
      },
      {
        terminalRuntimeSessionId: 'server_session_2',
        terminalSessionId: 'session-2',
        cwd: WORKTREE_PATH,
        controller: { clientId: 'client_local', status: 'connected' },
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        cols: 80,
        rows: 24,
      },
    ]
    listSessionsMock.mockImplementation(async () => serverSessions)
    const { getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await emitSessionsChanged()

      expect(getProbe().summaries.map((session) => [session.terminalSessionId, session.selected])).toEqual([
        ['session-1', true],
        ['session-2', false],
      ])
      expect(useReposStore.getState().selectedTerminalSessionIdByTerminalWorktree).toMatchObject({
        [terminalWorktreeKey]: 'session-1',
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
      instanceId: 'repo-instance-second',
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
        preferredWorkspacePaneTabByTarget: preferredWorkspacePaneTabByTargetRecordWith(
          firstRepo.ui,
          { repoRoot: SECOND_REPO_ID, branchName: 'feature/other', worktreePath: SECOND_WORKTREE_PATH },
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
    const { unmount } = await renderProviderWithProbe(formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH))

    try {
      await vi.waitFor(() => expect(listSessionsMock).toHaveBeenCalledTimes(1))
      expect(listSessionsMock).toHaveBeenCalledWith({ repoRoot: REPO_ID, repoInstanceId: firstRepo.instanceId })
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
      instanceId: 'repo-instance-second',
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
        preferredWorkspacePaneTabByTarget: preferredWorkspacePaneTabByTargetRecordWith(
          firstRepo.ui,
          { repoRoot: SECOND_REPO_ID, branchName: 'feature/other', worktreePath: SECOND_WORKTREE_PATH },
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
    const { unmount } = await renderProviderWithProbe(formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH))

    try {
      await vi.waitFor(() => expect(listSessionsMock).toHaveBeenCalledTimes(1))
      listSessionsMock.mockClear()
      await act(async () => {
        window.dispatchEvent(new Event('focus'))
      })
      await vi.waitFor(() => expect(listSessionsMock).toHaveBeenCalledTimes(1))
      expect(listSessionsMock).toHaveBeenCalledWith({ repoRoot: REPO_ID, repoInstanceId: firstRepo.instanceId })
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
    const { unmount } = await renderProviderWithProbe(formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH))

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

  test('failed session sync does not mark the repo ready', async () => {
    const repo = seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    listSessionsMock.mockRejectedValueOnce(new Error('error.repo-instance-stale'))
    const { unmount } = await renderProviderWithProbe(formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH))

    try {
      await vi.waitFor(() => expect(listSessionsMock).toHaveBeenCalledTimes(1))
      expect(useRepoSyncStore.getState().ready.get(REPO_ID)).not.toBe(repo.instanceId)
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
        terminalRuntimeSessionId: 'server_session_2',
        terminalSessionId: 'session-2',
        cwd: WORKTREE_PATH,
        controller: { clientId: 'client_remote', status: 'connected' },
        processName: 'node',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        cols: 100,
        rows: 30,
      },
    ])
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await emitSessionsChanged()

      let createdKey = ''
      await act(async () => {
        createdKey = await getContext().createTerminal(repoTerminalBase())
      })

      expect(createdKey).toBe('session-3')
      expect(getProbe().summaries.map((session) => session.terminalSessionId)).toEqual(['session-2', 'session-3'])
    } finally {
      await unmount()
    }
  })

  test('does not fall back to a local render snapshot when server omits snapshot', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        terminalRuntimeSessionId: 'server_session_3',
        terminalSessionId: 'session-1',
        cwd: WORKTREE_PATH,
        controller: { clientId: 'client_remote', status: 'connected' },
        processName: 'bash',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        cols: 100,
        rows: 30,
      },
    ])
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await emitSessionsChanged()

      const terminalSessionId = getProbe().summaries[0]?.terminalSessionId
      if (!terminalSessionId) throw new Error('missing terminalSessionId')
      const session = mockSessions.find((item) => item.descriptor.terminalSessionId === 'session-1')
      if (!session) throw new Error('missing terminal mock session')

      getContext().detach(terminalSessionId, document.createElement('div'))

      listSessionsMock.mockResolvedValue([
        {
          terminalRuntimeSessionId: 'server_session_3',
          terminalSessionId: 'session-1',
          cwd: WORKTREE_PATH,
          controller: { clientId: 'client_remote', status: 'connected' },
          processName: 'bash',
          canonicalTitle: null,
          phase: 'open',
          message: null,
          cols: 100,
          rows: 30,
        },
      ])
      await emitSessionsChanged()

      expect(session.hydrate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          snapshot: '',
          snapshotSeq: 0,
        }),
      )
    } finally {
      await unmount()
    }
  })

  test('does not reuse stale server snapshot for a different recycled pty id', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        terminalRuntimeSessionId: 'server_session_old',
        terminalSessionId: 'session-1',
        cwd: WORKTREE_PATH,
        controller: { clientId: 'client_remote', status: 'connected' },
        processName: 'bash',
        canonicalTitle: null,
        phase: 'open',
        message: null,
        cols: 100,
        rows: 30,
      },
    ])
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await emitSessionsChanged()

      const terminalSessionId = getProbe().summaries[0]?.terminalSessionId
      if (!terminalSessionId) throw new Error('missing terminalSessionId')
      const session = mockSessions.find((item) => item.descriptor.terminalSessionId === 'session-1')
      if (!session) throw new Error('missing terminal mock session')

      getContext().detach(terminalSessionId, document.createElement('div'))

      listSessionsMock.mockResolvedValue([
        {
          terminalRuntimeSessionId: 'server_session_new',
          terminalSessionId: 'session-1',
          cwd: WORKTREE_PATH,
          controller: { clientId: 'client_remote', status: 'connected' },
          processName: 'bash',
          canonicalTitle: null,
          phase: 'open',
          message: null,
          cols: 100,
          rows: 30,
        },
      ])

      await emitSessionsChanged()

      expect(session.hydrate).toHaveBeenLastCalledWith(
        expect.not.objectContaining({
          snapshot: 'old-snapshot',
        }),
      )
    } finally {
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
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      expect(getProbe()).toMatchObject({ count: 0, terminalIds: [], summaries: [] })

      const base = repoTerminalBase()
      await act(async () => {
        await getContext().createTerminal(base)
      })
      expect(getProbe()).toMatchObject({ count: 1, terminalIds: ['session-1'] })

      await act(async () => {
        await getContext().createTerminal(base)
      })
      expect(getProbe()).toMatchObject({ count: 2, terminalIds: ['session-1', 'session-2'] })

      await act(async () => {
        exitHandler?.({ terminalRuntimeSessionId: 'session-2', terminalSessionId: 'session-2' })
      })
      expect(getProbe()).toMatchObject({ count: 1, terminalIds: ['session-1'] })
    } finally {
      await unmount()
    }
  })

  test('creates terminal from first-frame payload when the server omits it from sessions projection', async () => {
    seedRepoState({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      selectedBranch: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    createTerminalMock.mockResolvedValueOnce({
      ok: true as const,
      action: 'created' as const,
      terminalSessionId: 'session-1',
      tabs: [],
      sessions: [],
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
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
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      await expect(getContext().createTerminal(repoTerminalBase())).resolves.toBe('session-1')
      expect(getProbe()).toMatchObject({ count: 1, terminalIds: ['session-1'] })
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
    const result = renderTerminalProvider(<span>probe</span>)
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
          terminalSessionId: 'k',
          tabs: [],
          sessions: [],
          terminalRuntimeSessionId: 'session-1',
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
        replaceWorkspaceTabs: vi.fn(async (input) => input.tabs),
        updateWorkspaceTabs: vi.fn(async () => []),
        pruneTerminals: vi.fn(async () => ({ pruned: 0, remaining: 0 })),
        listSessions: vi.fn(async () => []),
        listWorkspaceTabs: vi.fn(async () => []),
        prewarm,
        kickReconnect: vi.fn(() => {}),
        notifyBell: vi.fn(async () => false),
        sendTestNotification: vi.fn(async () => false),
        setBadge: () => {},
        onOutput: () => () => {},
        onBell: () => () => {},
        onTitle: () => () => {},
        onExit: () => () => {},
        onIdentity: () => () => {},
        onLifecycle: () => () => {},
        onSessionsChanged: () => () => {},
        onWorkspaceTabsChanged: () => () => {},
        onSessionClosed: () => () => {},
      }),
    })

    const result = renderTerminalProvider(<span>probe</span>)
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
          terminalSessionId: 'k',
          tabs: [],
          sessions: [],
          terminalRuntimeSessionId: 'session-1',
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
        replaceWorkspaceTabs: vi.fn(async (input) => input.tabs),
        updateWorkspaceTabs: vi.fn(async () => []),
        pruneTerminals: vi.fn(async () => ({ pruned: 0, remaining: 0 })),
        listSessions: vi.fn(async () => []),
        listWorkspaceTabs: vi.fn(async () => []),
        prewarm: vi.fn(async () => {}),
        kickReconnect,
        notifyBell: vi.fn(async () => false),
        sendTestNotification: vi.fn(async () => false),
        setBadge: () => {},
        onOutput: () => () => {},
        onBell: () => () => {},
        onTitle: () => () => {},
        onExit: () => () => {},
        onIdentity: () => () => {},
        onLifecycle: () => () => {},
        onSessionsChanged: () => () => {},
        onWorkspaceTabsChanged: () => () => {},
        onSessionClosed: () => () => {},
      }),
    })

    const result = renderTerminalProvider(<span>probe</span>)
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
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH)

    const first = await renderProviderWithProbe(terminalWorktreeKey)
    try {
      await act(async () => {
        await first.getContext().createTerminal(repoTerminalBase())
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
  terminalWorktreeKey,
  onProbe,
}: {
  terminalWorktreeKey: string
  onProbe: (value: {
    count: number
    terminalIds: string[]
    summaries: Array<{
      terminalSessionId: string
      selected: boolean
      hasBell: boolean
      title: string
      phase: string
    }>
  }) => void
}) {
  const summaries = useTerminalSessionSummaries(terminalWorktreeKey)
  onProbe({
    count: useTerminalWorktreeCount(terminalWorktreeKey),
    terminalIds: summaries.map((session) => session.terminalSessionId),
    summaries: summaries.map((session) => ({
      terminalSessionId: session.terminalSessionId,
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
  const result = renderTerminalProvider(
    <>
      <CaptureContext onContext={(value) => (context = value)} />
      <RegisterHost terminalWorktreeKey={formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH)} />
    </>,
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

async function renderProviderWithProbe(terminalWorktreeKey: string): Promise<{
  getContext: () => TerminalSessionContextValue
  getProbe: () => {
    count: number
    terminalIds: string[]
    summaries: Array<{
      terminalSessionId: string
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
      terminalSessionId: string
      selected: boolean
      hasBell: boolean
      title: string
      phase: string
    }>
  } | null = null
  const result = renderTerminalProvider(
    <>
      <CaptureContext onContext={(value) => (context = value)} />
      <RegisterHost terminalWorktreeKey={terminalWorktreeKey} />
      <CaptureGroupProbe terminalWorktreeKey={terminalWorktreeKey} onProbe={(value) => (probe = value)} />
    </>,
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

function renderTerminalProvider(children: React.ReactNode) {
  return renderInJsdom(
    <QueryClientProvider client={primaryWindowQueryClient}>
      <TerminalSessionProvider>{children}</TerminalSessionProvider>
    </QueryClientProvider>,
  )
}

function RegisterHost({ terminalWorktreeKey }: { terminalWorktreeKey: string }) {
  const context = useTerminalSessionContext()
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const host = ref.current
    if (!host) return
    context.registerHost(terminalWorktreeKey, host)
    return () => {
      context.unregisterHost(terminalWorktreeKey, host)
    }
  }, [context, terminalWorktreeKey])

  return <div ref={ref} />
}
