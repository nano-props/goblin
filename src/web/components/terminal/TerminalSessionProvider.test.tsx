// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { ELECTRON_CLIENT_CAPABILITIES, CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { TerminalSessionProvider } from '#/web/components/terminal/TerminalSessionProvider.tsx'
import { AppRuntimeProjectionProvider } from '#/web/runtime/AppRuntimeProjectionProvider.tsx'
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
import {
  createRepoBranch,
  resetReposStore,
  seedRepoReadModelQueryData,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import {
  preferredWorkspacePaneTabForTarget,
  workspacePaneTabsTargetForRepoBranch,
} from '#/web/stores/repos/workspace-pane-preferences.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { useTerminalProjectionHydrationStore } from '#/web/stores/terminal-projection-hydration.ts'
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
} from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabsEntry } from '#/shared/workspace-pane-tabs.ts'
import {
  workspacePaneStaticTabEntry,
  workspacePaneRuntimeTabEntry,
  workspacePaneTabsWithRuntimeTab,
} from '#/shared/workspace-pane.ts'
import type { WorkspacePaneTabEntry } from '#/shared/workspace-pane.ts'
import {
  readWorkspacePaneTabsForTarget,
  setWorkspacePaneTabsForTargetQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'

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

function selectedWorkspacePaneTab(repoId: string, branchName = 'feature/worktree') {
  const repo = useReposStore.getState().repos[repoId]
  return repo
    ? preferredWorkspacePaneTabForTarget(
        repo.ui,
        workspacePaneTabsTargetForRepoBranch(
          { repoRoot: repo.id, branches: readRepoBranchQueryProjection(repo)?.branches ?? [] },
          branchName,
        ),
      )
    : null
}

function repoTerminalBase() {
  return {
    repoRoot: REPO_ID,
    repoRuntimeId: useReposStore.getState().repos[REPO_ID]!.repoRuntimeId,
    branch: 'feature/worktree',
    worktreePath: WORKTREE_PATH,
  }
}

function indexedTerminalSessionId(index: number): string {
  const digit = String(index % 10)
  return `term-${digit.repeat(21)}`
}

function indexedTerminalSessionIdIndex(terminalSessionId: string): number | null {
  const match = /^term-(\d)\1{20}$/.exec(terminalSessionId)
  return match ? Number.parseInt(match[1], 10) : null
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
const BRANCH_NAME = 'feature/worktree'
const WORKTREE_PATH = '/tmp/gbl-terminal-provider-worktree'

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
type TestTerminalSessionSummary = Omit<
  TerminalSessionSummary,
  'repoRuntimeId' | 'repoRoot' | 'branch' | 'worktreePath'
> &
  Partial<Pick<TerminalSessionSummary, 'repoRuntimeId' | 'repoRoot' | 'branch' | 'worktreePath'>>
const listSessionsMock = vi.fn<
  (...args: Array<{ repoRoot: string; repoRuntimeId?: string }>) => Promise<TestTerminalSessionSummary[]>
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
    repoRuntimeId: session.repoRuntimeId ?? useReposStore.getState().repos[REPO_ID]!.repoRuntimeId,
    repoRoot: session.repoRoot ?? REPO_ID,
    branch: session.branch ?? BRANCH_NAME,
    worktreePath: session.worktreePath ?? WORKTREE_PATH,
  }
}

function completeServerSessions(sessions: TestTerminalSessionSummary[]): TerminalSessionSummary[] {
  return sessions.map(completeServerSession)
}

function tabsFor(repoRoot: string, branchName: string): WorkspacePaneTabEntry[] {
  const repo = useReposStore.getState().repos[repoRoot]
  const target = repo
    ? workspacePaneTabsTargetForRepoBranch(
        { repoRoot: repo.id, branches: readRepoBranchQueryProjection(repo)?.branches ?? [] },
        branchName,
      )
    : null
  return target ? readWorkspacePaneTabsForTarget({ ...target, repoRuntimeId: repo.repoRuntimeId }) : []
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
      repoRuntimeId: input.repoRuntimeId,
    })
    const allocatedSessionId =
      input.kind === 'primary'
        ? indexedTerminalSessionId(1)
        : indexedTerminalSessionId(
            currentSessions.reduce((max, session) => {
              const index = indexedTerminalSessionIdIndex(session.terminalSessionId)
              return index === null ? max : Math.max(max, index)
            }, 0) + 1,
          )
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
        sessions: completeServerSessions(serverSessions),
        terminalRuntimeSessionId: reused?.terminalRuntimeSessionId ?? 'term-111111111111111111111',
        snapshot: '',
        snapshotSeq: 0,
        outputEra: 0,
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
        repoRuntimeId: input.repoRuntimeId,
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
      sessions: completeServerSessions(serverSessions),
      terminalRuntimeSessionId: terminalSessionId,
      snapshot: '',
      snapshotSeq: 0,
      outputEra: 0,
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
  useTerminalProjectionHydrationStore.setState(useTerminalProjectionHydrationStore.getInitialState())
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
          outputEra: 0,
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
          outputEra: 0,
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
          terminalRuntimeSessionId: 'term-111111111111111111111',
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
        pruneTerminals: vi.fn(async () => ({ pruned: 0, remaining: 0 })),
        recoverSessions: async (input: { repoRoot: string }) => ({
          sessions: completeServerSessions(await listSessionsMock(input)),
          snapshots: [],
          workspacePaneTabs: { revision: 0, entries: [] },
        }),
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
        onSessionClosed: vi.fn(() => () => {}),
      },
      workspacePaneTabs: {
        replace: vi.fn(async (input: { tabs: unknown[] }) => input.tabs),
        update: vi.fn(async () => []),
        list: async (input: { repoRoot: string }) => ({
          revision: 1,
          entries: await listWorkspaceTabsMock(input),
        }),
        onChanged: vi.fn((cb: (repoRoot: string) => void) => {
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
    appRealtime: () => ({
      kickReconnect: vi.fn(() => {}),
      onRecovered: vi.fn(() => () => {}),
    }),
    terminal: () => ({
      attach: vi.fn(async () => attachResult()),
      restart: vi.fn(async () => attachResult()),
      write: vi.fn(async () => true),
      resize: vi.fn(async () => true),
      takeover: vi.fn(async () => ({
        ok: true as const,
        terminalRuntimeSessionId: 'term-111111111111111111111',
        role: 'controller' as const,
        controllerStatus: 'connected' as const,
        controller: { clientId: 'client_local', status: 'connected' as const },
        canonicalCols: 80,
        canonicalRows: 24,
        phase: 'open' as const,
      })),
      close: closeMock,
      pruneTerminals: vi.fn(async () => ({ pruned: 0, remaining: 0 })),
      recoverSessions: async (input) => ({
        sessions: completeServerSessions(await listSessionsMock(input)),
        snapshots: [],
        workspacePaneTabs: { revision: 0, entries: [] },
      }),
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
    workspacePaneTabs: () => ({
      replace: vi.fn(async () => ({ revision: 1, entries: [] })),
      update: vi.fn(async () => ({ revision: 1, entries: [] })),
      list: async (input) => ({ revision: 1, entries: await listWorkspaceTabsMock(input) }),
      onChanged: vi.fn((cb: (repoRoot: string) => void) => {
        workspaceTabsChangedHandler = cb
        return () => {
          if (workspaceTabsChangedHandler === cb) workspaceTabsChangedHandler = null
        }
      }),
    }),
    workspacePaneRuntime: () => ({
      open: vi.fn(async (input) => {
        const runtime = await createTerminalMock(input.request)
        if (!runtime.ok) return { ok: false as const, runtimeType: 'terminal' as const, message: runtime.message }
        const tabs = workspacePaneTabsWithRuntimeTab(
          readWorkspacePaneTabsForTarget({
            repoRoot: input.request.repoRoot,
            repoRuntimeId: input.request.repoRuntimeId,
            branchName: input.request.branch,
            worktreePath: input.request.worktreePath,
          }),
          'terminal',
          runtime.terminalSessionId,
          { insertAfterIdentity: input.insertAfterIdentity },
        )
        return {
          ok: true as const,
          runtimeType: 'terminal' as const,
          runtime,
          workspacePaneTabs: {
            revision: 1,
            entries: [
              {
                repoRoot: input.request.repoRoot,
                branchName: input.request.branch,
                worktreePath: input.request.worktreePath,
                tabs,
              },
            ],
          },
        }
      }),
      close: vi.fn(async () => ({ ok: false as const, runtimeType: 'terminal' as const, message: 'unavailable' })),
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
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      const base = repoTerminalBase()
      await act(async () => {
        useReposStore.getState().setWorkspacePaneTab(REPO_ID, 'feature/worktree', 'terminal')
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
        ['term-111111111111111111111', false, false],
        ['term-222222222222222222222', true, false],
      ])

      await act(async () => {
        exitHandler?.({
          terminalRuntimeSessionId: 'term-222222222222222222222',
          terminalSessionId: 'term-222222222222222222222',
        })
      })

      expect(closeMock).not.toHaveBeenCalled()
      expect(selectedWorkspacePaneTab(REPO_ID)).toBe('terminal')
      expect(
        getProbe().summaries.map((session) => [session.terminalSessionId, session.selected, session.hasBell]),
      ).toEqual([['term-111111111111111111111', true, false]])

      // With the derived-value pattern, the store never re-projects the
      // preferred tab when terminal sessions go to zero. The user's intent
      // is preserved; `resolveRenderableWorkspacePaneTab` resolves the rendered tab
      // at read time (covered by `workspace-pane-tabs.ts` and
      // `workspace-pane-tab.test.ts`).
      await act(async () => {
        exitHandler?.({
          terminalRuntimeSessionId: 'term-111111111111111111111',
          terminalSessionId: 'term-111111111111111111111',
        })
      })

      expect(closeMock).not.toHaveBeenCalled()
      expect(selectedWorkspacePaneTab(REPO_ID)).toBe('terminal')
    } finally {
      await unmount()
    }
  })

  test('tracks unread bells in provider state and clears them when activating the session', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
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
          terminalRuntimeSessionId: 'term-111111111111111111111',
          terminalSessionId: 'term-111111111111111111111',
          repoRoot: REPO_ID,
          worktreePath: WORKTREE_PATH,
          processName: 'zsh',
          canonicalTitle: '~/Developer/goblin — npm run dev',
        })
      })

      expect(
        getProbe().summaries.map((session) => [session.terminalSessionId, session.selected, session.hasBell]),
      ).toEqual([
        ['term-111111111111111111111', false, true],
        ['term-222222222222222222222', true, false],
      ])
      expect(notifyBell).toHaveBeenCalledWith({
        title: 'gbl-terminal-provider-repo',
        body: 'feature/worktree\n~/Developer/goblin — npm run dev',
        terminalSessionId: 'term-111111111111111111111',
        terminalWorktreeKey,
        repoRoot: REPO_ID,
      })

      await act(async () => {
        const firstTerminalSessionId = getProbe().summaries[0]?.terminalSessionId
        if (!firstTerminalSessionId) throw new Error('missing term-111111111111111111111 terminalSessionId')
        getContext().selectTerminal(terminalWorktreeKey, firstTerminalSessionId)
      })

      expect(
        getProbe().summaries.map((session) => [session.terminalSessionId, session.selected, session.hasBell]),
      ).toEqual([
        ['term-111111111111111111111', true, false],
        ['term-222222222222222222222', false, false],
      ])
      expect(useReposStore.getState().selectedTerminalSessionIdByTerminalWorktree).toMatchObject({
        [terminalWorktreeKey]: 'term-111111111111111111111',
      })
    } finally {
      hasFocus.mockRestore()
      await unmount()
    }
  })

  test('tracks unread bells from server realtime events without a live xterm bell', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
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
          terminalRuntimeSessionId: 'term-111111111111111111111',
          terminalSessionId: 'term-111111111111111111111',
          repoRoot: REPO_ID,
          worktreePath: WORKTREE_PATH,
          processName: 'zsh',
          canonicalTitle: null,
        })
      })

      expect(
        getProbe().summaries.map((session) => [session.terminalSessionId, session.selected, session.hasBell]),
      ).toEqual([
        ['term-111111111111111111111', false, true],
        ['term-222222222222222222222', true, false],
      ])
      expect(notifyBell).toHaveBeenCalledWith({
        title: 'gbl-terminal-provider-repo',
        body: 'feature/worktree\nzsh',
        terminalSessionId: 'term-111111111111111111111',
        terminalWorktreeKey,
        repoRoot: REPO_ID,
      })
    } finally {
      hasFocus.mockRestore()
      await unmount()
    }
  })

  test('applies a server bell that arrives before the session projection materializes', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
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
          terminalRuntimeSessionId: 'term-111111111111111111111',
          terminalSessionId: 'term-111111111111111111111',
          repoRoot: REPO_ID,
          worktreePath: WORKTREE_PATH,
          processName: 'zsh',
          canonicalTitle: 'build running',
        })
        await getContext().createTerminal(repoTerminalBase())
      })

      expect(getProbe().summaries.map((session) => [session.terminalSessionId, session.hasBell])).toEqual([
        ['term-111111111111111111111', true],
      ])
      expect(notifyBell).toHaveBeenCalledWith({
        title: 'gbl-terminal-provider-repo',
        body: 'feature/worktree\nbuild running',
        terminalSessionId: 'term-111111111111111111111',
        terminalWorktreeKey,
        repoRoot: REPO_ID,
      })
    } finally {
      hasFocus.mockRestore()
      await unmount()
    }
  })

  test('routes realtime output, title, and identity directly to the matching terminal session', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
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

      const first = mockSessions.find(
        (session) => session.descriptor.terminalSessionId === 'term-111111111111111111111',
      )
      const second = mockSessions.find(
        (session) => session.descriptor.terminalSessionId === 'term-222222222222222222222',
      )
      if (!first || !second) throw new Error('missing terminal mock sessions')

      await act(async () => {
        outputHandler?.({
          terminalRuntimeSessionId: 'term-111111111111111111111',
          terminalSessionId: 'term-111111111111111111111',
          data: 'hello',
          seq: 1,
          outputEra: 0,
          processName: 'zsh',
        })
        titleHandler?.({
          terminalRuntimeSessionId: 'term-111111111111111111111',
          terminalSessionId: 'term-111111111111111111111',
          repoRoot: REPO_ID,
          worktreePath: WORKTREE_PATH,
          canonicalTitle: '~/Developer/goblin — npm run dev',
        })
        identityHandler?.({
          terminalRuntimeSessionId: 'term-222222222222222222222',
          terminalSessionId: 'term-222222222222222222222',
          role: 'controller',
          controllerStatus: 'connected',
          canonicalCols: 100,
          canonicalRows: 30,
        })
        lifecycleHandler?.({
          terminalRuntimeSessionId: 'term-222222222222222222222',
          terminalSessionId: 'term-222222222222222222222',
          phase: 'open',
          message: null,
          takeoverPending: false,
        })
      })

      expect(first.handleOutput).toHaveBeenCalledTimes(1)
      expect(first.handleOutput).toHaveBeenCalledWith({
        terminalRuntimeSessionId: 'term-111111111111111111111',
        terminalSessionId: 'term-111111111111111111111',
        data: 'hello',
        seq: 1,
        outputEra: 0,
        processName: 'zsh',
      })
      expect(first.handleServerTitle).toHaveBeenCalledTimes(1)
      expect(first.handleServerTitle).toHaveBeenCalledWith('~/Developer/goblin — npm run dev')
      expect(second.handleIdentity).toHaveBeenCalledTimes(1)
      expect(second.handleIdentity).toHaveBeenCalledWith({
        terminalRuntimeSessionId: 'term-222222222222222222222',
        terminalSessionId: 'term-222222222222222222222',
        role: 'controller',
        controllerStatus: 'connected',
        canonicalCols: 100,
        canonicalRows: 30,
      })
      expect(second.handleLifecycle).toHaveBeenCalledWith({
        terminalRuntimeSessionId: 'term-222222222222222222222',
        terminalSessionId: 'term-222222222222222222222',
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
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
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
                  ui: {
                    ...state.repos[REPO_ID]!.ui,
                    currentBranchName: 'feature/renamed',
                  },
                }
              : state.repos[REPO_ID],
          },
        }))
        seedRepoReadModelQueryData(useReposStore.getState().repos[REPO_ID]!, {
          branches: [createRepoBranch('feature/renamed', { worktree: { path: WORKTREE_PATH } })],
          currentBranch: 'feature/renamed',
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
          terminalRuntimeSessionId: 'term-111111111111111111111',
          terminalSessionId: 'term-111111111111111111111',
          repoRoot: REPO_ID,
          worktreePath: WORKTREE_PATH,
          processName: 'zsh',
          canonicalTitle: '~/Developer/goblin — npm run dev',
        })
      })

      expect(notifyBell).toHaveBeenLastCalledWith({
        title: 'gbl-terminal-provider-repo',
        body: 'feature/renamed\n~/Developer/goblin — npm run dev',
        terminalSessionId: 'term-111111111111111111111',
        terminalWorktreeKey,
        repoRoot: REPO_ID,
      })
    } finally {
      hasFocus.mockRestore()
      await unmount()
    }
  })

  test('reconciles externally created and removed terminal sessions across windows', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        terminalRuntimeSessionId: 'server_session_1',
        terminalSessionId: 'term-111111111111111111111',
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
        expect.objectContaining({ terminalSessionId: 'term-111111111111111111111', title: 'zsh', phase: 'open' }),
      ])
      const hydrated = mockSessions.find(
        (session) => session.descriptor.terminalSessionId === 'term-111111111111111111111',
      )
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
          outputEra: 0,
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
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
      workspacePaneTabsByBranch: {
        'feature/worktree': [
          workspacePaneStaticTabEntry('status'),
          workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
          workspacePaneStaticTabEntry('history'),
        ],
      },
    })
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: REPO_ID,
      repoRuntimeId: useReposStore.getState().repos[REPO_ID]!.repoRuntimeId,
      branchName: 'feature/worktree',
      worktreePath: WORKTREE_PATH,
      tabs: [
        workspacePaneStaticTabEntry('status'),
        workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111'),
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
          terminalSessionId: 'term-111111111111111111111',
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

  test('keeps a newly created terminal active after session sync when create transfers controller control', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    serverSessions = [
      {
        terminalRuntimeSessionId: 'server_session_1',
        terminalSessionId: 'term-111111111111111111111',
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
        ['term-111111111111111111111', true],
      ])

      const base = repoTerminalBase()
      await act(async () => {
        await getContext().createTerminal(base)
      })
      expect(getProbe().summaries.map((session) => [session.terminalSessionId, session.selected])).toEqual([
        ['term-111111111111111111111', false],
        ['term-222222222222222222222', true],
      ])

      await emitSessionsChanged()

      expect(getProbe().summaries.map((session) => [session.terminalSessionId, session.selected])).toEqual([
        ['term-111111111111111111111', false],
        ['term-222222222222222222222', true],
      ])
    } finally {
      await unmount()
    }
  })

  test('restores the persisted selected terminal for a worktree even when server control points at another session', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH)
    useReposStore.setState({
      selectedTerminalSessionIdByTerminalWorktree: {
        [terminalWorktreeKey]: 'term-111111111111111111111',
      },
    })
    serverSessions = [
      {
        terminalRuntimeSessionId: 'server_session_1',
        terminalSessionId: 'term-111111111111111111111',
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
        terminalSessionId: 'term-222222222222222222222',
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
        ['term-111111111111111111111', true],
        ['term-222222222222222222222', false],
      ])
      expect(useReposStore.getState().selectedTerminalSessionIdByTerminalWorktree).toMatchObject({
        [terminalWorktreeKey]: 'term-111111111111111111111',
      })
    } finally {
      await unmount()
    }
  })

  test('does not resync sessions when repo changes do not affect terminal worktree mapping', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
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

  test('allocates the next terminal index after syncing sessions from another window', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        terminalRuntimeSessionId: 'server_session_2',
        terminalSessionId: 'term-222222222222222222222',
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

      expect(createdKey).toBe('term-333333333333333333333')
      expect(getProbe().summaries.map((session) => session.terminalSessionId)).toEqual([
        'term-222222222222222222222',
        'term-333333333333333333333',
      ])
    } finally {
      await unmount()
    }
  })

  test('does not fall back to a local render snapshot when server omits snapshot', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        terminalRuntimeSessionId: 'server_session_3',
        terminalSessionId: 'term-111111111111111111111',
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
      const session = mockSessions.find((item) => item.descriptor.terminalSessionId === 'term-111111111111111111111')
      if (!session) throw new Error('missing terminal mock session')

      getContext().detach(terminalSessionId, document.createElement('div'))

      listSessionsMock.mockResolvedValue([
        {
          terminalRuntimeSessionId: 'server_session_3',
          terminalSessionId: 'term-111111111111111111111',
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
          outputEra: 0,
        }),
      )
    } finally {
      await unmount()
    }
  })

  test('does not reuse stale server snapshot for a different recycled pty id', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    listSessionsMock.mockResolvedValue([
      {
        terminalRuntimeSessionId: 'server_session_old',
        terminalSessionId: 'term-111111111111111111111',
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
      const session = mockSessions.find((item) => item.descriptor.terminalSessionId === 'term-111111111111111111111')
      if (!session) throw new Error('missing terminal mock session')

      getContext().detach(terminalSessionId, document.createElement('div'))

      listSessionsMock.mockResolvedValue([
        {
          terminalRuntimeSessionId: 'server_session_new',
          terminalSessionId: 'term-111111111111111111111',
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
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
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
      expect(getProbe()).toMatchObject({ count: 1, terminalIds: ['term-111111111111111111111'] })

      await act(async () => {
        await getContext().createTerminal(base)
      })
      expect(getProbe()).toMatchObject({
        count: 2,
        terminalIds: ['term-111111111111111111111', 'term-222222222222222222222'],
      })

      await act(async () => {
        exitHandler?.({
          terminalRuntimeSessionId: 'term-222222222222222222222',
          terminalSessionId: 'term-222222222222222222222',
        })
      })
      expect(getProbe()).toMatchObject({ count: 1, terminalIds: ['term-111111111111111111111'] })
    } finally {
      await unmount()
    }
  })

  test('creates terminal from first-frame payload when the server omits it from sessions projection', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    createTerminalMock.mockResolvedValueOnce({
      ok: true as const,
      action: 'created' as const,
      terminalSessionId: 'term-111111111111111111111',
      sessions: [],
      terminalRuntimeSessionId: 'pty_session_1_aaaaaaaaa',
      snapshot: '',
      snapshotSeq: 0,
      outputEra: 0,
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
      await expect(getContext().createTerminal(repoTerminalBase())).resolves.toBe('term-111111111111111111111')
      expect(getProbe()).toMatchObject({ count: 1, terminalIds: ['term-111111111111111111111'] })
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
    const result = renderTerminalProvider(<span>probe</span>, { currentRepoId: null })
    try {
      expect(geometryMocks.preloadTerminalFont).toHaveBeenCalledTimes(1)
    } finally {
      await act(async () => {
        result.unmount()
      })
    }
  })

  test('clears the command bridge on provider unmount', async () => {
    const result = renderTerminalProvider(<span>probe</span>, { currentRepoId: null })
    expect(readTerminalSessionCommandBridge()).not.toBeNull()

    await act(async () => {
      result.unmount()
    })

    expect(readTerminalSessionCommandBridge()).toBeNull()
  })

  test('registers terminal creation on the command bridge', async () => {
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH)
    const { getContext, unmount } = await renderProviderWithProbe(terminalWorktreeKey)

    try {
      expect(readTerminalSessionCommandBridge()?.createTerminal).toBe(getContext().createTerminal)
    } finally {
      await unmount()
    }
  })

  test('P1.7: registry state survives a Provider unmount + remount via the singleton', async () => {
    // Before P1.7, the Provider owned its registry and destroyed it
    // on unmount. After P1.7, the registry is a client-level
    // singleton — a remount must reuse the same instance with its
    // session list intact. This test mounts, creates a terminal,
    // unmounts, remounts, and confirms the prior session is still
    // observable in the second mount's context.
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    const terminalWorktreeKey = formatTerminalWorktreeKey(REPO_ID, WORKTREE_PATH)

    const first = await renderProviderWithProbe(terminalWorktreeKey)
    try {
      await act(async () => {
        await first.getContext().createTerminal(repoTerminalBase())
      })
      expect(first.getProbe()).toMatchObject({ count: 1, terminalIds: ['term-111111111111111111111'] })
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

function renderTerminalProvider(children: React.ReactNode, options?: { currentRepoId?: string | null }) {
  const currentRepoId = options && 'currentRepoId' in options ? options.currentRepoId : REPO_ID
  return renderInJsdom(
    <QueryClientProvider client={primaryWindowQueryClient}>
      <AppRuntimeProjectionProvider currentRepoId={currentRepoId ?? null}>
        <TerminalSessionProvider>{children}</TerminalSessionProvider>
      </AppRuntimeProjectionProvider>
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
