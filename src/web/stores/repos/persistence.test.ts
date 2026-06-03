import { beforeEach, describe, expect, test } from 'vitest'
import { hydrateCachedRepo, normalizeRepoCache, persistRepoCache } from '#/web/stores/repos/persistence.ts'
import { emptyRepo } from '#/web/stores/repos/helpers.ts'
import {
  createBranchSnapshot,
  createRepoBranch,
  resetReposStore,
  seedRepoState,
} from '#/web/stores/repos/test-utils.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { CachedRepoState } from '#/web/stores/repos/types.ts'
function cachedRepo(savedAt: number): CachedRepoState {
  return {
    savedAt,
    name: 'repo',
    data: {
      branches: [],
      currentBranch: '',
      status: [],
      statusLoaded: false,
      worktreesByPath: {},
    },
    ui: {
      selectedBranch: null,
      branchViewMode: 'all',
      detailTab: 'status',
    },
  }
}

beforeEach(resetReposStore)

describe('normalizeRepoCache', () => {
  test('keeps only the newest 50 valid cache entries', () => {
    const now = Date.now()
    const raw = Object.fromEntries(
      Array.from({ length: 55 }, (_, index) => [`/repo-${index}`, cachedRepo(now + index)]),
    )

    const normalized = normalizeRepoCache(raw)

    expect(Object.keys(normalized)).toHaveLength(50)
    expect(normalized['/repo-0']).toBeUndefined()
    expect(normalized['/repo-4']).toBeUndefined()
    expect(normalized['/repo-5']).toBeDefined()
    expect(Object.keys(normalized)[0]).toBe('/repo-54')
  })

  test('drops expired and invalid cache entries', () => {
    const now = Date.now()
    const normalized = normalizeRepoCache({
      fresh: cachedRepo(now),
      expired: cachedRepo(now - 15 * 24 * 60 * 60 * 1000),
      invalid: { savedAt: now, name: 'repo' },
    })

    expect(Object.keys(normalized)).toEqual(['fresh'])
  })

  test('does not restore terminal detail tabs from cache', () => {
    const now = Date.now()
    const raw = cachedRepo(now) as any
    raw.ui.detailTab = 'terminal'

    const normalized = normalizeRepoCache({ repo: raw })

    expect(normalized.repo?.ui.detailTab).toBe('terminal')
  })

  test('normalizes cached branch worktree metadata into canonical worktree state', () => {
    const now = Date.now()
    const raw = cachedRepo(now)
    raw.data.branches = [createRepoBranch('feature/a', { worktree: { path: '/tmp/worktree-a' } })]
    raw.data.worktreesByPath = {
      '/tmp/worktree-a': {
        path: '/tmp/worktree-a',
        branch: 'feature/a',
        isMain: true,
        isDirty: true,
        changeCount: 2,
        isLocked: true,
      },
    }

    const normalized = normalizeRepoCache({ repo: raw })

    expect(normalized.repo?.data.branches[0]?.worktree).toEqual({ path: '/tmp/worktree-a' })
    expect(normalized.repo?.data.worktreesByPath['/tmp/worktree-a']).toMatchObject({
      isMain: true,
      isDirty: true,
      changeCount: 2,
      isLocked: true,
    })
  })
})

describe('persistRepoCache', () => {
  test('does not write a stale cache entry after the repo instance changes', () => {
    const staleRepo = seedRepoState({
      id: '/repo',
      instanceToken: 1,
      branches: [createRepoBranch('main')],
      currentBranch: 'main',
      selectedBranch: 'main',
    })
    seedRepoState({ id: '/repo', instanceToken: 2 })

    persistRepoCache(useReposStore.setState, staleRepo, 1)

    expect(useReposStore.getState().repoCache['/repo']).toBeUndefined()
  })

  test('persists worktree state outside branch state', () => {
    const repo = seedRepoState({
      id: '/repo',
      instanceToken: 1,
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
        }),
      ],
      currentBranch: 'feature/a',
      selectedBranch: 'feature/a',
    })

    persistRepoCache(useReposStore.setState, repo, 1)

    const cached = useReposStore.getState().repoCache['/repo']
    expect(cached?.data.branches[0]?.worktree).toEqual({ path: '/tmp/worktree-a' })
    expect(cached?.data.worktreesByPath['/tmp/worktree-a']).toMatchObject({
      isMain: true,
      isLocked: true,
      isDirty: true,
      changeCount: 2,
    })
  })
})

describe('hydrateCachedRepo', () => {
  test('hydrates branches without restoring worktree metadata fields', () => {
    const now = Date.now()
    const cached = cachedRepo(now)
    cached.data.branches = [createBranchSnapshot('feature/a', { worktree: { path: '/tmp/worktree-a' } })]
    cached.data.worktreesByPath = {
      '/tmp/worktree-a': {
        path: '/tmp/worktree-a',
        branch: 'feature/a',
        isMain: false,
        isDirty: true,
        changeCount: 2,
      },
    }

    const repo = hydrateCachedRepo(emptyRepo('/repo', 'repo'), cached)

    expect(repo.data.branches[0]?.worktree).toEqual({ path: '/tmp/worktree-a' })
    expect(repo.data.worktreesByPath['/tmp/worktree-a']).toMatchObject({
      isDirty: true,
      changeCount: 2,
    })
  })
})
