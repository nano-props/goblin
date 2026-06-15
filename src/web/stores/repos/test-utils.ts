import { useReposStore } from '#/web/stores/repos/store.ts'
import { mainWindowQueryClient } from '#/web/main-window-queries.ts'
import { emptyRepo } from '#/web/stores/repos/helpers.ts'
import { disposeAllRepoRuntimes } from '#/web/stores/repos/runtime.ts'
import { setRendererBridgeForTests } from '#/web/renderer-bridge.ts'
import { ELECTRON_RENDERER_CAPABILITIES, RENDERER_BRIDGE_VERSION } from '#/shared/bootstrap.ts'
import { vi } from 'vitest'
import { stripBranchWorktreeMetadata, worktreeStatesFromBranches } from '#/web/stores/repos/worktree-state.ts'
import type {
  TerminalAttachResult,
  TerminalCatalogMutationResult,
  TerminalMutationResult,
  TerminalSessionSnapshot,
  TerminalSessionSummary,
  TerminalTakeoverResult,
} from '#/shared/terminal-types.ts'
import type { BranchSnapshotInfo, PullRequestInfo, WorktreeStatus } from '#/web/types.ts'
import type { DetailTab, RepoBranchState, RepoState } from '#/web/stores/repos/types.ts'
import {
  DEFAULT_DETAIL_COLLAPSED,
  DEFAULT_DETAIL_PANE_SIZES,
  DEFAULT_WORKSPACE_LAYOUT,
} from '#/shared/workspace-layout.ts'
export type IpcTestHandler = (input: any) => unknown

interface TerminalBridgeTestOutputs {
  'terminal.attach': TerminalAttachResult
  'terminal.restart': TerminalAttachResult
  'terminal.write': TerminalMutationResult
  'terminal.resize': TerminalMutationResult
  'terminal.takeover': TerminalTakeoverResult
  'terminal.close': TerminalMutationResult
  'terminal.create': TerminalCatalogMutationResult
  'terminal.prune': { pruned: number; remaining: number }
  'terminal.listSessions': TerminalSessionSummary[]
  'terminal.getSessionSnapshot': TerminalSessionSnapshot | null
  'terminal.reorder': TerminalMutationResult
  'terminal.notifyBell': TerminalMutationResult
}

function terminalHandlerNameForSocketAction(action: string): keyof TerminalBridgeTestOutputs | null {
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
    case 'prune':
      return 'terminal.prune'
    case 'list-sessions':
      return 'terminal.listSessions'
    case 'session-snapshot':
      return 'terminal.getSessionSnapshot'
    case 'reorder':
      return 'terminal.reorder'
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

export function resetReposStore(): void {
  disposeAllRepoRuntimes()
  mainWindowQueryClient.clear()
  useReposStore.setState({
    repos: {},
    restorableRepoCache: {},
    order: [],
    activeId: null,
    sessionReady: false,
    branchSearchQueries: {},
    detailCollapsed: DEFAULT_DETAIL_COLLAPSED,
    detailFocusMode: false,
    workspaceLayout: DEFAULT_WORKSPACE_LAYOUT,
    detailPaneSizes: DEFAULT_DETAIL_PANE_SIZES,
    selectedTerminalByWorktree: {},
  })
}

export function installGoblinTestBridge(handlers: Record<string, IpcTestHandler>): void {
  const shellOpenExternalUrl = handlers['shell.openExternalUrl'] ?? handlers['app.openExternalUrl']
  const shellOpenDirectoryDialog = handlers['shell.openDirectoryDialog'] ?? handlers['repo.openDialog']
  const shellConsumeExternalOpenPaths =
    handlers['shell.consumeExternalOpenPaths'] ?? handlers['repo.consumeExternalOpenPaths']
  const shellOpenSettingsWindow = handlers['shell.openSettingsWindow'] ?? handlers['app.openSettingsWindow']
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __GOBLIN_BOOTSTRAP__: {
        homeDir: '/Users/test',
        platform: 'web',
        initialI18n: null,
        initialSettings: null,
        initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' },
      },
      goblinNative: {
        homeDir: '/Users/test',
        platform: 'web',
        initialI18n: null,
        initialSettings: null,
        initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' },
        invokeIpc: ({ path, input }: { path: string; input?: unknown }) => {
          const handler = handlers[path]
          if (!handler) throw new Error(`Unhandled IPC path: ${path}`)
          return handler(input)
        },
        abortIpc: () => Promise.resolve(false),
        onEvent: () => () => {},
        pathForFile: () => '',
        shell: {
          openSettingsWindow: (input: unknown) =>
            shellOpenSettingsWindow ? Promise.resolve(shellOpenSettingsWindow(input)) : Promise.resolve(false),
          openExternalUrl: (input: unknown) =>
            shellOpenExternalUrl
              ? Promise.resolve(shellOpenExternalUrl(input))
              : Promise.resolve({ ok: false, message: 'error.invalid-url' }),
          openDirectoryDialog: (input: { title?: string }) => {
            const handler =
              input?.title === 'Choose Clone Destination' && handlers['repo.cloneParentDialog']
                ? handlers['repo.cloneParentDialog']
                : shellOpenDirectoryDialog
            return handler ? Promise.resolve(handler(input)) : Promise.resolve(null)
          },
          consumeExternalOpenPaths: () =>
            shellConsumeExternalOpenPaths
              ? Promise.resolve(shellConsumeExternalOpenPaths(undefined))
              : Promise.resolve([]),
          openInFinder: (input: unknown) =>
            handlers['shell.openInFinder']
              ? Promise.resolve(handlers['shell.openInFinder'](input))
              : Promise.resolve({ ok: false, message: 'error.invalid-path' }),
        },
        terminal: {
          attach: () => Promise.resolve({ ok: false, message: 'unhandled terminal attach' }),
          restart: () => Promise.resolve({ ok: false, message: 'unhandled terminal restart' }),
          write: () => Promise.resolve(true),
          resize: () => Promise.resolve(true),
          takeover: () =>
            Promise.resolve({
              ok: true as const,
              sessionId: 'session-1',
              controller: { attachmentId: 'attachment_local', status: 'connected' as const },
              canonicalCols: 80,
              canonicalRows: 24,
            }),
          close: () => Promise.resolve(true),
          create: () => Promise.resolve({ ok: false, message: 'unhandled terminal create' }),
          pruneTerminals: () => Promise.resolve({ pruned: 0, remaining: 0 }),
          onOutput: () => () => {},
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
  function callTerminalHandler(name: 'terminal.attach', payload: unknown): TerminalBridgeTestOutputs['terminal.attach']
  function callTerminalHandler(
    name: 'terminal.restart',
    payload: unknown,
  ): TerminalBridgeTestOutputs['terminal.restart']
  function callTerminalHandler(name: 'terminal.write', payload: unknown): TerminalBridgeTestOutputs['terminal.write']
  function callTerminalHandler(name: 'terminal.resize', payload: unknown): TerminalBridgeTestOutputs['terminal.resize']
  function callTerminalHandler(
    name: 'terminal.takeover',
    payload: unknown,
  ): TerminalBridgeTestOutputs['terminal.takeover']
  function callTerminalHandler(name: 'terminal.close', payload: unknown): TerminalBridgeTestOutputs['terminal.close']
  function callTerminalHandler(name: 'terminal.create', payload: unknown): TerminalBridgeTestOutputs['terminal.create']
  function callTerminalHandler(name: 'terminal.prune', payload: unknown): TerminalBridgeTestOutputs['terminal.prune']
  function callTerminalHandler(
    name: 'terminal.listSessions',
    payload: unknown,
  ): TerminalBridgeTestOutputs['terminal.listSessions']
  function callTerminalHandler(
    name: 'terminal.getSessionSnapshot',
    payload: unknown,
  ): TerminalBridgeTestOutputs['terminal.getSessionSnapshot']
  function callTerminalHandler(
    name: 'terminal.notifyBell',
    payload: unknown,
  ): TerminalBridgeTestOutputs['terminal.notifyBell']
  function callTerminalHandler(
    name: 'terminal.reorder',
    payload: unknown,
  ): TerminalBridgeTestOutputs['terminal.reorder']
  function callTerminalHandler(
    name: keyof TerminalBridgeTestOutputs,
    payload: unknown,
  ): TerminalBridgeTestOutputs[keyof TerminalBridgeTestOutputs]
  function callTerminalHandler(
    name: keyof TerminalBridgeTestOutputs,
    payload: unknown,
  ): TerminalBridgeTestOutputs[keyof TerminalBridgeTestOutputs] {
    const handler = handlers[name]
    if (!handler) {
      switch (name) {
        case 'terminal.attach':
        case 'terminal.restart':
          return { ok: false, message: `unhandled ${name}` }
        case 'terminal.write':
        case 'terminal.resize':
        case 'terminal.close':
        case 'terminal.reorder':
        case 'terminal.notifyBell':
          return true satisfies TerminalMutationResult
        case 'terminal.takeover':
          return {
            ok: true as const,
            sessionId: 'session-1',
            controller: { attachmentId: 'attachment_local', status: 'connected' as const },
            canonicalCols: 80,
            canonicalRows: 24,
          }
        case 'terminal.prune':
          return { pruned: 0, remaining: 0 }
        case 'terminal.listSessions':
          return []
        case 'terminal.getSessionSnapshot':
          return null
        case 'terminal.create': {
          const terminalKind = (payload as { kind?: string } | undefined)?.kind
          return {
            ok: true,
            action: terminalKind === 'primary' ? 'reused' : 'created',
            key: terminalKind === 'primary' ? 'repo\0worktree\0terminal-1' : 'repo\0worktree\0terminal-2',
            sessions: [],
          }
        }
      }
    }
    return handler(payload) as TerminalBridgeTestOutputs[keyof TerminalBridgeTestOutputs]
  }
  class MockWebSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    readyState = MockWebSocket.CONNECTING
    private readonly listeners = new Map<string, Set<(event: any) => void>>()

    constructor(_url: string) {
      queueMicrotask(() => {
        if (this.readyState !== MockWebSocket.CONNECTING) return
        this.readyState = MockWebSocket.OPEN
        this.emit('open', {})
      })
    }

    addEventListener(type: string, cb: (event: any) => void) {
      let listeners = this.listeners.get(type)
      if (!listeners) {
        listeners = new Set()
        this.listeners.set(type, listeners)
      }
      listeners.add(cb)
    }

    removeEventListener(type: string, cb: (event: any) => void) {
      this.listeners.get(type)?.delete(cb)
    }

    send(data: string) {
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

    close() {
      this.readyState = MockWebSocket.CLOSED
      this.emit('close', {})
    }

    private emit(type: string, event: any) {
      for (const listener of this.listeners.get(type) ?? []) listener(event)
    }
  }
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: MockWebSocket })
  setRendererBridgeForTests({
    kind: () => 'electron',
    hasCapability: () => false,
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
      initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret', clientId: 'client_testterminal' },
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
    shell: () => window.goblinNative.shell ?? null,
    terminal: () => ({
      attach: async (input) => callTerminalHandler('terminal.attach', input),
      restart: async (input) => callTerminalHandler('terminal.restart', input),
      write: async (input) => callTerminalHandler('terminal.write', input),
      resize: async (input) => callTerminalHandler('terminal.resize', input),
      takeover: async (input) => callTerminalHandler('terminal.takeover', input),
      close: async (input) => callTerminalHandler('terminal.close', input),
      create: async (input) => callTerminalHandler('terminal.create', input),
      pruneTerminals: async (repoRoot) => callTerminalHandler('terminal.prune', { repoRoot }),
      listSessions: async (input) => callTerminalHandler('terminal.listSessions', input),
      getSessionSnapshot: async (input) => callTerminalHandler('terminal.getSessionSnapshot', input),
      reorder: async (input) => callTerminalHandler('terminal.reorder', input),
      notifyBell: async (input) => callTerminalHandler('terminal.notifyBell', input),
      sendTestNotification: async () => true,
      setBadge: () => {},
      onOutput: () => () => {},
      onTitle: () => () => {},
      onExit: () => () => {},
      onOwnership: () => () => {},
      onSessionsChanged: () => () => {},
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
      const result = (() => {
        if (url.pathname === '/api/settings') return call('settings.get', undefined)
        if (url.pathname === '/api/settings/i18n') return call('i18n.get', undefined)
        if (url.pathname === '/api/settings/github-cli') {
          const hosts = url.searchParams.getAll('host')
          return call('githubCli.get', hosts.length > 0 ? { hosts } : undefined)
        }
        if (url.pathname === '/api/settings/github-cli/refresh') return call('githubCli.refresh', body)
        if (url.pathname === '/api/settings/external-apps') {
          return init?.method === 'POST' ? call('externalApps.refresh', body) : call('externalApps.get', undefined)
        }
        if (url.pathname === '/api/settings/recent-repos/add') return call('settings.addRecentRepo', body)
        if (url.pathname === '/api/settings/session') return call('settings.saveSession', body)
        if (url.pathname === '/api/settings/fetch-interval') return call('settings.setFetchInterval', body)
        if (url.pathname === '/api/settings/prefs') return call('settings.updatePrefs', body)
        if (url.pathname === '/api/remote/ssh-hosts') return call('remote.listSshHosts', undefined)
        if (url.pathname === '/api/remote/resolve-target') return call('remote.resolveTarget', body)
        if (url.pathname === '/api/remote/path-suggestions') return call('remote.listPathSuggestions', body)
        if (url.pathname === '/api/remote/test-repository') return call('remote.testRepository', body)
        if (url.pathname === '/api/repo/probe') {
          const payload: Record<string, unknown> = {}
          for (const [k, v] of url.searchParams.entries()) payload[k] = v
          return call('repo.probe', payload)
        }
        if (url.pathname === '/api/repo/snapshot') {
          const payload: Record<string, unknown> = {}
          for (const [k, v] of url.searchParams.entries()) payload[k] = v
          return call('repo.snapshot', payload)
        }
        if (url.pathname === '/api/repo/status') {
          const payload: Record<string, unknown> = {}
          for (const [k, v] of url.searchParams.entries()) payload[k] = v
          return call('repo.status', payload)
        }
        if (url.pathname === '/api/repo/remote-branches') return call('repo.remoteBranches', body)
        if (url.pathname === '/api/repo/pull-requests') {
          const payload: Record<string, unknown> = { branches: url.searchParams.getAll('branches') }
          for (const [k, v] of url.searchParams.entries()) {
            if (k !== 'branches') payload[k] = v
          }
          return call('repo.pullRequests', payload)
        }
        if (url.pathname === '/api/repo/patch') {
          const payload: Record<string, unknown> = {}
          for (const [k, v] of url.searchParams.entries()) payload[k] = v
          return call('repo.patch', payload)
        }
        if (url.pathname === '/api/repo/composite') {
          const payload: Record<string, unknown> = { include: url.searchParams.getAll('include') }
          for (const [k, v] of url.searchParams.entries()) {
            if (k !== 'include') payload[k] = v
          }
          if (url.searchParams.has('branches')) payload.branches = url.searchParams.getAll('branches')
          return call('repo.composite', payload)
        }
        if (url.pathname === '/api/repo/fetch') return call('repo.fetch', body)
        if (url.pathname === '/api/repo/clone') return call('repo.clone', body)
        if (url.pathname === '/api/repo/abort-clone') return call('repo.abortClone', body)
        if (url.pathname === '/api/repo/checkout') return call('repo.checkout', body)
        if (url.pathname === '/api/repo/pull') return call('repo.pull', body)
        if (url.pathname === '/api/repo/push') return call('repo.push', body)
        if (url.pathname === '/api/repo/create-worktree') return call('repo.createWorktree', body)
        if (url.pathname === '/api/repo/delete-branch') return call('repo.deleteBranch', body)
        if (url.pathname === '/api/repo/remove-worktree') return call('repo.removeWorktree', body)
        if (url.pathname === '/api/repo/open-remote') return call('repo.openRemote', body)
        if (url.pathname === '/api/repo/open-terminal') return call('repo.openTerminal', body)
        if (url.pathname === '/api/repo/open-editor') return call('repo.openEditor', body)
        if (url.pathname === '/api/repo/background-sync-repos') return call('repo.backgroundSyncRepos', body)
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
  setRendererBridgeForTests(null)
}

export function seedRepoState(options: {
  id: string
  name?: string
  branches?: RepoBranchState[]
  branchSnapshots?: BranchSnapshotInfo[]
  currentBranch?: string
  selectedBranch?: string | null
  detailTab?: DetailTab
  instanceToken?: number
  status?: WorktreeStatus[]
  statusLoaded?: boolean
  worktreesByPath?: RepoState['data']['worktreesByPath']
  remote?: Partial<RepoState['remote']>
}): RepoState {
  const base = emptyRepo(options.id, options.name ?? 'repo')
  const branchesWithSnapshotWorktreeMetadata = options.branchSnapshots ?? options.branches ?? base.data.branches
  const branches = options.branches ?? stripBranchWorktreeMetadata(branchesWithSnapshotWorktreeMetadata)
  const status = options.status ?? base.data.status
  const repo: RepoState = {
    ...base,
    instanceToken: options.instanceToken ?? base.instanceToken,
    data: {
      ...base.data,
      branches,
      currentBranch: options.currentBranch ?? base.data.currentBranch,
      status,
      statusLoaded: options.statusLoaded ?? base.data.statusLoaded,
      worktreesByPath:
        options.worktreesByPath ??
        worktreeStatesFromBranches(branchesWithSnapshotWorktreeMetadata, base.data.worktreesByPath, status),
    },
    ui: {
      ...base.ui,
      selectedBranch: options.selectedBranch ?? base.ui.selectedBranch,
      preferredDetailTab: options.detailTab ?? base.ui.preferredDetailTab,
    },
    remote: {
      ...base.remote,
      ...options.remote,
    },
  }
  useReposStore.setState({
    repos: { [options.id]: repo },
    restorableRepoCache: {},
    order: [options.id],
    activeId: options.id,
    sessionReady: true,
    branchSearchQueries: {},
    detailCollapsed: DEFAULT_DETAIL_COLLAPSED,
    detailFocusMode: false,
    workspaceLayout: DEFAULT_WORKSPACE_LAYOUT,
    detailPaneSizes: DEFAULT_DETAIL_PANE_SIZES,
  })
  return repo
}
