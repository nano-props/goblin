// @vitest-environment jsdom
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useRepoProjectionQueryEffects } from '#/web/repo-projection-query-effects.ts'
import {
  invalidateRepoRuntimeProjectionQueries,
  getRepoOperationsQueryData,
  invalidateRepoDataQueries,
  repoOperationsQueryKey,
  repoProjectionQueryOptions,
  repoProjectionQueryKey,
  setRepoOperationsQueryData,
  setRepoProjectionQueryData,
} from '#/web/repo-data-query.ts'
import {
  createBranchSnapshot,
  installGoblinTestBridge,
  resetReposStore,
  seedRepoShellForTest,
} from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { RepoRuntimeProjection } from '#/shared/api-types.ts'

function Harness({ queryClient }: { queryClient?: QueryClient }) {
  useRepoProjectionQueryEffects(queryClient)
  return null
}

function projection(loadedAt: number, current = 'main'): RepoRuntimeProjection {
  return {
    snapshot: { branches: [createBranchSnapshot(current)], current },
    status: [],
    pullRequests: null,
    operations: { operations: [], loadedAt },
    requested: { branch: null, pullRequestMode: 'full' },
    loadedAt,
  }
}

describe('repo projection query effects', () => {
  beforeEach(() => {
    resetReposStore()
  })

  test('derives store side effects from accepted projection query data', async () => {
    const pruneTerminals = vi.fn(async () => ({ pruned: 0, remaining: 0 }))
    installGoblinTestBridge({ 'terminal.prune': pruneTerminals })
    const repo = seedRepoShellForTest({ id: '/repo', repoRuntimeId: 'repo-runtime-test-1' })
    renderInJsdom(<Harness />)

    setRepoProjectionQueryData('/repo', repo.repoRuntimeId, null, 'full', projection(123))

    await vi.waitFor(() => {
      expect(useReposStore.getState().repoSnapshotCache['/repo']).toMatchObject({
        data: { currentBranch: 'main', branches: [{ name: 'main' }] },
      })
    })
    await vi.waitFor(() => {
      expect(pruneTerminals).toHaveBeenCalled()
    })
  })

  test('ignores warm-start placeholder projection query data', () => {
    const pruneTerminals = vi.fn(async () => ({ pruned: 0, remaining: 0 }))
    installGoblinTestBridge({ 'terminal.prune': pruneTerminals })
    const repo = seedRepoShellForTest({ id: '/repo', repoRuntimeId: 'repo-runtime-test-1' })
    renderInJsdom(<Harness />)

    setRepoProjectionQueryData('/repo', repo.repoRuntimeId, null, 'full', projection(0))

    expect(useReposStore.getState().repoSnapshotCache['/repo']).toBeUndefined()
    expect(pruneTerminals).not.toHaveBeenCalled()
  })

  test('skips successes from projection fetches invalidated while in flight', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const pruneTerminals = vi.fn(async () => ({ pruned: 0, remaining: 0 }))
    installGoblinTestBridge({ 'terminal.prune': pruneTerminals })
    const repo = seedRepoShellForTest({ id: '/repo', repoRuntimeId: 'repo-runtime-test-1' })
    renderInJsdom(<Harness queryClient={queryClient} />)
    setRepoOperationsQueryData('/repo', repo.repoRuntimeId, false, { operations: [], loadedAt: 0 }, queryClient)
    const releases: Array<(projection: RepoRuntimeProjection) => void> = []
    const observer = new QueryObserver<RepoRuntimeProjection>(queryClient, {
      queryKey: repoProjectionQueryKey('/repo', repo.repoRuntimeId, null, 'full'),
      queryFn: () =>
        new Promise<RepoRuntimeProjection>((resolve) => {
          releases.push(resolve)
        }),
      staleTime: Number.POSITIVE_INFINITY,
    })
    const unsubscribe = observer.subscribe(() => {})
    try {
      await vi.waitFor(() => {
        expect(releases).toHaveLength(1)
      })

      invalidateRepoRuntimeProjectionQueries('/repo', repo.repoRuntimeId, queryClient)
      expect(queryClient.getQueryState(repoOperationsQueryKey('/repo', repo.repoRuntimeId))?.isInvalidated).toBe(true)
      releases[0]!(projection(1, 'stale'))
      await vi.waitFor(() => {
        expect(releases).toHaveLength(2)
      })

      expect(queryClient.getQueryState(repoOperationsQueryKey('/repo', repo.repoRuntimeId))?.isInvalidated).toBe(true)
      expect(getRepoOperationsQueryData('/repo', repo.repoRuntimeId, queryClient)?.loadedAt).toBe(0)
      expect(useReposStore.getState().repoSnapshotCache['/repo']).toBeUndefined()
      expect(pruneTerminals).not.toHaveBeenCalled()

      setRepoOperationsQueryData('/repo', repo.repoRuntimeId, false, { operations: [], loadedAt: 1 }, queryClient)
      expect(pruneTerminals).not.toHaveBeenCalled()

      invalidateRepoRuntimeProjectionQueries('/repo', repo.repoRuntimeId, queryClient)
      releases[1]!(projection(2, 'stale-rerun'))
      await vi.waitFor(() => {
        expect(releases).toHaveLength(3)
      })
      expect(pruneTerminals).not.toHaveBeenCalled()
      expect(getRepoOperationsQueryData('/repo', repo.repoRuntimeId, queryClient)?.loadedAt).toBe(1)

      releases[2]!(projection(3, 'fresh'))
      await vi.waitFor(() => {
        expect(pruneTerminals).toHaveBeenCalledTimes(1)
        expect(useReposStore.getState().repos['/repo']?.projection.source).toBe('fresh')
        expect(useReposStore.getState().repos['/repo']?.dataLoads.repoReadModel.loadedAt).toBe(3)
        expect(getRepoOperationsQueryData('/repo', repo.repoRuntimeId, queryClient)?.loadedAt).toBe(3)
      })
    } finally {
      unsubscribe()
      queryClient.clear()
    }
  })

  test('skips successes from projection fetches invalidated by repo data invalidations', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const pruneTerminals = vi.fn(async () => ({ pruned: 0, remaining: 0 }))
    installGoblinTestBridge({ 'terminal.prune': pruneTerminals })
    const repo = seedRepoShellForTest({ id: '/repo', repoRuntimeId: 'repo-runtime-test-1' })
    renderInJsdom(<Harness queryClient={queryClient} />)
    const releases: Array<(projection: RepoRuntimeProjection) => void> = []
    const observer = new QueryObserver<RepoRuntimeProjection>(queryClient, {
      queryKey: repoProjectionQueryKey('/repo', repo.repoRuntimeId, null, 'full'),
      queryFn: () =>
        new Promise<RepoRuntimeProjection>((resolve) => {
          releases.push(resolve)
        }),
      staleTime: Number.POSITIVE_INFINITY,
    })
    const unsubscribe = observer.subscribe(() => {})
    try {
      await vi.waitFor(() => {
        expect(releases).toHaveLength(1)
      })

      invalidateRepoDataQueries('/repo', repo.repoRuntimeId, queryClient)
      releases[0]!(projection(1, 'stale'))
      await vi.waitFor(() => {
        expect(releases).toHaveLength(2)
      })
      expect(pruneTerminals).not.toHaveBeenCalled()

      invalidateRepoDataQueries('/repo', repo.repoRuntimeId, queryClient)
      releases[1]!(projection(2, 'stale-rerun'))
      await vi.waitFor(() => {
        expect(releases).toHaveLength(3)
      })
      expect(pruneTerminals).not.toHaveBeenCalled()

      releases[2]!(projection(3, 'fresh'))
      await vi.waitFor(() => {
        expect(pruneTerminals).toHaveBeenCalledTimes(1)
        expect(useReposStore.getState().repos['/repo']?.dataLoads.repoReadModel.loadedAt).toBe(3)
      })
    } finally {
      unsubscribe()
      queryClient.clear()
    }
  })

  test('rejects stale projection successes when the effect mounts after the fetch started', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const pruneTerminals = vi.fn(async () => ({ pruned: 0, remaining: 0 }))
    const releases: Array<(projection: RepoRuntimeProjection) => void> = []
    installGoblinTestBridge({
      'terminal.prune': pruneTerminals,
      'repo.projection': () =>
        new Promise<RepoRuntimeProjection>((resolve) => {
          releases.push(resolve)
        }),
    })
    const repo = seedRepoShellForTest({ id: '/repo', repoRuntimeId: 'repo-runtime-test-1' })
    const observer = new QueryObserver(queryClient, repoProjectionQueryOptions('/repo', repo.repoRuntimeId, null, 'full'))
    const unsubscribe = observer.subscribe(() => {})
    try {
      await vi.waitFor(() => {
        expect(releases).toHaveLength(1)
      })

      invalidateRepoRuntimeProjectionQueries('/repo', repo.repoRuntimeId, queryClient)
      renderInJsdom(<Harness queryClient={queryClient} />)
      releases[0]!(projection(1, 'stale'))

      await vi.waitFor(() => {
        expect(releases).toHaveLength(2)
      })
      expect(observer.getCurrentResult().data).toBeUndefined()
      expect(useReposStore.getState().repoSnapshotCache['/repo']).toBeUndefined()
      expect(pruneTerminals).not.toHaveBeenCalled()

      releases[1]!(projection(2, 'fresh'))
      await vi.waitFor(() => {
        expect(observer.getCurrentResult().data?.loadedAt).toBe(2)
      })
    } finally {
      unsubscribe()
      queryClient.clear()
    }
  })
})
