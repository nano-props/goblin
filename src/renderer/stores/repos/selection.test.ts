import { beforeEach, describe, expect, test } from 'vitest'
import { replaceRepo } from '#/renderer/stores/repos/helpers.ts'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import type { BranchLogState, DetailTab, RepoState } from '#/renderer/stores/repos/types.ts'
import {
  createBranch as branch,
  createCommitDetail,
  installGoblinTestBridge,
  resetReposStore,
  seedRepoState,
} from '#/renderer/stores/repos/test-utils.ts'
import type { BranchInfo } from '#/renderer/types.ts'
import { DEFAULT_DETAIL_PANE_SIZES } from '#/shared/workspace-layout.ts'

const REPO_ID = '/tmp/gbl-selection-test-repo'
const rpcHandlers: Record<string, (input: any) => unknown> = {}

function seedRepo(options: {
  selectedBranch?: string | null
  currentBranch?: string
  detailTab?: DetailTab
  openCommit?: boolean
  branches?: BranchInfo[]
}) {
  seedRepoState({
    id: REPO_ID,
    branches: options.branches ?? [
      branch('main', { worktreePath: '/repo' }),
      branch('feature/worktree', { worktreePath: '/tmp/feature-worktree' }),
      branch('feature/plain'),
    ],
    currentBranch: options.currentBranch ?? 'main',
    selectedBranch: options.selectedBranch ?? 'feature/plain',
    detailTab: options.detailTab ?? 'status',
    openCommit: options.openCommit ? createCommitDetail() : null,
    remote: { remotes: ['origin'], hasRemotes: true, hasGitHubRemote: true },
  })
}

function updateRepoForTest(mutator: (repo: RepoState) => void) {
  useReposStore.setState((s) => {
    const repo = s.repos[REPO_ID]
    if (!repo) return s
    return { repos: { ...s.repos, [REPO_ID]: replaceRepo(repo, mutator) } }
  })
}

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function stubRefreshActions(
  stubs: Partial<
    Pick<ReturnType<typeof useReposStore.getState>, 'refreshBranchLog' | 'refreshPullRequests' | 'refreshStatus'>
  >,
): () => void {
  const original = useReposStore.getState()
  useReposStore.setState(stubs)
  return () => {
    useReposStore.setState({
      refreshBranchLog: original.refreshBranchLog,
      refreshPullRequests: original.refreshPullRequests,
      refreshStatus: original.refreshStatus,
    })
  }
}

beforeEach(() => {
  for (const key of Object.keys(rpcHandlers)) delete rpcHandlers[key]
  resetReposStore()
  installGoblinTestBridge(rpcHandlers)
  rpcHandlers['repo.log'] = async () => []
  rpcHandlers['repo.pullRequests'] = async () => []
  rpcHandlers['repo.status'] = async () => []
})

describe('setBranchViewMode', () => {
  test('changes the selected branch when the previous selection is hidden', () => {
    seedRepo({ selectedBranch: 'feature/plain' })

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.branchViewMode).toBe('worktrees')
    expect(repo?.ui.selectedBranch).toBe('main')
    expect(useReposStore.getState().repoCache[REPO_ID]?.ui).toMatchObject({
      branchViewMode: 'worktrees',
      selectedBranch: 'main',
    })
  })

  test('keeps the selected branch when it remains visible', () => {
    seedRepo({ selectedBranch: 'feature/worktree' })

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBe('feature/worktree')
  })

  test('clears commit detail state when selection changes', () => {
    seedRepo({ selectedBranch: 'feature/plain', openCommit: true })

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.selectedBranch).toBe('main')
    expect(repo?.ui.commitDetail.phase).toBe('idle')
  })

  test('clears the selection when the new view mode has no visible branches', () => {
    seedRepo({ selectedBranch: 'main', branches: [branch('main')] })

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.branchViewMode).toBe('worktrees')
    expect(repo?.ui.selectedBranch).toBeNull()
    expect(useReposStore.getState().repoCache[REPO_ID]?.ui.selectedBranch).toBeNull()
  })

  test('refreshes the new branch log when commits are visible', async () => {
    const calls: string[] = []
    rpcHandlers['repo.log'] = async ({ branch }: { branch: string }) => {
      calls.push(branch)
      return []
    }
    seedRepo({ selectedBranch: 'feature/plain', detailTab: 'commits' })

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')
    await flushAsyncWork()

    expect(calls).toEqual(['main'])
  })

  test('passes the current repo token to follow-up refreshes', () => {
    seedRepo({ selectedBranch: 'feature/plain', detailTab: 'commits' })
    const token = useReposStore.getState().repos[REPO_ID]!.instanceToken
    const logCalls: Parameters<ReturnType<typeof useReposStore.getState>['refreshBranchLog']>[] = []
    const pullRequestCalls: Parameters<ReturnType<typeof useReposStore.getState>['refreshPullRequests']>[] = []
    const restore = stubRefreshActions({
      refreshBranchLog: async (...args) => {
        logCalls.push(args)
      },
      refreshPullRequests: async (...args) => {
        pullRequestCalls.push(args)
      },
    })

    try {
      useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

      expect(logCalls[0]).toEqual([REPO_ID, 'main', { token }])
      expect(pullRequestCalls[0]).toEqual([REPO_ID, ['main'], { token, mode: 'full' }])
    } finally {
      restore()
    }
  })

  test('refreshes pull request details when the selected branch changes', async () => {
    const calls: Array<{ branches?: string[]; mode?: string }> = []
    rpcHandlers['repo.pullRequests'] = async ({
      branches,
      options,
    }: {
      branches?: string[]
      options?: { mode?: string }
    }) => {
      calls.push({ branches, mode: options?.mode })
      return []
    }
    seedRepo({ selectedBranch: 'feature/plain' })

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')
    await flushAsyncWork()

    expect(calls).toEqual([{ branches: ['main'], mode: 'full' }])
  })

  test('falls back from terminal when the new view selection has no worktree', () => {
    seedRepo({
      selectedBranch: 'main',
      detailTab: 'terminal',
      branches: [branch('main', { worktreePath: '/repo' }), branch('feature/plain')],
    })

    useReposStore.getState().setBranchViewMode(REPO_ID, 'no-worktree')

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.selectedBranch).toBe('feature/plain')
    expect(repo?.ui.detailTab).toBe('status')
    expect(useReposStore.getState().repoCache[REPO_ID]?.ui.detailTab).toBe('status')
  })
})

describe('selectBranch', () => {
  test('refreshes pull request details locally', async () => {
    let resolve!: () => void
    const calls: Array<{ branches?: string[]; mode?: string }> = []
    rpcHandlers['repo.pullRequests'] = ({ branches, options }: { branches?: string[]; options?: { mode?: string } }) =>
      new Promise<[]>((r) => {
        calls.push({ branches, mode: options?.mode })
        resolve = () => r([])
      })
    seedRepo({ selectedBranch: 'feature/plain' })

    useReposStore.getState().selectBranch(REPO_ID, 'main')

    expect(useReposStore.getState().repos[REPO_ID]?.resources.pullRequests.phase).toBe('loading')
    resolve()
    await Promise.resolve()
    expect(calls).toEqual([{ branches: ['main'], mode: 'full' }])
    expect(useReposStore.getState().repoCache[REPO_ID]?.ui.selectedBranch).toBe('main')
  })

  test('passes the current repo token to selected branch refreshes', () => {
    seedRepo({ selectedBranch: 'feature/plain', detailTab: 'commits' })
    const token = useReposStore.getState().repos[REPO_ID]!.instanceToken
    const logCalls: Parameters<ReturnType<typeof useReposStore.getState>['refreshBranchLog']>[] = []
    const pullRequestCalls: Parameters<ReturnType<typeof useReposStore.getState>['refreshPullRequests']>[] = []
    const restore = stubRefreshActions({
      refreshBranchLog: async (...args) => {
        logCalls.push(args)
      },
      refreshPullRequests: async (...args) => {
        pullRequestCalls.push(args)
      },
    })

    try {
      useReposStore.getState().selectBranch(REPO_ID, 'main')

      expect(logCalls[0]).toEqual([REPO_ID, 'main', { token }])
      expect(pullRequestCalls[0]).toEqual([REPO_ID, ['main'], { token, mode: 'full' }])
    } finally {
      restore()
    }
  })

  test('ignores a branch that is not in the current snapshot', () => {
    let calls = 0
    rpcHandlers['repo.pullRequests'] = async () => {
      calls += 1
      return []
    }
    seedRepo({ selectedBranch: 'feature/plain', openCommit: true })

    useReposStore.getState().selectBranch(REPO_ID, 'missing')

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.selectedBranch).toBe('feature/plain')
    expect(repo?.ui.commitDetail.phase).toBe('open')
    expect(calls).toBe(0)
  })

  test('does not refresh when selecting the already-selected branch', () => {
    let calls = 0
    rpcHandlers['repo.pullRequests'] = async () => {
      calls += 1
      return []
    }
    seedRepo({ selectedBranch: 'feature/plain' })

    useReposStore.getState().selectBranch(REPO_ID, 'feature/plain')

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBe('feature/plain')
    expect(calls).toBe(0)
  })

  test('clears commit detail state when the selection changes', () => {
    seedRepo({ selectedBranch: 'feature/plain', openCommit: true })

    useReposStore.getState().selectBranch(REPO_ID, 'main')

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.selectedBranch).toBe('main')
    expect(repo?.ui.commitDetail.phase).toBe('idle')
  })

  test('falls back from terminal when selecting a branch without a worktree', () => {
    seedRepo({ selectedBranch: 'feature/worktree', detailTab: 'terminal' })

    useReposStore.getState().selectBranch(REPO_ID, 'feature/plain')

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.selectedBranch).toBe('feature/plain')
    expect(repo?.ui.detailTab).toBe('status')
    expect(useReposStore.getState().repoCache[REPO_ID]?.ui.detailTab).toBe('status')
  })
})

describe('setDetailTab', () => {
  test('persists the selected detail tab immediately', () => {
    seedRepo({ selectedBranch: 'main', detailTab: 'status' })

    useReposStore.getState().setDetailTab(REPO_ID, 'commits')

    expect(useReposStore.getState().repoCache[REPO_ID]?.ui.detailTab).toBe('commits')
  })

  test('does not refresh when reselecting the current tab', () => {
    let calls = 0
    rpcHandlers['repo.log'] = async () => {
      calls += 1
      return []
    }
    seedRepo({ selectedBranch: 'main', detailTab: 'commits' })

    useReposStore.getState().setDetailTab(REPO_ID, 'commits')

    expect(calls).toBe(0)
  })

  test('refreshes status when switching to changes', async () => {
    let calls = 0
    rpcHandlers['repo.status'] = async () => {
      calls += 1
      return []
    }
    seedRepo({ selectedBranch: 'main', detailTab: 'status' })

    useReposStore.getState().setDetailTab(REPO_ID, 'changes')
    await flushAsyncWork()

    expect(calls).toBe(1)
  })

  test('passes the current repo token to detail tab refreshes', () => {
    seedRepo({ selectedBranch: 'main', detailTab: 'changes' })
    const token = useReposStore.getState().repos[REPO_ID]!.instanceToken
    const pullRequestCalls: Parameters<ReturnType<typeof useReposStore.getState>['refreshPullRequests']>[] = []
    const restore = stubRefreshActions({
      refreshPullRequests: async (...args) => {
        pullRequestCalls.push(args)
      },
    })

    try {
      useReposStore.getState().setDetailTab(REPO_ID, 'status')

      expect(pullRequestCalls[0]).toEqual([REPO_ID, ['main'], { token, mode: 'full' }])
    } finally {
      restore()
    }
  })

  test('refreshes pull request details when switching to status', async () => {
    const calls: string[][] = []
    rpcHandlers['repo.pullRequests'] = async ({ branches }: { branches?: string[] }) => {
      calls.push(branches ?? [])
      return []
    }
    seedRepo({ selectedBranch: 'main', detailTab: 'changes' })

    useReposStore.getState().setDetailTab(REPO_ID, 'status')
    await flushAsyncWork()

    expect(calls).toEqual([['main']])
  })

  test('skips commit log refresh when no branch is visible for logs', async () => {
    let calls = 0
    rpcHandlers['repo.log'] = async () => {
      calls += 1
      return []
    }
    seedRepo({ selectedBranch: 'main', detailTab: 'status', branches: [branch('main')] })
    updateRepoForTest((r) => {
      r.ui.selectedBranch = null
      r.ui.branchViewMode = 'worktrees'
    })

    useReposStore.getState().setDetailTab(REPO_ID, 'commits')
    await flushAsyncWork()

    expect(calls).toBe(0)
  })

  test('opens terminal only for branches with a worktree', () => {
    seedRepo({ selectedBranch: 'feature/worktree', detailTab: 'status' })

    useReposStore.getState().setDetailTab(REPO_ID, 'terminal')

    expect(useReposStore.getState().repos[REPO_ID]?.ui.detailTab).toBe('terminal')
  })

  test('falls back to status when terminal is selected without a worktree', () => {
    seedRepo({ selectedBranch: 'feature/plain', detailTab: 'commits' })

    useReposStore.getState().setDetailTab(REPO_ID, 'terminal')

    expect(useReposStore.getState().repos[REPO_ID]?.ui.detailTab).toBe('status')
  })

  test('does not persist terminal as a cached detail tab', () => {
    seedRepo({ selectedBranch: 'feature/worktree', detailTab: 'status' })

    useReposStore.getState().setDetailTab(REPO_ID, 'terminal')

    expect(useReposStore.getState().repoCache[REPO_ID]?.ui.detailTab).toBe('status')
  })

  test('dismissing the active exited terminal detail falls back to status and collapses the pane', async () => {
    let refreshedBranches: string[] | undefined
    rpcHandlers['repo.pullRequests'] = async ({ branches }: { branches: string[] }) => {
      refreshedBranches = branches
      return []
    }
    seedRepo({ selectedBranch: 'feature/worktree', detailTab: 'terminal' })
    useReposStore.setState({ detailCollapsed: false })

    useReposStore.getState().dismissExitedTerminalDetail(REPO_ID, '/tmp/feature-worktree')

    expect(useReposStore.getState().repos[REPO_ID]?.ui.detailTab).toBe('status')
    expect(useReposStore.getState().detailCollapsed).toBe(true)
    expect(useReposStore.getState().repoCache[REPO_ID]?.ui.detailTab).toBe('status')
    await flushAsyncWork()
    expect(refreshedBranches).toEqual(['feature/worktree'])
  })

  test('dismissing a stale exited terminal session leaves the current detail selection alone', () => {
    seedRepo({ selectedBranch: 'feature/worktree', detailTab: 'terminal' })
    useReposStore.setState({ detailCollapsed: false })

    useReposStore.getState().dismissExitedTerminalDetail(REPO_ID, '/tmp/other-worktree')

    expect(useReposStore.getState().repos[REPO_ID]?.ui.detailTab).toBe('terminal')
    expect(useReposStore.getState().detailCollapsed).toBe(false)
  })

  test('dismissing terminal detail keeps the pane expanded in left-right layout', () => {
    seedRepo({ selectedBranch: 'feature/worktree', detailTab: 'terminal' })
    useReposStore.getState().setWorkspaceLayout('left-right')

    useReposStore.getState().dismissExitedTerminalDetail(REPO_ID, '/tmp/feature-worktree')

    expect(useReposStore.getState().repos[REPO_ID]?.ui.detailTab).toBe('status')
    expect(useReposStore.getState().detailCollapsed).toBe(false)
  })
})

describe('setWorkspaceLayout', () => {
  test('allows detail collapse changes in top-bottom layout', () => {
    useReposStore.getState().setDetailCollapsed(false)
    expect(useReposStore.getState().detailCollapsed).toBe(false)

    useReposStore.getState().setDetailCollapsed(true)
    expect(useReposStore.getState().detailCollapsed).toBe(true)
  })

  test('expands detail and blocks collapse in left-right layout', () => {
    useReposStore.getState().setDetailCollapsed(true)

    useReposStore.getState().setWorkspaceLayout('left-right')

    expect(useReposStore.getState().workspaceLayout).toBe('left-right')
    expect(useReposStore.getState().detailCollapsed).toBe(false)

    useReposStore.getState().setDetailCollapsed(true)
    expect(useReposStore.getState().detailCollapsed).toBe(false)

    useReposStore.getState().toggleDetailCollapsed()
    expect(useReposStore.getState().detailCollapsed).toBe(false)
  })

  test('allows collapse again after returning to top-bottom layout', () => {
    useReposStore.getState().setWorkspaceLayout('left-right')
    useReposStore.getState().setWorkspaceLayout('top-bottom')

    useReposStore.getState().toggleDetailCollapsed()

    expect(useReposStore.getState().workspaceLayout).toBe('top-bottom')
    expect(useReposStore.getState().detailCollapsed).toBe(true)
  })
})

describe('setDetailFocusMode', () => {
  test('enables focus mode and expands detail in top-bottom layout', () => {
    useReposStore.getState().setDetailCollapsed(true)

    useReposStore.getState().setDetailFocusMode(true)

    expect(useReposStore.getState().detailFocusMode).toBe(true)
    expect(useReposStore.getState().detailCollapsed).toBe(false)
  })

  test('keeps focus mode when detail is collapsed', () => {
    useReposStore.getState().setDetailFocusMode(true)

    useReposStore.getState().setDetailCollapsed(true)

    expect(useReposStore.getState().detailFocusMode).toBe(true)
    expect(useReposStore.getState().detailCollapsed).toBe(true)
  })

  test('exits focus mode without expanding a collapsed detail panel', () => {
    useReposStore.getState().setDetailFocusMode(true)
    useReposStore.getState().setDetailCollapsed(true)

    useReposStore.getState().setDetailFocusMode(false)

    expect(useReposStore.getState().detailFocusMode).toBe(false)
    expect(useReposStore.getState().detailCollapsed).toBe(true)
  })

  test('re-expands into focus mode when focus is enabled while collapsed', () => {
    useReposStore.getState().setDetailFocusMode(true)
    useReposStore.getState().setDetailCollapsed(true)

    useReposStore.getState().toggleDetailCollapsed()

    expect(useReposStore.getState().detailFocusMode).toBe(true)
    expect(useReposStore.getState().detailCollapsed).toBe(false)
  })

  test('exits focus mode when switching to left-right layout', () => {
    useReposStore.getState().setDetailFocusMode(true)

    useReposStore.getState().setWorkspaceLayout('left-right')

    expect(useReposStore.getState().workspaceLayout).toBe('left-right')
    expect(useReposStore.getState().detailFocusMode).toBe(false)
    expect(useReposStore.getState().detailCollapsed).toBe(false)
  })

  test('does not enable focus mode in left-right layout', () => {
    useReposStore.getState().setWorkspaceLayout('left-right')

    useReposStore.getState().setDetailFocusMode(true)

    expect(useReposStore.getState().detailFocusMode).toBe(false)
  })

  test('preserves focus preference when filtering leaves no selected branch', () => {
    seedRepo({ selectedBranch: 'main', branches: [branch('main')] })
    useReposStore.getState().setDetailFocusMode(true)

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBeNull()
    expect(useReposStore.getState().detailFocusMode).toBe(true)
    expect(useReposStore.getState().detailCollapsed).toBe(false)
  })
})

describe('setDetailPaneSize', () => {
  test('stores detail pane sizes per workspace layout', () => {
    useReposStore.getState().setDetailPaneSize('top-bottom', 37.34)
    useReposStore.getState().setDetailPaneSize('left-right', 72.28)

    expect(useReposStore.getState().detailPaneSizes).toEqual({ 'top-bottom': 37.3, 'left-right': 72.3 })
  })

  test('normalizes invalid and out-of-range sizes', () => {
    useReposStore.getState().setDetailPaneSize('top-bottom', Number.NaN)
    useReposStore.getState().setDetailPaneSize('left-right', 200)

    expect(useReposStore.getState().detailPaneSizes).toEqual({ 'top-bottom': 50, 'left-right': 90 })
  })
})

describe('commit detail collapse behavior', () => {
  test('test fixture represents an opened commit as a stable tab-local state', () => {
    seedRepo({ selectedBranch: 'main', detailTab: 'commits', openCommit: true })

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.commitDetail.phase).toBe('open')
  })

  test('opening a commit expands the detail pane immediately', async () => {
    seedRepo({ selectedBranch: 'main', detailTab: 'commits' })
    useReposStore.setState({ detailCollapsed: true })
    rpcHandlers['repo.commit'] = async ({ hash }: { hash: string }) => createCommitDetail(hash)

    await useReposStore.getState().openCommit(REPO_ID, 'abc123')

    expect(useReposStore.getState().detailCollapsed).toBe(false)
    const commitDetail = useReposStore.getState().repos[REPO_ID]?.ui.commitDetail
    expect(commitDetail?.phase).toBe('open')
    expect(commitDetail?.phase === 'open' ? commitDetail.detail.meta.hash : null).toBe('abc123')
  })

  test('collapsing detail preserves a pending commit detail', async () => {
    let resolveCommit!: () => void
    rpcHandlers['repo.commit'] = ({ hash }: { hash: string }) =>
      new Promise((resolve) => {
        resolveCommit = () => resolve(createCommitDetail(hash))
      })
    seedRepo({ selectedBranch: 'main', detailTab: 'commits' })
    useReposStore.setState({ detailCollapsed: false })

    const work = useReposStore.getState().openCommit(REPO_ID, 'abc123')

    expect(useReposStore.getState().repos[REPO_ID]?.ui.commitDetail).toEqual({ phase: 'opening', hash: 'abc123' })
    useReposStore.getState().setDetailCollapsed(true)
    expect(useReposStore.getState().detailCollapsed).toBe(true)
    expect(useReposStore.getState().repos[REPO_ID]?.ui.commitDetail).toEqual({ phase: 'opening', hash: 'abc123' })

    resolveCommit()
    await work

    const commitDetail = useReposStore.getState().repos[REPO_ID]?.ui.commitDetail
    expect(commitDetail?.phase).toBe('open')
    expect(commitDetail?.phase === 'open' ? commitDetail.detail.meta.hash : null).toBe('abc123')
  })

  test('collapsing detail preserves an open commit detail as tab-local state', () => {
    seedRepo({ selectedBranch: 'main', detailTab: 'commits', openCommit: true })
    useReposStore.setState({ detailCollapsed: false })

    useReposStore.getState().toggleDetailCollapsed()

    expect(useReposStore.getState().detailCollapsed).toBe(true)
    expect(useReposStore.getState().repos[REPO_ID]?.ui.commitDetail.phase).toBe('open')
  })

  test('closing a pending commit detail keeps a late response from reopening it', async () => {
    let resolveCommit!: () => void
    rpcHandlers['repo.commit'] = ({ hash }: { hash: string }) =>
      new Promise((resolve) => {
        resolveCommit = () => resolve(createCommitDetail(hash))
      })
    seedRepo({ selectedBranch: 'main', detailTab: 'commits' })

    const work = useReposStore.getState().openCommit(REPO_ID, 'abc123')

    expect(useReposStore.getState().repos[REPO_ID]?.ui.commitDetail).toEqual({ phase: 'opening', hash: 'abc123' })
    useReposStore.getState().closeCommit(REPO_ID)
    expect(useReposStore.getState().repos[REPO_ID]?.ui.commitDetail.phase).toBe('idle')

    resolveCommit()
    await work

    expect(useReposStore.getState().repos[REPO_ID]?.ui.commitDetail.phase).toBe('idle')
  })
})

describe('resetLayout', () => {
  test('restores the initial workspace layout defaults', () => {
    useReposStore.setState({
      workspaceLayout: 'left-right',
      detailCollapsed: false,
      detailFocusMode: true,
      detailPaneSizes: { 'top-bottom': 35, 'left-right': 70 },
    })

    useReposStore.getState().resetLayout()

    expect(useReposStore.getState().workspaceLayout).toBe('top-bottom')
    expect(useReposStore.getState().detailCollapsed).toBe(true)
    expect(useReposStore.getState().detailFocusMode).toBe(false)
    expect(useReposStore.getState().detailPaneSizes).toBe(DEFAULT_DETAIL_PANE_SIZES)
  })

  test('is idempotent when layout is already at defaults', () => {
    const before = useReposStore.getState()

    useReposStore.getState().resetLayout()

    expect(useReposStore.getState()).toBe(before)
  })
})

describe('setBranchSearchQuery', () => {
  test('updates runtime search without rewriting durable cache or changing selection', () => {
    seedRepo({ selectedBranch: 'feature/plain' })
    const repo = useReposStore.getState().repos[REPO_ID]!
    const cached = {
      savedAt: 123,
      name: repo.name,
      data: {
        branches: repo.data.branches,
        currentBranch: repo.data.currentBranch,
        status: repo.data.status,
        statusLoaded: repo.data.statusLoaded,
      },
      ui: {
        selectedBranch: repo.ui.selectedBranch,
        branchViewMode: repo.ui.branchViewMode,
        detailTab: repo.ui.detailTab,
      },
    }
    useReposStore.setState({ repoCache: { [REPO_ID]: cached } })

    useReposStore.getState().setBranchSearchQuery(REPO_ID, 'worktree')

    expect(useReposStore.getState().branchSearchQueries[REPO_ID]).toBe('worktree')
    expect(useReposStore.getState().repos[REPO_ID]?.ui.selectedBranch).toBe('feature/plain')
    expect(useReposStore.getState().repoCache[REPO_ID]).toBe(cached)
  })

  test('removes runtime search when the query is cleared or the repo is closed', () => {
    seedRepo({ selectedBranch: 'feature/plain' })

    useReposStore.getState().setBranchSearchQuery(REPO_ID, 'worktree')
    useReposStore.getState().setBranchSearchQuery(REPO_ID, '')

    expect(useReposStore.getState().branchSearchQueries[REPO_ID]).toBeUndefined()

    useReposStore.getState().setBranchSearchQuery(REPO_ID, '   ')

    expect(useReposStore.getState().branchSearchQueries[REPO_ID]).toBeUndefined()

    useReposStore.getState().setBranchSearchQuery(REPO_ID, 'feature')
    useReposStore.getState().closeRepo(REPO_ID)

    expect(useReposStore.getState().branchSearchQueries[REPO_ID]).toBeUndefined()
  })
})

describe('selectLog', () => {
  test('updates runtime log selection without rewriting durable cache', () => {
    seedRepo({ selectedBranch: 'main', detailTab: 'commits' })
    const repo = useReposStore.getState().repos[REPO_ID]!
    const cached = {
      savedAt: 123,
      name: repo.name,
      data: {
        branches: repo.data.branches,
        currentBranch: repo.data.currentBranch,
        status: repo.data.status,
        statusLoaded: repo.data.statusLoaded,
      },
      ui: {
        selectedBranch: repo.ui.selectedBranch,
        branchViewMode: repo.ui.branchViewMode,
        detailTab: repo.ui.detailTab,
      },
    }
    useReposStore.setState({
      repos: {
        [REPO_ID]: replaceRepo(repo, (r) => {
          r.data.logsByBranch = { main: createLogState('a') }
        }),
      },
      repoCache: { [REPO_ID]: cached },
    })

    useReposStore.getState().selectLog(REPO_ID, 'main', 'b')

    expect(useReposStore.getState().repos[REPO_ID]?.data.logsByBranch.main?.selectedHash).toBe('b')
    expect(useReposStore.getState().repoCache[REPO_ID]).toBe(cached)
  })

  test('ignores hashes that are not in the loaded branch log', () => {
    seedRepo({ selectedBranch: 'main', detailTab: 'commits' })
    updateRepoForTest((r) => {
      r.data.logsByBranch = { main: createLogState('a') }
    })

    useReposStore.getState().selectLog(REPO_ID, 'main', 'missing')

    expect(useReposStore.getState().repos[REPO_ID]?.data.logsByBranch.main?.selectedHash).toBe('a')
  })

  test('keeps the current log selection when the hash is already selected', () => {
    seedRepo({ selectedBranch: 'main', detailTab: 'commits' })
    updateRepoForTest((r) => {
      r.data.logsByBranch = { main: createLogState('a') }
    })
    const repoBefore = useReposStore.getState().repos[REPO_ID]

    useReposStore.getState().selectLog(REPO_ID, 'main', 'a')

    expect(useReposStore.getState().repos[REPO_ID]).toBe(repoBefore)
  })
})

function createLogState(selectedHash: string): BranchLogState {
  return {
    entries: [
      { hash: 'a', shortHash: 'a', message: 'a', author: 'a', date: '2026-01-01' },
      { hash: 'b', shortHash: 'b', message: 'b', author: 'b', date: '2026-01-02' },
    ],
    selectedHash,
    hasMore: false,
  }
}
