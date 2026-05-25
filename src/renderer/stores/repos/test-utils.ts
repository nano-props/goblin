import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import { disposeAllRepoRuntimes } from '#/renderer/stores/repos/runtime.ts'
import type { BranchInfo, PullRequestInfo, WorktreeStatus } from '#/renderer/types.ts'
import type { DetailTab, RepoState } from '#/renderer/stores/repos/types.ts'
import type { CommitDetail } from '#/shared/rpc.ts'
import {
  DEFAULT_DETAIL_COLLAPSED,
  DEFAULT_DETAIL_PANE_SIZES,
  DEFAULT_WORKSPACE_LAYOUT,
} from '#/shared/workspace-layout.ts'

export type RpcTestHandler = (input: any) => unknown

export function createBranch(name: string, options: Partial<BranchInfo> = {}): BranchInfo {
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

export function createPullRequest(number: number, options: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/acme/repo/pull/${number}`,
    state: 'open',
    ...options,
  }
}

export function createCommitDetail(hash = 'abc123'): CommitDetail {
  return {
    meta: {
      hash,
      shortHash: hash,
      subject: '',
      body: '',
      author: '',
      email: '',
      date: '',
      parents: [],
    },
    files: [],
  }
}

export function resetReposStore(): void {
  disposeAllRepoRuntimes()
  useReposStore.setState({
    repos: {},
    repoCache: {},
    order: [],
    activeId: null,
    sessionReady: false,
    missingFromSession: [],
    detailCollapsed: DEFAULT_DETAIL_COLLAPSED,
    detailFocusMode: false,
    workspaceLayout: DEFAULT_WORKSPACE_LAYOUT,
    detailPaneSizes: DEFAULT_DETAIL_PANE_SIZES,
  })
}

export function installGoblinTestBridge(handlers: Record<string, RpcTestHandler>): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      goblin: {
        homeDir: '/Users/test',
        invokeRpc: ({ path, input }: { path: string; input?: unknown }) => {
          const handler = handlers[path]
          if (!handler) throw new Error(`Unhandled RPC path: ${path}`)
          return handler(input)
        },
        abortRpc: () => Promise.resolve(false),
        onEvent: () => () => {},
        pathForFile: () => '',
        terminal: {
          open: () => Promise.resolve({ ok: false, message: 'unhandled terminal open' }),
          restart: () => Promise.resolve({ ok: false, message: 'unhandled terminal restart' }),
          write: () => Promise.resolve(true),
          resize: () => Promise.resolve(true),
          close: () => Promise.resolve(true),
          pruneRepo: () => Promise.resolve(true),
          onOutput: () => () => {},
          onExit: () => () => {},
        },
      },
    },
  })
}

export function seedRepoState(options: {
  id: string
  name?: string
  branches?: BranchInfo[]
  currentBranch?: string
  selectedBranch?: string | null
  detailTab?: DetailTab
  openCommit?: CommitDetail | null
  instanceToken?: number
  status?: WorktreeStatus[]
  statusLoaded?: boolean
}): RepoState {
  const base = emptyRepo(options.id, options.name ?? 'repo')
  const repo: RepoState = {
    ...base,
    instanceToken: options.instanceToken ?? base.instanceToken,
    data: {
      ...base.data,
      branches: options.branches ?? base.data.branches,
      currentBranch: options.currentBranch ?? base.data.currentBranch,
      status: options.status ?? base.data.status,
      statusLoaded: options.statusLoaded ?? base.data.statusLoaded,
    },
    ui: {
      ...base.ui,
      selectedBranch: options.selectedBranch ?? base.ui.selectedBranch,
      detailTab: options.detailTab ?? base.ui.detailTab,
      commitDetail: options.openCommit ? { phase: 'open', detail: options.openCommit } : base.ui.commitDetail,
    },
  }
  useReposStore.setState({
    repos: { [options.id]: repo },
    repoCache: {},
    order: [options.id],
    activeId: options.id,
    sessionReady: true,
    missingFromSession: [],
    detailCollapsed: DEFAULT_DETAIL_COLLAPSED,
    detailFocusMode: false,
    workspaceLayout: DEFAULT_WORKSPACE_LAYOUT,
    detailPaneSizes: DEFAULT_DETAIL_PANE_SIZES,
  })
  return repo
}
