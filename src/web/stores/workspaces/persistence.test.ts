import { beforeEach, describe, expect, test } from 'vitest'
import {
  normalizeRepoSnapshotCache,
  persistRepoSnapshotCacheEntry,
} from '#/web/stores/workspaces/persistence.ts'
import {
  createBranchSnapshot,
  createRepoBranch,
  resetWorkspacesStore,
  seedRepoReadModelQueryData,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/bridge.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type { RepoSnapshotCacheEntry } from '#/web/stores/workspaces/types.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace')
function cachedRepo(savedAt: number): RepoSnapshotCacheEntry {
  return {
    savedAt,
    name: 'repo',
    data: {
      branches: [],
      currentBranch: '',
    },
    ui: {
      branchViewMode: 'all',
    },
  }
}

beforeEach(() => {
  primaryWindowQueryClient.clear()
  resetWorkspacesStore()
})

describe('normalizeRepoSnapshotCache', () => {
  test('keeps only the newest 50 valid cache entries', () => {
    const now = Date.now()
    const raw = Object.fromEntries(
      Array.from({ length: 55 }, (_, index) => [`/repo-${index}`, cachedRepo(now + index)]),
    )

    const normalized = normalizeRepoSnapshotCache(raw)

    expect(Object.keys(normalized)).toHaveLength(50)
    expect(normalized['/repo-0']).toBeUndefined()
    expect(normalized['/repo-4']).toBeUndefined()
    expect(normalized['/repo-5']).toBeDefined()
    expect(Object.keys(normalized)[0]).toBe('/repo-54')
  })

  test('drops expired and invalid cache entries', () => {
    const now = Date.now()
    const normalized = normalizeRepoSnapshotCache({
      fresh: cachedRepo(now),
      expired: cachedRepo(now - 15 * 24 * 60 * 60 * 1000),
      invalid: { savedAt: now, name: 'repo' },
    })

    expect(Object.keys(normalized)).toEqual(['fresh'])
  })

  test('normalizes cached branch worktree references while dropping dynamic metadata', () => {
    const now = Date.now()
    const raw = cachedRepo(now)
    raw.data.branches = [createRepoBranch('feature/a', { worktree: { path: '/tmp/worktree-a' } })]

    const normalized = normalizeRepoSnapshotCache({ repo: raw })

    expect(normalized.repo?.data.branches[0]?.worktree).toEqual({ path: '/tmp/worktree-a' })
    expect(normalized.repo?.data.branches[0]?.pullRequest).toBeUndefined()
  })
})

describe('persistRepoSnapshotCacheEntry', () => {
  test('does not write a stale cache entry after the workspace runtime changes', () => {
    const staleRepo = seedRepoWithReadModelForTest({
      id: WORKSPACE_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      branches: [createRepoBranch('main')],
      currentBranch: 'main',
      currentBranchName: 'main',
    })
    seedRepoWithReadModelForTest({ id: WORKSPACE_ID, workspaceRuntimeId: 'repo-runtime-test-2' })

    persistRepoSnapshotCacheEntry(useWorkspacesStore.setState, staleRepo, 'repo-runtime-test')

    expect(useWorkspacesStore.getState().repoSnapshotCache[WORKSPACE_ID]).toBeUndefined()
  })

  test('persists branch references without dynamic worktree or pull request state', () => {
    const repo = seedRepoWithReadModelForTest({
      id: WORKSPACE_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      branchSnapshots: [
        createBranchSnapshot('feature/a', {
          worktree: {
            path: '/tmp/worktree-a',
            isPrimary: true,
            isLocked: true,
            summary: {
              dirty: true,
              changeCount: 2,
            },
          },
          pullRequest: {
            number: 1,
            title: 'PR 1',
            url: 'https://github.com/acme/repo/pull/1',
            state: 'open',
            mergeable: 'MERGEABLE',
          },
        }),
      ],
      currentBranch: 'feature/a',
      currentBranchName: 'feature/a',
    })

    persistRepoSnapshotCacheEntry(useWorkspacesStore.setState, repo, 'repo-runtime-test')

    const cached = useWorkspacesStore.getState().repoSnapshotCache[WORKSPACE_ID]
    expect(cached?.data.branches[0]?.worktree).toEqual({ path: '/tmp/worktree-a' })
    expect(cached?.data.branches[0]?.pullRequest).toBeUndefined()
  })

  test('persists the React Query branch read model when it is newer than the store projection', () => {
    const repo = seedRepoWithReadModelForTest({
      id: WORKSPACE_ID,
      workspaceRuntimeId: 'repo-runtime-test',
      branches: [createRepoBranch('main')],
      currentBranch: 'main',
      currentBranchName: 'main',
    })
    seedRepoReadModelQueryData(repo, {
      branches: [createBranchSnapshot('feature/query', { isCurrent: true })],
      currentBranch: 'feature/query',
    })

    persistRepoSnapshotCacheEntry(useWorkspacesStore.setState, repo, 'repo-runtime-test')

    const cached = useWorkspacesStore.getState().repoSnapshotCache[WORKSPACE_ID]
    expect(cached?.data.currentBranch).toBe('feature/query')
    expect(cached?.data.branches.map((branch) => branch.name)).toEqual(['feature/query'])
  })
})
