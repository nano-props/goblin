import { useReposStore } from '#/web/stores/repos/store.ts'
import { mainWindowQueryClient } from '#/web/main-window-queries.ts'
import { emptyRepo } from '#/web/stores/repos/helpers.ts'
import { disposeAllRepoRuntimes } from '#/web/stores/repos/runtime.ts'
import { setRendererBridgeForTests } from '#/web/renderer-bridge.ts'
import { vi } from 'vitest'
import { stripBranchWorktreeMetadata, worktreeStatesFromBranches } from '#/web/stores/repos/worktree-state.ts'
import type { BranchSnapshotInfo, PullRequestInfo, WorktreeStatus } from '#/web/types.ts'
import type { DetailTab, RepoBranchState, RepoState } from '#/web/stores/repos/types.ts'
import {
  DEFAULT_DETAIL_COLLAPSED,
  DEFAULT_DETAIL_PANE_SIZES,
  DEFAULT_WORKSPACE_LAYOUT,
} from '#/shared/workspace-layout.ts'
export type RpcTestHandler = (input: any) => unknown

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
    repoCache: {},
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

export function installGoblinTestBridge(handlers: Record<string, RpcTestHandler>): void {
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
        initialI18n: null,
        initialSettings: null,
        initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' },
      },
      goblin: {
        homeDir: '/Users/test',
        initialI18n: null,
        initialSettings: null,
        initialServer: { url: 'http://127.0.0.1:32100/', secret: 'secret' },
        invokeRpc: ({ path, input }: { path: string; input?: unknown }) => {
          const handler = handlers[path]
          if (!handler) throw new Error(`Unhandled RPC path: ${path}`)
          return handler(input)
        },
        abortRpc: () => Promise.resolve(false),
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
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString())
      const body =
        typeof init?.body === 'string' && init.body.length > 0 ? (JSON.parse(init.body) as Record<string, unknown>) : {}
      const call = (name: string, payload: unknown) => {
        const handler = handlers[name]
        if (!handler) {
          if (name === 'terminal.attach' || name === 'terminal.restart') {
            return { ok: false, message: `unhandled ${name}` }
          }
          if (
            name === 'terminal.write' ||
            name === 'terminal.resize' ||
            name === 'terminal.takeover' ||
            name === 'terminal.close' ||
            name === 'terminal.prune' ||
            name === 'terminal.notifyBell'
          ) {
            return true
          }
          if (name === 'terminal.create') {
            const terminalKind = (payload as { kind?: string } | undefined)?.kind
            return {
              ok: true,
              action: terminalKind === 'primary' ? 'reused' : 'created',
              key: terminalKind === 'primary' ? 'repo\0worktree\0terminal-1' : 'repo\0worktree\0terminal-2',
              sessions: [],
            }
          }
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
        if (url.pathname === '/api/repo/probe') return call('repo.probe', body)
        if (url.pathname === '/api/repo/snapshot') return call('repo.snapshot', body)
        if (url.pathname === '/api/repo/status') return call('repo.status', body)
        if (url.pathname === '/api/repo/pull-requests') return call('repo.pullRequests', body)
        if (url.pathname === '/api/repo/fetch') return call('repo.fetch', body)
        if (url.pathname === '/api/repo/clone') return call('repo.clone', body)
        if (url.pathname === '/api/repo/abort-clone') return call('repo.abortClone', body)
        if (url.pathname === '/api/repo/checkout') return call('repo.checkout', body)
        if (url.pathname === '/api/repo/pull') return call('repo.pull', body)
        if (url.pathname === '/api/repo/push') return call('repo.push', body)
        if (url.pathname === '/api/repo/create-worktree') return call('repo.createWorktree', body)
        if (url.pathname === '/api/repo/delete-branch') return call('repo.deleteBranch', body)
        if (url.pathname === '/api/repo/remove-worktree') return call('repo.removeWorktree', body)
        if (url.pathname === '/api/repo/patch') return call('repo.patch', body)
        if (url.pathname === '/api/repo/open-remote') return call('repo.openRemote', body)
        if (url.pathname === '/api/repo/open-terminal') return call('repo.openTerminal', body)
        if (url.pathname === '/api/repo/open-editor') return call('repo.openEditor', body)
        if (url.pathname === '/api/repo/background-sync-repos') return call('repo.backgroundSyncRepos', body)
        if (url.pathname === '/api/repo/abort') return call('repo.abort', body)
        if (url.pathname === '/api/terminal/attach') return call('terminal.attach', body)
        if (url.pathname === '/api/terminal/restart') return call('terminal.restart', body)
        if (url.pathname === '/api/terminal/write') return call('terminal.write', body)
        if (url.pathname === '/api/terminal/resize') return call('terminal.resize', body)
        if (url.pathname === '/api/terminal/takeover') return call('terminal.takeover', body)
        if (url.pathname === '/api/terminal/close') return call('terminal.close', body)
        if (url.pathname === '/api/terminal/create') return call('terminal.create', body)
        if (url.pathname === '/api/terminal/prune') return call('terminal.prune', body)
        if (url.pathname === '/api/terminal/notify-bell') return call('terminal.notifyBell', body)
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
      detailTab: options.detailTab ?? base.ui.detailTab,
    },
    remote: {
      ...base.remote,
      ...options.remote,
    },
  }
  useReposStore.setState({
    repos: { [options.id]: repo },
    repoCache: {},
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
