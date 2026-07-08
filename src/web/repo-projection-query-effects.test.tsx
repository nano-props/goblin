// @vitest-environment jsdom
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useRepoProjectionQueryEffects } from '#/web/repo-projection-query-effects.ts'
import {
  invalidateRepoRuntimeProjectionQueries,
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
      releases[0]!(projection(1, 'stale'))
      await vi.waitFor(() => {
        expect(releases).toHaveLength(2)
      })

      expect(useReposStore.getState().repoSnapshotCache['/repo']).toBeUndefined()
      expect(pruneTerminals).not.toHaveBeenCalled()

      setRepoOperationsQueryData('/repo', repo.repoRuntimeId, false, { operations: [], loadedAt: 99 }, queryClient)
      expect(pruneTerminals).not.toHaveBeenCalled()

      releases[1]!(projection(2, 'fresh'))
      await vi.waitFor(() => {
        expect(pruneTerminals).toHaveBeenCalledTimes(1)
        expect(useReposStore.getState().repos['/repo']?.projection.source).toBe('fresh')
        expect(useReposStore.getState().repos['/repo']?.dataLoads.repoReadModel.loadedAt).toBe(2)
      })
    } finally {
      unsubscribe()
      queryClient.clear()
    }
  })
})
