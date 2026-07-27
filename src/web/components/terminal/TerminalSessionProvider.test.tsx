// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { ELECTRON_CLIENT_CAPABILITIES, CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import type { WorkspacePaneTabsChangedRealtimeMessage } from '#/shared/workspace-pane-tabs.ts'
import type { TerminalExecutionTarget, TerminalSessionClosedEvent } from '#/shared/terminal-types.ts'
import {
  canonicalWorkspaceLocator,
  parseCanonicalWorkspaceLocator,
  type WorkspaceId,
} from '#/shared/workspace-locator.ts'
import { TerminalSessionProvider } from '#/web/components/terminal/TerminalSessionProvider.tsx'
import { AppRuntimeProjectionProvider } from '#/web/runtime/AppRuntimeProjectionProvider.tsx'
import { setTerminalSessionProjectionForTests } from '#/web/components/terminal/TerminalSessionProjection.ts'
import { useTerminalSessionContext } from '#/web/components/terminal/terminal-session-context.ts'
import { readTerminalSessionCommandBridge } from '#/web/components/terminal/terminal-session-command-bridge.ts'
import {
  useTerminalFilesystemTargetCount,
  useTerminalSessionSummaries,
} from '#/web/components/terminal/terminal-session-store.ts'
import { formatTerminalFilesystemTargetKeyForPath } from '#/shared/terminal-filesystem-target-key.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import { defaultSettingsSnapshot } from '#/shared/settings-defaults.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { settingsSnapshotQueryKey } from '#/web/settings-query-cache.ts'
import {
  createRepoBranch,
  resetWorkspacesStore,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
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
  TerminalSessionsChangedEvent,
  TerminalTitleEvent,
} from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabsEntry } from '#/shared/workspace-pane-tabs.ts'
import { runtimeWorkspacePaneTargetForTest } from '#/web/test-utils/workspace-pane-tabs.ts'
import { terminalSessionBaseForTest } from '#/web/test-utils/terminal-model.ts'

vi.mock('#/web/client-page-id.ts', () => ({ readClientPageId: () => 'client_sharedterminal' }))

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
}))

vi.mock('#/web/components/terminal/terminal-geometry.ts', async () => {
  const actual = await vi.importActual<typeof import('#/web/components/terminal/terminal-geometry.ts')>(
    '#/web/components/terminal/terminal-geometry.ts',
  )
  return {
    ...actual,
    preloadTerminalFont: geometryMocks.preloadTerminalFont,
  }
})

function repoTerminalBase() {
  const workspaceRuntimeId = useWorkspacesStore.getState().workspaces[REPO_ID]!.workspaceRuntimeId
  const target = runtimeWorkspacePaneTargetForTest({
    workspaceId: REPO_ID,
    workspaceRuntimeId,
    branchName: 'feature/worktree',
    worktreePath: WORKTREE_PATH,
  })
  if (target.kind !== 'git-worktree') throw new Error('expected git worktree target')
  return {
    target,
    presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: 'feature/worktree' } },
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
    private terminalRuntimeSessionId: string | null = null
    private terminalRuntimeGeneration: number | null = null
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

    detach() {}

    restart() {}

    focus() {}

    dispose() {}

    snapshot(): TerminalSnapshot {
      return this.snapshotValue
    }

    isVisible(): boolean {
      return false
    }
    controlsTerminal(): boolean {
      return this.snapshotValue.attachment?.role === 'controller'
    }

    findNext(): TerminalSearchResult {
      return { resultIndex: -1, resultCount: 0, found: false }
    }

    findPrevious(): TerminalSearchResult {
      return { resultIndex: -1, resultCount: 0, found: false }
    }

    clearSearch() {}

    scrollToBottom() {}

    captureInputWriter() {
      return null
    }

    takeover() {}

    currentTerminalRuntimeSessionId(): string | null {
      return this.terminalRuntimeSessionId
    }

    currentRuntimeBinding() {
      return this.terminalRuntimeSessionId && this.terminalRuntimeGeneration !== null
        ? {
            terminalRuntimeSessionId: this.terminalRuntimeSessionId,
            terminalRuntimeGeneration: this.terminalRuntimeGeneration,
          }
        : null
    }

    addressableRuntimeBinding() {
      return this.currentRuntimeBinding()
    }

    pendingAuthoritativeRuntimeBinding() {
      return null
    }

    commitPendingAuthoritativeHydration(): boolean {
      return false
    }

    classifyRuntimeBinding(binding: { terminalRuntimeSessionId: string; terminalRuntimeGeneration: number }) {
      const current = this.currentRuntimeBinding()
      if (!current) return 'future'
      if (
        current.terminalRuntimeSessionId === binding.terminalRuntimeSessionId &&
        current.terminalRuntimeGeneration === binding.terminalRuntimeGeneration
      )
        return 'active'
      if (
        current.terminalRuntimeSessionId === binding.terminalRuntimeSessionId &&
        binding.terminalRuntimeGeneration > current.terminalRuntimeGeneration
      )
        return 'future'
      return 'foreign'
    }

    hydrate(input: {
      terminalRuntimeSessionId: string
      terminalRuntimeGeneration: number
      phase: 'opening' | 'open' | 'error'
      message: string | null
      processName: string
      canonicalTitle?: string | null
      role: 'controller' | 'viewer' | 'unowned'
      controllerStatus: 'connected' | 'none'
      canonicalSize: { cols: number; rows: number } | null
    }) {
      this.hydrateSpy(input)
      this.terminalRuntimeSessionId = input.terminalRuntimeSessionId
      this.terminalRuntimeGeneration = input.terminalRuntimeGeneration
      this.snapshotValue = {
        phase: input.phase,
        message: input.message,
        processName: input.processName,
        canonicalTitle: input.canonicalTitle ?? null,
        attachment: {
          role: input.role,
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
      canonicalSize: { cols: number; rows: number }
    }) {
      this.handleIdentitySpy(event)
    }

    handleLifecycle(event: {
      terminalRuntimeSessionId: string
      phase: 'opening' | 'restarting' | 'open' | 'error' | 'closed'
      message: string | null
    }) {
      this.handleLifecycleSpy(event)
    }

    handleExit(_event: TerminalExitEvent): boolean {
      return true
    }
  }

  return { TerminalSession }
})

function workspaceIdFixture(input: string) {
  const workspaceId = canonicalWorkspaceLocator(input)
  if (!workspaceId) throw new Error('invalid workspace locator fixture')
  return workspaceId
}

const REPO_ID = workspaceIdFixture('goblin+file:///tmp/goblin-terminal-provider-repo')
const BRANCH_NAME = 'feature/worktree'
const WORKTREE_PATH = '/tmp/goblin-terminal-provider-worktree'

function terminalExitEvent(terminalSessionId: string): TerminalExitEvent {
  return {
    terminalRuntimeSessionId: terminalSessionId,
    terminalRuntimeGeneration: 1,
    terminalSessionId,
    workspaceId: REPO_ID,
    workspaceRuntimeId: useWorkspacesStore.getState().workspaces[REPO_ID]!.workspaceRuntimeId,
    tabsBeforeRetirement: null,
  }
}

let exitHandler: ((event: TerminalExitEvent) => void) | null = null
let outputHandler: ((event: TerminalOutputEvent) => void) | null = null
let bellHandler: ((event: TerminalBellRealtimeEvent) => void) | null = null
let titleHandler: ((event: TerminalTitleEvent) => void) | null = null
let identityHandler: ((event: TerminalIdentityRealtimeEvent) => void) | null = null
let lifecycleHandler: ((event: TerminalLifecycleRealtimeEvent) => void) | null = null
let sessionsChangedHandler: ((event: TerminalSessionsChangedEvent) => void) | null = null
let sessionsChangedRevision = 0
let workspaceTabsChangedHandler: ((message: WorkspacePaneTabsChangedRealtimeMessage) => void) | null = null
let sessionClosedHandler: ((event: TerminalSessionClosedEvent) => void) | null = null
type OptionalIdentityRevision<T> = T extends unknown
  ? Omit<T, 'identityRevision'> & { identityRevision?: number }
  : never
type TestTerminalSessionSummary = OptionalIdentityRevision<TerminalSessionSummary>
const listSessionsMock = vi.fn<
  (
    ...args: Array<{ workspaceId: typeof REPO_ID; workspaceRuntimeId?: string }>
  ) => Promise<TestTerminalSessionSummary[]>
>(async () => [])
const listWorkspaceTabsMock = vi.fn<(...args: Array<{ workspaceId: string }>) => Promise<WorkspacePaneTabsEntry[]>>(
  async () => [],
)
const closeMock = vi.fn(async () => true)
const createTerminalMock = vi.fn<(input: TerminalCreateInput) => Promise<TerminalCreateResult>>()
let serverSessions: TestTerminalSessionSummary[] = []

function completeServerSession(session: TestTerminalSessionSummary): TerminalSessionSummary {
  return {
    ...session,
    terminalRuntimeGeneration: session.terminalRuntimeGeneration ?? 1,
    identityRevision: session.identityRevision ?? 0,
    terminalSessionId: normalizeTestSessionId(session.terminalSessionId),
  }
}

function terminalRuntimeTarget(workspaceRuntimeId: string) {
  return runtimeWorkspacePaneTargetForTest({
    kind: 'git-worktree' as const,
    workspaceId: REPO_ID,
    workspaceRuntimeId: workspaceRuntimeId,
    worktreePath: WORKTREE_PATH,
  })
}

function completeServerSessions(sessions: TestTerminalSessionSummary[]): TerminalSessionSummary[] {
  return sessions.map(completeServerSession)
}

function normalizeTestSessionId(terminalSessionId: string): string {
  return terminalSessionId.split('\0').at(-1) ?? terminalSessionId
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

function restartResult() {
  return {
    ok: true as const,
    frame: 'stream' as const,
    terminalProjectionEffect: { kind: 'delta' as const, revision: 1 },
    terminalRuntimeSessionId: 'unused',
    terminalRuntimeGeneration: 2,
    identityRevision: 0,
    processName: 'zsh',
    canonicalTitle: null,
    phase: 'open' as const,
    message: null,
    controller: { clientId: 'client_local', status: 'connected' as const },
    canonicalSize: { cols: 80, rows: 24 },
  }
}

beforeEach(() => {
  // The provider's initial full catalog recovery establishes revision 1.
  // Every subsequent mocked mutation must advance the same server clock.
  sessionsChangedRevision = 1
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
    const workspaceId = input.target.workspaceId
    const workspaceRuntimeId = input.target.workspaceRuntimeId
    const worktreePath = terminalExecutionRootForTest(input.target)
    const presentation =
      input.target.kind === 'workspace-root'
        ? ({ kind: 'workspace-root' } as const)
        : ({ kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH_NAME } } as const)
    const currentSessions = await listSessionsMock({
      workspaceId,
      workspaceRuntimeId,
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
      // Reused and newly prepared sessions return the same metadata shape.
      // The later attach decides whether this existing PTY needs a snapshot.
      return {
        ok: true,
        action: 'reused',
        presentation,
        terminalProjectionEffect: { kind: 'delta', revision: ++sessionsChangedRevision },
        terminalSessionId,
        terminalRuntimeSessionId: reused?.terminalRuntimeSessionId ?? 'term-111111111111111111111',
        terminalRuntimeGeneration: reused?.terminalRuntimeGeneration ?? 0,
        identityRevision: reused?.identityRevision ?? 0,
        processName: reused?.processName ?? '',
        canonicalTitle: reused?.canonicalTitle ?? null,
        phase: reused?.phase ?? 'opening',
        message: reused?.message ?? null,
        controller: reused?.controller ?? null,
        canonicalSize: reused?.canonicalSize ?? null,
      }
    }
    const controller = { clientId: 'client_local', status: 'connected' as const }
    serverSessions = [
      ...currentSessions
        .filter((session) => session.terminalSessionId !== terminalSessionId)
        .map((session) => ({
          ...session,
          controller: session.controller?.clientId === 'client_local' ? null : session.controller,
        })),
      {
        terminalRuntimeSessionId: terminalSessionId,
        terminalRuntimeGeneration: 1,
        identityRevision: 0,
        terminalSessionId,
        target: runtimeWorkspacePaneTargetForTest({
          workspaceId,
          workspaceRuntimeId,
          branchName: BRANCH_NAME,
          worktreePath,
        }),
        presentation: { kind: 'git-worktree' as const, head: { kind: 'branch' as const, branchName: BRANCH_NAME } },
        controller,
        processName: terminalSessionId,
        canonicalTitle: null,
        phase: 'open',
        message: null,
        canonicalSize: { cols: 80, rows: 24 },
      },
    ]
    // Create materializes a logical session from metadata only. The selected
    // view will fit its xterm and attach before the fresh PTY starts.
    return {
      ok: true,
      action: 'restored',
      presentation,
      terminalProjectionEffect: { kind: 'delta', revision: ++sessionsChangedRevision },
      terminalSessionId,
      terminalRuntimeSessionId: terminalSessionId,
      terminalRuntimeGeneration: 1,
      identityRevision: 0,
      processName: 'zsh',
      canonicalTitle: null,
      phase: 'open',
      message: null,
      controller,
      canonicalSize: { cols: 80, rows: 24 },
    }
  })
  resetWorkspacesStore()
  useTerminalProjectionHydrationStore.setState(useTerminalProjectionHydrationStore.getInitialState())
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
      initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
      invokeIpc: vi.fn(async () => []),
      abortIpc: vi.fn(),
      onEvent: vi.fn(() => () => {}),
      pathForFile: vi.fn(() => ''),
      terminal: {
        attach: vi.fn(async () => ({
          ok: true,
          frame: 'snapshot' as const,
          terminalProjectionEffect: { kind: 'none' as const },
          terminalRuntimeSessionId: 'unused',
          terminalRuntimeGeneration: 1,
          snapshot: '',
          snapshotSeq: 0,
          processName: 'zsh',
          canonicalTitle: null,
          phase: 'open',
          message: null,
          controller: { clientId: 'client_local', status: 'connected' as const },
          canonicalSize: { cols: 80, rows: 24 },
        })),
        restart: vi.fn(async () => restartResult()),
        write: vi.fn(async () => ({ status: 'accepted' as const })),
        resize: vi.fn(async () => ({ ok: false as const, message: 'not configured' })),
        takeover: vi.fn(async () => ({
          ok: true as const,
          terminalRuntimeSessionId: 'term-111111111111111111111',
          terminalRuntimeGeneration: 1,
          role: 'controller' as const,
          controllerStatus: 'connected' as const,
          controller: { clientId: 'client_local', status: 'connected' as const },
          canonicalSize: { cols: 80, rows: 24 },
          phase: 'open' as const,
        })),
        close: closeMock,
        notifyBell: vi.fn(async () => true),
        setBadge: vi.fn(async () => {}),
        pruneTerminals: vi.fn(async () => ({ pruned: 0, remaining: 0 })),
        recoverSessions: async (input: { workspaceId: typeof REPO_ID }) => ({
          revision: Math.max(1, sessionsChangedRevision),
          sessions: completeServerSessions(await listSessionsMock(input)),
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
        onSessionsChanged: vi.fn((cb) => {
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
        list: async (input: { workspaceId: string }) => ({
          revision: 1,
          entries: await listWorkspaceTabsMock(input),
        }),
        onChanged: vi.fn((cb: (message: WorkspacePaneTabsChangedRealtimeMessage) => void) => {
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
      initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
    },
  })
  setClientBridgeForTests({
    kind: () => 'electron',
    hasCapability: (capability) =>
      capability === 'global-shortcut' ||
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
      initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
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
      close: closeMock,
      pruneTerminals: vi.fn(async () => ({ pruned: 0, remaining: 0 })),
      recoverSessions: async (input) => ({
        revision: Math.max(1, sessionsChangedRevision),
        sessions: completeServerSessions(await listSessionsMock(input)),
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
      onSessionsChanged: vi.fn((cb) => {
        sessionsChangedHandler = cb
        return () => {
          if (sessionsChangedHandler === cb) sessionsChangedHandler = null
        }
      }),
      onSessionClosed: vi.fn((cb: (event: TerminalSessionClosedEvent) => void) => {
        sessionClosedHandler = cb
        return () => {
          if (sessionClosedHandler === cb) sessionClosedHandler = null
        }
      }),
    }),
    workspacePaneTabs: () => ({
      replace: vi.fn(async () => ({ revision: 1, entries: [] })),
      update: vi.fn(async () => ({ revision: 1, entries: [] })),
      list: async (input) => ({ revision: 1, entries: await listWorkspaceTabsMock(input) }),
      onChanged: vi.fn((cb: (message: WorkspacePaneTabsChangedRealtimeMessage) => void) => {
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
        return {
          ok: true as const,
          runtimeType: 'terminal' as const,
          runtime,
          paneTabsSnapshot: { revision: 1, entries: await listWorkspaceTabsMock(input.request) },
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
  test('forwards realtime session events to the terminal projection', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKeyForPath(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalFilesystemTargetKey)

    try {
      const base = repoTerminalBase()
      await act(async () => {
        await getContext().createTerminal(base)
        await getContext().createTerminal(base)
      })

      const session = mockSessions[0]
      if (!session) throw new Error('missing terminal mock session')
      const outputEvent = {
        terminalRuntimeSessionId: 'term-111111111111111111111',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        data: 'hello',
        seq: 1,
        processName: 'zsh',
      }
      const identityEvent = {
        terminalRuntimeSessionId: 'term-111111111111111111111',
        terminalRuntimeGeneration: 1,
        identityRevision: 1,
        terminalSessionId: 'term-111111111111111111111',
        role: 'controller' as const,
        controllerStatus: 'connected' as const,
        canonicalSize: { cols: 100, rows: 30 },
      }
      const lifecycleEvent = {
        terminalRuntimeSessionId: 'term-111111111111111111111',
        terminalRuntimeGeneration: 1,
        terminalSessionId: 'term-111111111111111111111',
        phase: 'open' as const,
        message: null,
      }

      await act(async () => {
        outputHandler?.(outputEvent)
        bellHandler?.({
          terminalRuntimeSessionId: 'term-111111111111111111111',
          terminalRuntimeGeneration: 1,
          terminalSessionId: 'term-111111111111111111111',
          workspaceId: REPO_ID,
          processName: 'zsh',
          canonicalTitle: null,
        })
        titleHandler?.({
          terminalRuntimeSessionId: 'term-111111111111111111111',
          terminalRuntimeGeneration: 1,
          terminalSessionId: 'term-111111111111111111111',
          workspaceId: REPO_ID,
          canonicalTitle: '~/Developer/goblin — npm run dev',
        })
        identityHandler?.(identityEvent)
        lifecycleHandler?.(lifecycleEvent)
      })

      expect(session.handleOutput).toHaveBeenCalledWith(outputEvent)
      expect(session.handleServerTitle).toHaveBeenCalledWith('~/Developer/goblin — npm run dev')
      expect(session.handleIdentity).toHaveBeenCalledWith(identityEvent)
      expect(session.handleLifecycle).toHaveBeenCalledWith(lifecycleEvent)
      expect(getProbe().summaries[0]?.hasBell).toBe(true)

      await act(async () => {
        exitHandler?.(terminalExitEvent('term-222222222222222222222'))
      })
      expect(getProbe().terminalIds).toEqual(['term-111111111111111111111'])

      await act(async () => {
        sessionClosedHandler?.({
          terminalRuntimeSessionId: 'term-111111111111111111111',
          terminalRuntimeGeneration: 1,
          terminalSessionId: 'term-111111111111111111111',
          workspaceId: REPO_ID,
          workspaceRuntimeId: 'repo-runtime-test',
          tabsBeforeRetirement: null,
        })
      })
      expect(getProbe().summaries).toEqual([])
    } finally {
      await unmount()
    }
  })

  test('applies persisted terminal selection from the workspace store', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKeyForPath(REPO_ID, WORKTREE_PATH)
    const { getContext, getProbe, unmount } = await renderProviderWithProbe(terminalFilesystemTargetKey)

    try {
      await act(async () => {
        await getContext().createTerminal(repoTerminalBase())
        await getContext().createTerminal(repoTerminalBase())
      })
      await act(async () => {
        useWorkspacesStore.setState({
          selectedTerminalSessionIdByTerminalFilesystemTarget: {
            [terminalFilesystemTargetKey]: 'term-111111111111111111111',
          },
        })
      })

      expect(getProbe().summaries.map((session) => [session.terminalSessionId, session.selected])).toEqual([
        ['term-111111111111111111111', true],
        ['term-222222222222222222222', false],
      ])
    } finally {
      await unmount()
    }
  })

  test('prewarms the terminal font on provider mount', async () => {
    geometryMocks.preloadTerminalFont.mockClear()
    const result = renderTerminalProvider(<span>probe</span>, { currentWorkspaceId: null })
    try {
      expect(geometryMocks.preloadTerminalFont).toHaveBeenCalledTimes(1)
    } finally {
      await act(async () => {
        result.unmount()
      })
    }
  })

  test('registers the command bridge and clears it on provider unmount', async () => {
    const { getContext, unmount } = await renderProviderWithHost()

    try {
      expect(readTerminalSessionCommandBridge()?.createTerminal).toBe(getContext().createTerminal)
    } finally {
      await unmount()
    }
    expect(readTerminalSessionCommandBridge()).toBeNull()
  })

  test('preserves singleton projection state across provider remounts', async () => {
    seedRepoWithReadModelForTest({
      id: REPO_ID,
      branches: [createRepoBranch('feature/worktree', { worktree: { path: WORKTREE_PATH } })],
      currentBranchName: 'feature/worktree',
      preferredWorkspacePaneTab: 'terminal',
    })
    const terminalFilesystemTargetKey = formatTerminalFilesystemTargetKeyForPath(REPO_ID, WORKTREE_PATH)

    const first = await renderProviderWithProbe(terminalFilesystemTargetKey)
    try {
      await act(async () => {
        await first.getContext().createTerminal(repoTerminalBase())
      })
      expect(first.getProbe()).toMatchObject({ count: 1, terminalIds: ['term-111111111111111111111'] })
    } finally {
      await first.unmount()
    }

    const second = await renderProviderWithProbe(terminalFilesystemTargetKey)
    try {
      expect(second.getProbe()).toMatchObject({ count: 1, terminalIds: ['term-111111111111111111111'] })
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
  terminalFilesystemTargetKey,
  onProbe,
}: {
  terminalFilesystemTargetKey: string
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
  const summaries = useTerminalSessionSummaries(terminalFilesystemTargetKey)
  onProbe({
    count: useTerminalFilesystemTargetCount(terminalFilesystemTargetKey),
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

async function renderProviderWithHost(): Promise<{
  getContext: () => TerminalSessionContextValue
  unmount: () => Promise<void>
}> {
  let context: TerminalSessionContextValue | null = null
  const result = renderTerminalProvider(
    <>
      <CaptureContext onContext={(value) => (context = value)} />
      <RegisterHost terminalFilesystemTargetKey={formatTerminalFilesystemTargetKeyForPath(REPO_ID, WORKTREE_PATH)} />
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

async function renderProviderWithProbe(terminalFilesystemTargetKey: string): Promise<{
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
      <RegisterHost terminalFilesystemTargetKey={terminalFilesystemTargetKey} />
      <CaptureGroupProbe
        terminalFilesystemTargetKey={terminalFilesystemTargetKey}
        onProbe={(value) => (probe = value)}
      />
    </>,
  )
  await act(async () => {})

  return {
    getContext: () => {
      if (!context) throw new Error('Terminal session context was not captured')
      return context
    },
    getProbe: () => {
      if (!probe) throw new Error('Terminal filesystem target probe was not captured')
      return probe
    },
    unmount: async () => {
      await act(async () => {
        result.unmount()
      })
    },
  }
}

function renderTerminalProvider(children: React.ReactNode, options?: { currentWorkspaceId?: WorkspaceId | null }) {
  const currentWorkspaceId = options && 'currentWorkspaceId' in options ? options.currentWorkspaceId : REPO_ID
  return renderInJsdom(
    <QueryClientProvider client={primaryWindowQueryClient}>
      <AppRuntimeProjectionProvider currentWorkspaceId={currentWorkspaceId ?? null}>
        <TerminalSessionProvider>{children}</TerminalSessionProvider>
      </AppRuntimeProjectionProvider>
    </QueryClientProvider>,
  )
}

function terminalExecutionRootForTest(target: TerminalExecutionTarget): string {
  const locator = parseCanonicalWorkspaceLocator(target.kind === 'workspace-root' ? target.workspaceId : target.root)
  if (!locator) throw new Error('invalid terminal execution target fixture')
  return locator.path
}

function RegisterHost({ terminalFilesystemTargetKey }: { terminalFilesystemTargetKey: string }) {
  return <div data-terminal-filesystem-target-key={terminalFilesystemTargetKey} />
}
