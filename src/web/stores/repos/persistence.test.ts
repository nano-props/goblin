import { beforeEach, describe, expect, test } from 'vitest'
import {
  restoreRepoProjectionFromCacheEntry,
  normalizeRepoSnapshotCache,
  persistRepoSnapshotCacheEntry,
} from '#/web/stores/repos/persistence.ts'
import { emptyRepo } from '#/web/stores/repos/repo-state-factory.ts'
import { createBranchSnapshot, createRepoBranch, resetReposStore, seedRepoState } from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { RepoSnapshotCacheEntry } from '#/web/stores/repos/types.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { setRepoSnapshotQueryData } from '#/web/repo-data-query.ts'
function cachedRepo(savedAt: number): RepoSnapshotCacheEntry {
  return {
    savedAt,
    name: 'repo',
    data: {
      branches: [],
      currentBranch: '',
    },
    ui: {
      selectedBranch: null,
      branchViewMode: 'all',
    },
  }
}

beforeEach(() => {
  primaryWindowQueryClient.clear()
  resetReposStore()
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
  test('does not write a stale cache entry after the repo instance changes', () => {
    const staleRepo = seedRepoState({
      id: '/repo',
      instanceId: 'repo-instance-test',
      branches: [createRepoBranch('main')],
      currentBranch: 'main',
      selectedBranch: 'main',
    })
    seedRepoState({ id: '/repo', instanceId: 'repo-instance-test-2' })

    persistRepoSnapshotCacheEntry(useReposStore.setState, staleRepo, 'repo-instance-test')

    expect(useReposStore.getState().repoSnapshotCache['/repo']).toBeUndefined()
  })

  test('persists branch references without dynamic worktree or pull request state', () => {
    const repo = seedRepoState({
      id: '/repo',
      instanceId: 'repo-instance-test',
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
      selectedBranch: 'feature/a',
    })

    persistRepoSnapshotCacheEntry(useReposStore.setState, repo, 'repo-instance-test')

    const cached = useReposStore.getState().repoSnapshotCache['/repo']
    expect(cached?.data.branches[0]?.worktree).toEqual({ path: '/tmp/worktree-a' })
    expect(cached?.data.branches[0]?.pullRequest).toBeUndefined()
  })

  test('persists the React Query branch read model when it is newer than the store projection', () => {
    const repo = seedRepoState({
      id: '/repo',
      instanceId: 'repo-instance-test',
      branches: [createRepoBranch('main')],
      currentBranch: 'main',
      selectedBranch: 'main',
    })
    setRepoSnapshotQueryData('/repo', repo.instanceId, {
      current: 'feature/query',
      branches: [createBranchSnapshot('feature/query', { isCurrent: true })],
    })

    persistRepoSnapshotCacheEntry(useReposStore.setState, repo, 'repo-instance-test')

    const cached = useReposStore.getState().repoSnapshotCache['/repo']
    expect(cached?.data.currentBranch).toBe('feature/query')
    expect(cached?.data.branches.map((branch) => branch.name)).toEqual(['feature/query'])
  })
})

describe('restoreRepoProjectionFromCacheEntry', () => {
  test('hydrates branch references without restoring dynamic worktree or pull request state', () => {
    const now = Date.now()
    const cached = cachedRepo(now)
    cached.data.branches = [
      createBranchSnapshot('feature/a', {
        worktree: { path: '/tmp/worktree-a' },
        pullRequest: {
          number: 2,
          title: 'PR 2',
          url: 'https://github.com/acme/repo/pull/2',
          state: 'open',
          mergeable: 'UNKNOWN',
        },
      }),
    ]

    const repo = restoreRepoProjectionFromCacheEntry(emptyRepo('/repo', 'repo', 'repo-instance-test'), cached)

    expect(repo.data.branches[0]?.worktree).toEqual({ path: '/tmp/worktree-a' })
    expect(repo.data.branches[0]?.pullRequest).toBeUndefined()
    expect(repo.data.statusLoaded).toBe(false)
    expect(repo.data.status).toEqual([])
  })
})
