// Web IPC bridge helpers used by tests that need to simulate the
// Goblin client's interaction with the embedded server. They live
// here so non-repo tests (e.g. workspace, settings, branch actions)
// can depend on the same IPC + bridge plumbing without pulling in
// the repo store.
//
// Design choices:
//   - `handlers` is a `Record<string, IpcTestHandler>` keyed by IPC
//     pathname (`'repo.probe'`, `'repo.snapshot'`, etc.) and server
//     route (`'/api/repo/probe'`, etc.). `installGoblinTestBridge`
//     wires each pathname to the matching fetch URL.
//   - The bridge mock composes the same `goblinNative` shape the real
//     client bridge exposes, including `host`, `terminal`, `invokeIpc`,
//     and `onEvent`.
//   - `seedRepoShellForTest`, `seedRepoWithReadModelForTest`, and
//     `resetReposStore` interact with the live `useReposStore`
//     (Zustand) — they do not mock the store; they drive it. Tests
//     that need a fresh store call `resetReposStore` in `beforeEach`.

import type { RepoState, RepoBranchState } from '#/web/stores/repos/types.ts'
import { readRepoBranchQueryProjection, type RepoBranchReadModelData } from '#/web/repo-branch-read-model.ts'
import { stripBranchWorktreeMetadata } from '#/web/stores/repos/worktree-state.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'
import { disposeAllRepoOperationSchedulers } from '#/web/stores/repos/repo-operation-scheduler.ts'
import { setClientBridgeForTests } from '#/web/client-bridge.ts'
import type { ClientBridge } from '#/web/client-bridge-types.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import {
  readWorkspacePaneTabsForTarget,
  setWorkspacePaneTabsForTargetQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import { setRepoSnapshotQueryData, setRepoStatusQueryData } from '#/web/repo-data-query.ts'
import {
  workspacePaneTabsWithStaticTab,
  workspacePaneTabsWithoutStaticTab,
} from '#/web/workspace-pane/workspace-pane-tabs.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import { workspacePaneTabEntryIdentity } from '#/shared/workspace-pane.ts'
import { ELECTRON_CLIENT_CAPABILITIES, CLIENT_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { DEFAULT_ZEN_MODE, DEFAULT_WORKSPACE_PANE_SIZE } from '#/shared/workspace-layout.ts'
import type {
  TerminalAttachResult,
  TerminalCreateResult,
  TerminalListWorkspaceTabsInput,
  TerminalReplaceWorkspaceTabsInput,
  TerminalMutationResult,
  TerminalSessionSummary,
  TerminalUpdateWorkspaceTabsInput,
  WorkspacePaneTabsEntry,
  TerminalTakeoverResult,
} from '#/shared/terminal-types.ts'
import type { WorkspacePaneTabEntry, WorkspacePaneTabType } from '#/shared/workspace-pane.ts'
import type { BranchSnapshotInfo, PullRequestInfo, WorktreeStatus } from '#/web/types.ts'
import { vi } from 'vitest'
import { installWebSocketMock } from '#/web/test-utils/websocket-mock.ts'
import { createOpaqueId } from '#/shared/opaque-id.ts'

export type IpcTestHandler = (input: any) => unknown
export type RepoPresentationForTest = RepoState & { branchModel: RepoBranchReadModelData }

export function repoPresentationForTest(
  repo: RepoState,
  branchReadModel: RepoBranchReadModelData,
): RepoPresentationForTest {
  return {
    ...repo,
    branchModel: branchReadModel,
  }
}

export function repoPresentationFromQueryForTest(repo: RepoState): RepoPresentationForTest {
  const readModel = readRepoBranchQueryProjection(repo)
  if (!readModel) throw new Error(`missing branch read model for test repo: ${repo.id}`)
  return {
    ...repo,
    branchModel: readModel,
  }
}

export function seedRepoShellForTest(options: {
  id: string
  name?: string
  currentBranchName?: string | null
  preferredWorkspacePaneTabByTarget?: Record<string, WorkspacePaneTabType>
  instanceId?: string
  remote?: Partial<RepoState['remote']>
}): RepoState {
  const base = emptyRepo(options.id, options.name ?? 'repo', options.instanceId ?? createOpaqueId('repo-instance'))
  const repo: RepoState = {
    ...base,
    ui: {
      ...base.ui,
      preferredWorkspacePaneTabByTarget:
        options.preferredWorkspacePaneTabByTarget ?? base.ui.preferredWorkspacePaneTabByTarget,
    },
    remote: {
      ...base.remote,
      ...options.remote,
    },
  }
  useReposStore.setState({
    repos: { [options.id]: repo },
    repoSnapshotCache: {},
    order: [options.id],
    restoredRepoId: options.id,
    workspaceMembershipReady: true,
    sessionPersistenceReady: true,
    sessionRestoreError: null,
    zenMode: DEFAULT_ZEN_MODE,
    workspacePaneSize: DEFAULT_WORKSPACE_PANE_SIZE,
  })
  return repo
}

interface TerminalClientTestOutputs {
  'terminal.attach': TerminalAttachResult
  'terminal.restart': TerminalAttachResult
  'terminal.write': TerminalMutationResult
  'terminal.resize': TerminalMutationResult
  'terminal.takeover': TerminalTakeoverResult
  'terminal.close': TerminalMutationResult
  'terminal.create': TerminalCreateResult
  'terminal.replaceWorkspaceTabs': WorkspacePaneTabEntry[]
  'terminal.updateWorkspaceTabs': WorkspacePaneTabEntry[]
  'terminal.listWorkspaceTabs': WorkspacePaneTabsEntry[]
  'terminal.prune': { pruned: number; remaining: number }
  'terminal.listSessions': TerminalSessionSummary[]
  'terminal.notifyBell': TerminalMutationResult
}

function terminalHandlerNameForSocketAction(action: string): keyof TerminalClientTestOutputs | null {
  switch (action) {
    case 'attach':
      return 'terminal.attach'
    case 'restart':
      return 'terminal.restart'
    case 'write':
      return 'terminal.write'
    case 'resize':
      return 'terminal.resize'
    case 'takeover':
      return 'terminal.takeover'
    case 'close':
      return 'terminal.close'
    case 'create':
      return 'terminal.create'
    case 'replace-tabs':
      return 'terminal.replaceWorkspaceTabs'
    case 'update-tabs':
      return 'terminal.updateWorkspaceTabs'
    case 'list-workspace-tabs':
      return 'terminal.listWorkspaceTabs'
    case 'prune':
      return 'terminal.prune'
    case 'list-sessions':
      return 'terminal.listSessions'
    default:
      return null
  }
}

export function createBranchSnapshot(name: string, options: Partial<BranchSnapshotInfo> = {}): BranchSnapshotInfo {
  return {
    name,
    isCurrent: false,
    ahead: 0,
    behind: 0,
    lastCommitHash: '',
    lastCommitShortHash: '',
    lastCommitMessage: '',
    lastCommitDate: '',
    lastCommitAuthor: '',
    ...options,
  }
}

export function createRepoBranch(name: string, options: Partial<RepoBranchState> = {}): RepoBranchState {
  return stripBranchWorktreeMetadata([createBranchSnapshot(name, options)])[0]!
}

export function createPullRequest(number: number, options: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/acme/repo/pull/${number}`,
    state: 'open',
    ...options,
  }
}

export function installWorkspacePaneTabsTestBridge(
  options: {
    replaceWorkspaceTabs?: (
      input: TerminalReplaceWorkspaceTabsInput,
    ) => WorkspacePaneTabEntry[] | Promise<WorkspacePaneTabEntry[]>
    updateWorkspaceTabs?: (
      input: TerminalUpdateWorkspaceTabsInput,
    ) => WorkspacePaneTabEntry[] | Promise<WorkspacePaneTabEntry[]>
    listWorkspaceTabs?: (
      input: TerminalListWorkspaceTabsInput,
    ) => WorkspacePaneTabsEntry[] | Promise<WorkspacePaneTabsEntry[]>
  } = {},
): void {
  setClientBridgeForTests({
    kind: () => 'web',
    hasCapability: () => false,
    getBootstrap: () => ({
      runtime: {
        kind: 'web',
        bridgeVersion: CLIENT_BRIDGE_VERSION,
        capabilities: [],
      },
      homeDir: '/Users/test',
      platform: 'web',
      initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
    }),
    invokeIpc: async ({ path }) => {
      throw new Error(`Unhandled IPC path: ${path}`)
    },
    abortIpc: async () => false,
    onIpcEvent: () => () => {},
    onEffectIntent: () => () => {},
    pathForFile: () => '',
    saveClipboardFiles: async () => [],
    host: () => null,
    terminal: () => ({
      attach: async () => ({ ok: false, message: 'unhandled terminal attach' }),
      restart: async () => ({ ok: false, message: 'unhandled terminal restart' }),
      write: async () => true,
      resize: async () => true,
      takeover: async () => ({
        ok: true as const,
        terminalRuntimeSessionId: 'pty_test_aaaaaaaaa',
        role: 'controller' as const,
        controllerStatus: 'connected' as const,
        controller: { clientId: 'attachment_local', status: 'connected' as const },
        canonicalCols: 80,
        canonicalRows: 24,
        phase: 'open' as const,
      }),
      close: async () => true,
      create: async () => ({
        ok: true as const,
        action: 'created' as const,
        terminalSessionId: 'terminal-session-test-1',
        tabs: [],
        sessions: [],
        terminalRuntimeSessionId: 'pty_test_aaaaaaaaa',
        snapshot: '',
        snapshotSeq: 0,
        processName: 'zsh',
        canonicalTitle: null,
        phase: 'open' as const,
        message: null,
        controller: { clientId: 'attachment_local', status: 'connected' as const },
        canonicalCols: 80,
        canonicalRows: 24,
      }),
      replaceWorkspaceTabs: async (input) => {
        if (options.replaceWorkspaceTabs) return await options.replaceWorkspaceTabs(input)
        return [...input.tabs]
      },
      updateWorkspaceTabs: async (input) => {
        if (options.updateWorkspaceTabs) return await options.updateWorkspaceTabs(input)
        return defaultWorkspacePaneTabsOperationResult(input)
      },
      listWorkspaceTabs: async (input) => {
        if (options.listWorkspaceTabs) return await options.listWorkspaceTabs(input)
        return []
      },
      pruneTerminals: async () => ({ pruned: 0, remaining: 0 }),
      listSessions: async () => [],
      prewarm: async () => {},
      kickReconnect: () => {},
      notifyBell: async () => true,
      sendTestNotification: async () => true,
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
  } satisfies ClientBridge)
}

function defaultWorkspacePaneTabsOperationResult(input: TerminalUpdateWorkspaceTabsInput): WorkspacePaneTabEntry[] {
  const currentTabs = readWorkspacePaneTabsForTarget(input)
  switch (input.operation.type) {
    case 'open-static':
      return workspacePaneTabsWithStaticTab(currentTabs, input.operation.tabType, {
        insertAfterIdentity: input.operation.insertAfterIdentity,
      })
    case 'close-static':
      return workspacePaneTabsWithoutStaticTab(currentTabs, input.operation.tabType)
    case 'reorder':
      return workspacePaneTabsWithIdentityOrder(currentTabs, input.operation.tabIdentities)
  }
}

function isTerminalUpdateWorkspaceTabsInput(value: unknown): value is TerminalUpdateWorkspaceTabsInput {
  if (!value || typeof value !== 'object') return false
  const input = value as { repoRoot?: unknown; branchName?: unknown; worktreePath?: unknown; operation?: unknown }
  return (
    typeof input.repoRoot === 'string' &&
    typeof input.branchName === 'string' &&
    (typeof input.worktreePath === 'string' || input.worktreePath === null) &&
    !!input.operation &&
    typeof input.operation === 'object'
  )
}

function workspacePaneTabsWithIdentityOrder(
  currentTabs: readonly WorkspacePaneTabEntry[],
  tabIdentities: readonly string[],
): WorkspacePaneTabEntry[] {
  const tabByIdentity = new Map(currentTabs.map((tab) => [workspacePaneTabEntryIdentity(tab), tab]))
  const used = new Set<string>()
  const ordered: WorkspacePaneTabEntry[] = []
  for (const identity of tabIdentities) {
    const tab = tabByIdentity.get(identity)
    if (!tab || used.has(identity)) continue
    used.add(identity)
    ordered.push(tab)
  }
  for (const tab of currentTabs) {
    const identity = workspacePaneTabEntryIdentity(tab)
    if (used.has(identity)) continue
    used.add(identity)
    ordered.push(tab)
  }
  return ordered
}

export function resetReposStore(): void {
  disposeAllRepoOperationSchedulers()
  primaryWindowQueryClient.clear()
  useReposStore.setState({
    repos: {},
    repoSnapshotCache: {},
    order: [],
    restoredRepoId: null,
    workspaceMembershipReady: false,
    sessionPersistenceReady: false,
    sessionRestoreError: null,
    zenMode: DEFAULT_ZEN_MODE,
    workspacePaneSize: DEFAULT_WORKSPACE_PANE_SIZE,
    selectedTerminalSessionIdByTerminalWorktree: {},
    tabOpenerIdentityByScope: {},
  })
}

export function installGoblinTestBridge(handlers: Record<string, IpcTestHandler>): void {
  const repoRuntimeState = new Map<string, { currentInstanceId: string | null }>()
  const hostOpenExternalUrl = handlers['app.openExternalUrl']
  const hostOpenDirectoryDialog = handlers['repo.openDialog']
  const hostConsumeExternalOpenPaths = handlers['repo.consumeExternalOpenPaths']
  const hostOpenSettingsWindow = handlers['app.openSettingsWindow']
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __GOBLIN_BOOTSTRAP__: {
        homeDir: '/Users/test',
        platform: 'web',
        initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
      },
      goblinNative: {
        homeDir: '/Users/test',
        platform: 'web',
        initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
        invokeIpc: ({ path, input }: { path: string; input?: unknown }) => {
          const handler = handlers[path]
          if (!handler) throw new Error(`Unhandled IPC path: ${path}`)
          return handler(input)
        },
        abortIpc: () => Promise.resolve(false),
        onEvent: () => () => {},
        pathForFile: () => '',
        host: {
          openSettingsWindow: (input: unknown) =>
            hostOpenSettingsWindow ? Promise.resolve(hostOpenSettingsWindow(input)) : Promise.resolve(false),
          openExternalUrl: (input: unknown) =>
            hostOpenExternalUrl
              ? Promise.resolve(hostOpenExternalUrl(input))
              : Promise.resolve({ ok: false, message: 'error.invalid-url' }),
          openDirectoryDialog: (input: { title?: string }) => {
            const handler =
              input?.title === 'Choose Clone Destination' && handlers['repo.cloneParentDialog']
                ? handlers['repo.cloneParentDialog']
                : hostOpenDirectoryDialog
            return handler ? Promise.resolve(handler(input)) : Promise.resolve(null)
          },
          consumeExternalOpenPaths: () =>
            hostConsumeExternalOpenPaths
              ? Promise.resolve(hostConsumeExternalOpenPaths(undefined))
              : Promise.resolve([]),
        },
        terminal: {
          attach: () => Promise.resolve({ ok: false, message: 'unhandled terminal attach' }),
          restart: () => Promise.resolve({ ok: false, message: 'unhandled terminal restart' }),
          write: () => Promise.resolve(true),
          resize: () => Promise.resolve(true),
          takeover: () =>
            Promise.resolve({
              ok: true as const,
              terminalRuntimeSessionId: 'pty_test_aaaaaaaaa',
              controller: { clientId: 'attachment_local', status: 'connected' as const },
            }),
          close: () => Promise.resolve(true),
          create: () => Promise.resolve({ ok: false, message: 'unhandled terminal create' }),
          pruneTerminals: () => Promise.resolve({ pruned: 0, remaining: 0 }),
          onOutput: () => () => {},
          onBell: () => () => {},
          onExit: () => () => {},
        },
      },
      location: {
        href: 'http://127.0.0.1:32100/',
        origin: 'http://127.0.0.1:32100',
        search: '',
      },
    },
  })
  function callTerminalHandler(name: 'terminal.attach', payload: unknown): TerminalClientTestOutputs['terminal.attach']
  function callTerminalHandler(
    name: 'terminal.restart',
    payload: unknown,
  ): TerminalClientTestOutputs['terminal.restart']
  function callTerminalHandler(name: 'terminal.write', payload: unknown): TerminalClientTestOutputs['terminal.write']
  function callTerminalHandler(name: 'terminal.resize', payload: unknown): TerminalClientTestOutputs['terminal.resize']
  function callTerminalHandler(
    name: 'terminal.takeover',
    payload: unknown,
  ): TerminalClientTestOutputs['terminal.takeover']
  function callTerminalHandler(name: 'terminal.close', payload: unknown): TerminalClientTestOutputs['terminal.close']
  function callTerminalHandler(name: 'terminal.create', payload: unknown): TerminalClientTestOutputs['terminal.create']
  function callTerminalHandler(
    name: 'terminal.replaceWorkspaceTabs',
    payload: unknown,
  ): TerminalClientTestOutputs['terminal.replaceWorkspaceTabs']
  function callTerminalHandler(
    name: 'terminal.updateWorkspaceTabs',
    payload: unknown,
  ): TerminalClientTestOutputs['terminal.updateWorkspaceTabs']
  function callTerminalHandler(
    name: 'terminal.listWorkspaceTabs',
    payload: unknown,
  ): TerminalClientTestOutputs['terminal.listWorkspaceTabs']
  function callTerminalHandler(name: 'terminal.prune', payload: unknown): TerminalClientTestOutputs['terminal.prune']
  function callTerminalHandler(
    name: 'terminal.listSessions',
    payload: unknown,
  ): TerminalClientTestOutputs['terminal.listSessions']
  function callTerminalHandler(
    name: 'terminal.notifyBell',
    payload: unknown,
  ): TerminalClientTestOutputs['terminal.notifyBell']
  function callTerminalHandler(
    name: keyof TerminalClientTestOutputs,
    payload: unknown,
  ): TerminalClientTestOutputs[keyof TerminalClientTestOutputs]
  function callTerminalHandler(
    name: keyof TerminalClientTestOutputs,
    payload: unknown,
  ): TerminalClientTestOutputs[keyof TerminalClientTestOutputs] {
    const handler = handlers[name]
    if (!handler) {
      switch (name) {
        case 'terminal.attach':
        case 'terminal.restart':
          return { ok: false, message: `unhandled ${name}` }
        case 'terminal.write':
        case 'terminal.resize':
        case 'terminal.close':
        case 'terminal.notifyBell':
          return true satisfies TerminalMutationResult
        case 'terminal.takeover':
          return {
            ok: true as const,
            terminalRuntimeSessionId: 'pty_test_aaaaaaaaa',
            role: 'controller' as const,
            controllerStatus: 'connected' as const,
            controller: { clientId: 'attachment_local', status: 'connected' as const },
            canonicalCols: 80,
            canonicalRows: 24,
            phase: 'open' as const,
          }
        case 'terminal.prune':
          return { pruned: 0, remaining: 0 }
        case 'terminal.replaceWorkspaceTabs':
          return Array.isArray((payload as { tabs?: unknown } | undefined)?.tabs)
            ? ([...(payload as { tabs: WorkspacePaneTabEntry[] }).tabs] satisfies WorkspacePaneTabEntry[])
            : []
        case 'terminal.updateWorkspaceTabs':
          return isTerminalUpdateWorkspaceTabsInput(payload) ? defaultWorkspacePaneTabsOperationResult(payload) : []
        case 'terminal.listWorkspaceTabs':
          return []
        case 'terminal.listSessions':
          return []
        case 'terminal.create': {
          const terminalKind = (payload as { kind?: string } | undefined)?.kind
          const terminalRuntimeSessionId = terminalKind === 'primary' ? 'pty_test_1_aaaaaaaaa' : 'pty_test_2_aaaaaaaaa'
          return {
            ok: true,
            action: terminalKind === 'primary' ? 'reused' : 'created',
            terminalSessionId: terminalKind === 'primary' ? 'terminal-session-test-1' : 'terminal-session-test-2',
            tabs: [],
            sessions: [],
            terminalRuntimeSessionId,
            snapshot: '',
            snapshotSeq: 0,
            processName: 'zsh',
            canonicalTitle: null,
            phase: 'open',
            message: null,
            controller: { clientId: 'attachment_local', status: 'connected' },
            canonicalCols: 80,
            canonicalRows: 24,
          }
        }
      }
    }
    return handler(payload) as TerminalClientTestOutputs[keyof TerminalClientTestOutputs]
  }
  // Use the shared `installWebSocketMock` for the WebSocket surface and
  // wrap each new socket's `send` so JSON `request` frames are routed to
  // the matching terminal handler and the response is emitted back over
  // the same socket. This keeps one canonical `MockWebSocket` shape
  // across `src/web/test-utils/`, instead of a second inline copy.
  const socketMock = installWebSocketMock({ autoOpen: true })
  const OriginalSend = socketMock.MockWebSocket.prototype.send
  socketMock.MockWebSocket.prototype.send = function patchedSend(
    this: InstanceType<typeof socketMock.MockWebSocket>,
    data: string,
  ) {
    OriginalSend.call(this, data)
    let parsed: { type?: string; requestId?: string; action?: string; input?: unknown } | null = null
    try {
      parsed = JSON.parse(data)
    } catch {
      return
    }
    if (parsed?.type !== 'request' || !parsed.requestId || typeof parsed.action !== 'string') return
    const handlerName = terminalHandlerNameForSocketAction(parsed.action)
    if (!handlerName) return
    Promise.resolve()
      .then(() => callTerminalHandler(handlerName, parsed.input))
      .then(
        (payload) => {
          this.emit('message', {
            data: JSON.stringify({
              type: 'response',
              requestId: parsed?.requestId,
              ok: true,
              action: parsed?.action,
              payload,
            }),
          })
        },
        (error) => {
          this.emit('message', {
            data: JSON.stringify({
              type: 'response',
              requestId: parsed?.requestId,
              ok: false,
              action: parsed?.action,
              error: error instanceof Error ? error.message : String(error),
            }),
          })
        },
      )
  }
  setClientBridgeForTests({
    kind: () => 'electron',
    hasCapability: () => false,
    getBootstrap: () => ({
      runtime: {
        kind: 'electron',
        bridgeVersion: CLIENT_BRIDGE_VERSION,
        capabilities: [...ELECTRON_CLIENT_CAPABILITIES],
      },
      homeDir: '/Users/test',
      platform: 'web',
      initialServer: { url: 'http://127.0.0.1:32100/', accessToken: 'secret' },
    }),
    invokeIpc: async ({ path, input }: { path: string; input?: unknown }) => {
      const handler = handlers[path]
      if (!handler) throw new Error(`Unhandled IPC path: ${path}`)
      return handler(input)
    },
    abortIpc: async () => false,
    onIpcEvent: () => () => {},
    onEffectIntent: () => () => {},
    pathForFile: () => '',
    saveClipboardFiles: () => Promise.resolve([]),
    host: () => window.goblinNative.host ?? null,
    terminal: () => ({
      attach: async (input) => callTerminalHandler('terminal.attach', input),
      restart: async (input) => callTerminalHandler('terminal.restart', input),
      write: async (input) => callTerminalHandler('terminal.write', input),
      resize: async (input) => callTerminalHandler('terminal.resize', input),
      takeover: async (input) => callTerminalHandler('terminal.takeover', input),
      close: async (input) => callTerminalHandler('terminal.close', input),
      create: async (input) => callTerminalHandler('terminal.create', input),
      replaceWorkspaceTabs: async (input) => callTerminalHandler('terminal.replaceWorkspaceTabs', input),
      updateWorkspaceTabs: async (input) => callTerminalHandler('terminal.updateWorkspaceTabs', input),
      listWorkspaceTabs: async (input) => callTerminalHandler('terminal.listWorkspaceTabs', input),
      pruneTerminals: async (repoRoot) => callTerminalHandler('terminal.prune', { repoRoot }),
      listSessions: async (input) => callTerminalHandler('terminal.listSessions', input),
      prewarm: async () => {},
      kickReconnect: () => {},
      notifyBell: async (input) => callTerminalHandler('terminal.notifyBell', input),
      sendTestNotification: async () => true,
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
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      const body =
        typeof init?.body === 'string' && init.body.length > 0 ? (JSON.parse(init.body) as Record<string, unknown>) : {}
      const call = (name: string, payload: unknown) => {
        const handler = handlers[name]
        if (!handler) {
          throw new Error(`Unhandled server route: ${name}`)
        }
        return handler(payload)
      }
      const openRepoRuntime = async (payload: unknown) => {
        const repoRoot = typeof payload === 'object' && payload && 'repoRoot' in payload ? payload.repoRoot : null
        const repoInput = typeof payload === 'object' && payload && 'repoInput' in payload ? payload.repoInput : null
        if (typeof repoInput === 'string' && repoInput.length > 0) {
          const probe = (await call('repo.probe', { cwd: repoInput })) as {
            ok: boolean
            root?: string
            name?: string
            message?: string
          }
          if (!probe.ok || !probe.root) {
            return { ok: false as const, input: repoInput, reason: probe.message ?? 'error.not-git-repo' }
          }
          const state = repoRuntimeState.get(probe.root) ?? { currentInstanceId: null }
          if (!state.currentInstanceId) state.currentInstanceId = createOpaqueId('repo-instance')
          repoRuntimeState.set(probe.root, state)
          return {
            ok: true as const,
            repo: { id: probe.root, name: probe.name ?? probe.root.split('/').at(-1) ?? probe.root },
            repoInstanceId: state.currentInstanceId,
          }
        }
        if (typeof repoRoot !== 'string' || repoRoot.length === 0) throw new Error('runtime-open requires repoRoot')
        const state = repoRuntimeState.get(repoRoot) ?? { currentInstanceId: null }
        const repoInstanceId = createOpaqueId('repo-instance')
        state.currentInstanceId = repoInstanceId
        repoRuntimeState.set(repoRoot, state)
        return { ok: true as const, repoInstanceId }
      }
      const closeRepoRuntime = (payload: unknown) => {
        const repoRoot = typeof payload === 'object' && payload && 'repoRoot' in payload ? payload.repoRoot : null
        const repoInstanceId =
          typeof payload === 'object' && payload && 'repoInstanceId' in payload ? payload.repoInstanceId : null
        if (typeof repoRoot !== 'string' || typeof repoInstanceId !== 'string') {
          throw new Error('runtime-close requires repoRoot and repoInstanceId')
        }
        const state = repoRuntimeState.get(repoRoot)
        const closed = !!state && state.currentInstanceId === repoInstanceId
        if (closed && state) state.currentInstanceId = null
        return { ok: true as const, closed }
      }
      const listRepoRuntime = () => ({
        instances: Array.from(repoRuntimeState.entries()).flatMap(([repoRoot, state]) =>
          state.currentInstanceId ? [{ repoRoot, repoInstanceId: state.currentInstanceId }] : [],
        ),
      })
      const result = (() => {
        if (url.pathname === '/api/settings') return call('settings.get', undefined)
        if (url.pathname === '/api/i18n') return call('i18n.get', undefined)
        if (url.pathname === '/api/settings/github-cli') return call('githubCli.get', body)
        if (url.pathname === '/api/settings/github-cli/refresh') return call('githubCli.refresh', body)
        if (url.pathname === '/api/settings/external-apps') {
          return init?.method === 'POST' ? call('externalApps.refresh', body) : call('externalApps.get', undefined)
        }
        if (url.pathname === '/api/settings/recent-repos/add') return call('settings.addRecentRepo', body)
        if (url.pathname === '/api/settings/session') return call('settings.saveSession', body)
        if (url.pathname === '/api/settings/fetch-interval') return call('settings.setFetchInterval', body)
        if (url.pathname === '/api/settings/prefs') return call('settings.updateUserSettings', body)
        if (url.pathname === '/api/remote/ssh-hosts') return call('remote.listSshHosts', undefined)
        if (url.pathname === '/api/remote/resolve-target') return call('remote.resolveTarget', body)
        if (url.pathname === '/api/remote/lifecycle') return call('remote.lifecycle', body)
        if (url.pathname === '/api/remote/path-suggestions') return call('remote.listPathSuggestions', body)
        if (url.pathname === '/api/remote/test-repo') return call('remote.testRepo', body)
        if (url.pathname === '/api/repo/probe') return call('repo.probe', body)
        if (url.pathname === '/api/repo/snapshot') return call('repo.snapshot', body)
        if (url.pathname === '/api/repo/status') return call('repo.status', body)
        if (url.pathname === '/api/repo/log') return call('repo.log', body)
        if (url.pathname === '/api/repo/remote-branches') return call('repo.remoteBranches', body)
        if (url.pathname === '/api/repo/pull-requests') return call('repo.pullRequests', body)
        if (url.pathname === '/api/repo/patch') return call('repo.patch', body)
        if (url.pathname === '/api/repo/composite') return call('repo.composite', body)
        if (url.pathname === '/api/repo/fetch') return call('repo.fetch', body)
        if (url.pathname === '/api/repo/clone') return call('repo.clone', body)
        if (url.pathname === '/api/repo/abort-clone') return call('repo.abortClone', body)
        if (url.pathname === '/api/repo/pull') return call('repo.pull', body)
        if (url.pathname === '/api/repo/push') return call('repo.push', body)
        if (url.pathname === '/api/repo/create-worktree') return call('repo.createWorktree', body)
        if (url.pathname === '/api/repo/worktree-bootstrap-preview') return call('repo.worktreeBootstrapPreview', body)
        if (url.pathname === '/api/repo/delete-branch') return call('repo.deleteBranch', body)
        if (url.pathname === '/api/repo/remove-worktree') return call('repo.removeWorktree', body)
        if (url.pathname === '/api/repo/open-url') return call('repo.openUrl', body)
        if (url.pathname === '/api/repo/open-terminal') return call('repo.openTerminal', body)
        if (url.pathname === '/api/repo/open-editor') return call('repo.openEditor', body)
        if (url.pathname === '/api/repo/background-sync-repos') return call('repo.backgroundSyncRepos', body)
        if (url.pathname === '/api/repo/runtime-open') {
          return handlers['repo.runtimeOpen'] ? call('repo.runtimeOpen', body) : openRepoRuntime(body)
        }
        if (url.pathname === '/api/repo/runtime-list') {
          return handlers['repo.runtimeList'] ? call('repo.runtimeList', body) : listRepoRuntime()
        }
        if (url.pathname === '/api/repo/runtime-close') {
          return handlers['repo.runtimeClose'] ? call('repo.runtimeClose', body) : closeRepoRuntime(body)
        }
        if (url.pathname === '/api/repo/abort') return call('repo.abort', body)
        throw new Error(`Unhandled fetch URL: ${url.pathname}`)
      })()
      const abortError = () => {
        if (typeof DOMException !== 'undefined') return new DOMException('The operation was aborted.', 'AbortError')
        const err = new Error('The operation was aborted.')
        err.name = 'AbortError'
        return err
      }
      const withAbort = async <T>(value: T | Promise<T>): Promise<T> => {
        const signal = init?.signal
        if (!signal) return await value
        if (signal.aborted) throw abortError()
        return await new Promise<T>((resolve, reject) => {
          const onAbort = () => {
            signal.removeEventListener('abort', onAbort)
            reject(abortError())
          }
          signal.addEventListener('abort', onAbort, { once: true })
          Promise.resolve(value).then(
            (resolved) => {
              signal.removeEventListener('abort', onAbort)
              resolve(resolved)
            },
            (err) => {
              signal.removeEventListener('abort', onAbort)
              reject(err)
            },
          )
        })
      }
      return {
        ok: true,
        json: async () => await withAbort(result),
      }
    }),
  )
  setClientBridgeForTests(null)
}

export function seedRepoWithReadModelForTest(options: {
  id: string
  name?: string
  branches?: RepoBranchState[]
  branchSnapshots?: BranchSnapshotInfo[]
  currentBranch?: string
  currentBranchName?: string | null
  preferredWorkspacePaneTab?: WorkspacePaneTabType
  preferredWorkspacePaneTabByTarget?: Record<string, WorkspacePaneTabType>
  workspacePaneTabsByBranch?: Record<string, WorkspacePaneTabEntry[]>
  instanceId?: string
  status?: WorktreeStatus[]
  remote?: Partial<RepoState['remote']>
}): RepoState {
  const branchesWithSnapshotWorktreeMetadata = options.branchSnapshots ?? options.branches ?? []
  const branches = options.branches ?? stripBranchWorktreeMetadata(branchesWithSnapshotWorktreeMetadata)
  const status = options.status ?? []
  const currentBranchName = options.currentBranchName ?? null
  const preferredWorkspacePaneTabByTarget =
    options.preferredWorkspacePaneTabByTarget ??
    (currentBranchName && options.preferredWorkspacePaneTab !== undefined
      ? {
          [workspacePaneTabsTargetIdentityKey({
            repoRoot: options.id,
            branchName: currentBranchName,
            worktreePath: branches.find((branch) => branch.name === currentBranchName)?.worktree?.path ?? null,
          })]: options.preferredWorkspacePaneTab,
        }
      : undefined)
  const repo = seedRepoShellForTest({
    id: options.id,
    name: options.name,
    instanceId: options.instanceId,
    currentBranchName,
    ...(preferredWorkspacePaneTabByTarget ? { preferredWorkspacePaneTabByTarget } : {}),
    remote: options.remote,
  })
  seedRepoReadModelQueryData(repo, {
    branches: branchesWithSnapshotWorktreeMetadata,
    currentBranch: options.currentBranch ?? '',
    status,
  })
  for (const [branchName, tabs] of Object.entries(options.workspacePaneTabsByBranch ?? {})) {
    const branch = branches.find((candidate) => candidate.name === branchName)
    if (!branch) continue
    setWorkspacePaneTabsForTargetQueryData({
      repoRoot: options.id,
      repoInstanceId: repo.instanceId,
      branchName,
      worktreePath: branch.worktree?.path ?? null,
      tabs,
    })
  }
  return repo
}

export function seedRepoReadModelQueryData(
  repo: Pick<RepoState, 'id' | 'instanceId'>,
  readModel: {
    branches: BranchSnapshotInfo[]
    currentBranch: string
    status?: WorktreeStatus[]
  },
): void {
  setRepoSnapshotQueryData(repo.id, repo.instanceId, {
    branches: readModel.branches,
    current: readModel.currentBranch,
  })
  setRepoStatusQueryData(repo.id, repo.instanceId, readModel.status ?? [])
}
