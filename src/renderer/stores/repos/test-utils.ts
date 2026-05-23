import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import type { BranchInfo, PullRequestInfo, WorktreeStatus } from '#/renderer/types.ts'
import type { DetailTab, RepoState } from '#/renderer/stores/repos/types.ts'
import type { CommitDetail } from '#/renderer/types-bridge.ts'

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
  useReposStore.setState({
    repos: {},
    repoCache: {},
    order: [],
    activeId: null,
    sessionReady: false,
    missingFromSession: [],
    detailCollapsed: true,
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
        onEvent: () => () => {},
        pathForFile: () => '',
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
  async?: Partial<RepoState['async']>
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
      openCommit: options.openCommit ?? base.ui.openCommit,
      openingCommitHash: options.openCommit ? options.openCommit.meta.hash : base.ui.openingCommitHash,
    },
    async: {
      ...base.async,
      loading: false,
      statusLoading: false,
      ...options.async,
    },
  }
  useReposStore.setState({
    repos: { [options.id]: repo },
    repoCache: {},
    order: [options.id],
    activeId: options.id,
    sessionReady: true,
    missingFromSession: [],
    detailCollapsed: true,
  })
  return repo
}
