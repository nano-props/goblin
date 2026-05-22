import { beforeEach, describe, expect, test } from 'bun:test'
import { useReposStore } from '#/renderer/stores/repos/store.ts'
import { emptyRepo } from '#/renderer/stores/repos/helpers.ts'
import type { BranchInfo } from '#/renderer/types.ts'
import type { DetailTab } from '#/renderer/stores/repos/types.ts'
import type { CommitDetail } from '#/renderer/types-bridge.ts'

const REPO_ID = '/tmp/gbl-selection-test-repo'

function branch(name: string, options: Partial<BranchInfo> = {}): BranchInfo {
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

function seedRepo(options: {
  selectedBranch?: string | null
  currentBranch?: string
  detailTab?: DetailTab
  openCommit?: boolean
}) {
  const openCommit: CommitDetail | null = options.openCommit
    ? {
        meta: {
          hash: 'abc123',
          shortHash: 'abc123',
          subject: '',
          body: '',
          author: '',
          email: '',
          date: '',
          parents: [],
        },
        files: [],
      }
    : null
  const repo = {
    ...emptyRepo(REPO_ID, 'repo'),
    branches: [
      branch('main', { worktreePath: '/repo' }),
      branch('feature/worktree', { worktreePath: '/tmp/feature-worktree' }),
      branch('feature/plain'),
    ],
    currentBranch: options.currentBranch ?? 'main',
    selectedBranch: options.selectedBranch ?? 'feature/plain',
    detailTab: options.detailTab ?? 'status',
    openCommit,
    openingCommitHash: options.openCommit ? 'abc123' : null,
    loading: false,
    statusLoading: false,
  }
  useReposStore.setState({
    repos: { [REPO_ID]: repo },
    order: [REPO_ID],
    activeId: REPO_ID,
    sessionReady: true,
    missingFromSession: [],
    detailCollapsed: true,
  })
}

beforeEach(() => {
  useReposStore.setState({
    repos: {},
    order: [],
    activeId: null,
    sessionReady: false,
    missingFromSession: [],
    detailCollapsed: true,
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      gbl: {
        log: async () => [],
        pullRequests: async () => [],
      },
    },
  })
})

describe('setBranchViewMode', () => {
  test('changes the selected branch when the previous selection is hidden', () => {
    seedRepo({ selectedBranch: 'feature/plain' })

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.branchViewMode).toBe('worktrees')
    expect(repo?.selectedBranch).toBe('main')
  })

  test('keeps the selected branch when it remains visible', () => {
    seedRepo({ selectedBranch: 'feature/worktree' })

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    expect(useReposStore.getState().repos[REPO_ID]?.selectedBranch).toBe('feature/worktree')
  })

  test('clears commit detail state when selection changes', () => {
    seedRepo({ selectedBranch: 'feature/plain', openCommit: true })

    useReposStore.getState().setBranchViewMode(REPO_ID, 'worktrees')

    const repo = useReposStore.getState().repos[REPO_ID]
    expect(repo?.selectedBranch).toBe('main')
    expect(repo?.openCommit).toBeNull()
    expect(repo?.openingCommitHash).toBeNull()
  })

  test('refreshes the new branch log when commits are visible', async () => {
    const calls: string[] = []
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        gbl: {
          log: async (_repoId: string, branchName: string) => {
            calls.push(branchName)
            return []
          },
          pullRequests: async () => [],
        },
      },
    })
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
    window.gbl.pullRequests = (_repoId, branches, options) =>
      new Promise<[]>((r) => {
        calls.push({ branches, mode: options?.mode })
        resolve = () => r([])
      })
    seedRepo({ selectedBranch: 'feature/plain' })

    useReposStore.getState().selectBranch(REPO_ID, 'main')

    expect(useReposStore.getState().repos[REPO_ID]?.pullRequestsLoading).toBe(false)
    resolve()
    await Promise.resolve()
    expect(calls).toEqual([{ branches: ['main'], mode: 'full' }])
  })
})
