import { beforeEach, describe, expect, test } from 'vitest'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import type { DetailTab } from '#/renderer/stores/repos/types.ts'
import {
  createBranch as branch,
  createCommitDetail,
  installGoblinTestBridge,
  resetReposStore,
  seedRepoState,
} from '#/renderer/stores/repos/test-utils.ts'

const REPO_ID = '/tmp/gbl-selection-test-repo'
const rpcHandlers: Record<string, (input: any) => unknown> = {}

function seedRepo(options: {
  selectedBranch?: string | null
  currentBranch?: string
  detailTab?: DetailTab
  openCommit?: boolean
}) {
  seedRepoState({
    id: REPO_ID,
    branches: [
      branch('main', { worktreePath: '/repo' }),
      branch('feature/worktree', { worktreePath: '/tmp/feature-worktree' }),
      branch('feature/plain'),
    ],
    currentBranch: options.currentBranch ?? 'main',
    selectedBranch: options.selectedBranch ?? 'feature/plain',
    detailTab: options.detailTab ?? 'status',
    openCommit: options.openCommit ? createCommitDetail() : null,
  })
}

beforeEach(() => {
  for (const key of Object.keys(rpcHandlers)) delete rpcHandlers[key]
  resetReposStore()
  installGoblinTestBridge(rpcHandlers)
  rpcHandlers['repo.log'] = async () => []
  rpcHandlers['repo.pullRequests'] = async () => []
})

describe('setBranchViewMode', () => {
  test('changes the selected branch when the previous selection is hidden', () => {
    seedRepo({ selectedBranch: 'feature/plain' })

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.ui.branchViewMode).toBe('worktrees')
    expect(repo?.ui.selectedBranch).toBe('main')
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
    expect(repo?.ui.openCommit).toBeNull()
    expect(repo?.ui.openingCommitHash).toBeNull()
  })

  test('refreshes the new branch log when commits are visible', async () => {
    const calls: string[] = []
    rpcHandlers['repo.log'] = async ({ branch }: { branch: string }) => {
      calls.push(branch)
      return []
    }
    seedRepo({ selectedBranch: 'feature/plain', detailTab: 'commits' })

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')
    await Promise.resolve()

    expect(calls).toEqual(['main'])
  })
})

describe('selectBranch', () => {
  test('refreshes pull request details silently', async () => {
    let resolve!: () => void
    const calls: Array<{ branches?: string[]; mode?: string }> = []
    rpcHandlers['repo.pullRequests'] = ({ branches, options }: { branches?: string[]; options?: { mode?: string } }) =>
      new Promise<[]>((r) => {
        calls.push({ branches, mode: options?.mode })
        resolve = () => r([])
      })
    seedRepo({ selectedBranch: 'feature/plain' })

    useReposStore.getState().selectBranch(REPO_ID, 'main')

    expect(useReposStore.getState().repos[REPO_ID]?.async.pullRequestsLoading).toBe(false)
    resolve()
    await Promise.resolve()
    expect(calls).toEqual([{ branches: ['main'], mode: 'full' }])
  })
})

describe('setDetailTab', () => {
  test('persists the selected detail tab immediately', () => {
    seedRepo({ selectedBranch: 'main', detailTab: 'status' })

    useReposStore.getState().setDetailTab(REPO_ID, 'commits')

    expect(useReposStore.getState().repoCache[REPO_ID]?.ui.detailTab).toBe('commits')
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
        [REPO_ID]: {
          ...repo,
          data: {
            ...repo.data,
            logsByBranch: {
              main: {
                entries: [
                  { hash: 'a', shortHash: 'a', message: 'a', author: 'a', date: '2026-01-01' },
                  { hash: 'b', shortHash: 'b', message: 'b', author: 'b', date: '2026-01-02' },
                ],
                selectedHash: 'a',
                loading: false,
              },
            },
          },
        },
      },
      repoCache: { [REPO_ID]: cached },
    })

    useReposStore.getState().selectLog(REPO_ID, 'main', 'b')

    expect(useReposStore.getState().repos[REPO_ID]?.data.logsByBranch.main?.selectedHash).toBe('b')
    expect(useReposStore.getState().repoCache[REPO_ID]).toBe(cached)
  })
})
