// @vitest-environment jsdom
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useRepoProjectionQueryEffects } from '#/web/repo-projection-query-effects.ts'
import {
  invalidateRepoRuntimeProjectionQueries,
  getRepoOperationsQueryData,
  invalidateRepoDataQueries,
  repoProjectionQueryOptions,
  repoProjectionQueryKey,
  setRepoOperationsQueryData,
} from '#/web/repo-data-query.ts'
import {
  createBranchSnapshot,
  installGoblinTestBridge,
  resetWorkspacesStore,
  seedRepoShellForTest,
} from '#/web/test-utils/bridge.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type { WorkspaceRuntimeProjection } from '#/shared/api-types.ts'

function Harness({ queryClient }: { queryClient?: QueryClient }) {
  useRepoProjectionQueryEffects(queryClient)
  return null
}

function projection(loadedAt: number, current = 'main'): WorkspaceRuntimeProjection {
  return {
    snapshot: { branches: [createBranchSnapshot(current)], current },
    pullRequests: null,
    operations: { operations: [], loadedAt },
    requested: { branch: null, pullRequestMode: 'full' },
    loadedAt,
  }
}

describe('repo projection query effects', () => {
  beforeEach(() => {
    resetWorkspacesStore()
  })

  test('copies fetched projection operations into the active operations cache', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const pruneTerminals = vi.fn(async () => ({ pruned: 0, remaining: 0 }))
    installGoblinTestBridge({ 'terminal.prune': pruneTerminals })
    const repo = seedRepoShellForTest({ id: 'goblin+file:///repo', workspaceRuntimeId: 'repo-runtime-test-1' })
    renderInJsdom(<Harness queryClient={queryClient} />)

    try {
      await queryClient.fetchQuery({
        queryKey: repoProjectionQueryKey('goblin+file:///repo', repo.workspaceRuntimeId, null, 'full'),
        queryFn: async () => projection(123),
        staleTime: Number.POSITIVE_INFINITY,
      })

      await vi.waitFor(() => {
        expect(getRepoOperationsQueryData('goblin+file:///repo', repo.workspaceRuntimeId, queryClient)?.loadedAt).toBe(
          123,
        )
      })
      expect(useWorkspacesStore.getState().repoSnapshotCache['goblin+file:///repo']).toBeUndefined()
      expect(pruneTerminals).not.toHaveBeenCalled()
    } finally {
      queryClient.clear()
    }
  })

  test('ignores warm-start placeholder projection query data', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const pruneTerminals = vi.fn(async () => ({ pruned: 0, remaining: 0 }))
    installGoblinTestBridge({ 'terminal.prune': pruneTerminals })
    const repo = seedRepoShellForTest({ id: 'goblin+file:///repo', workspaceRuntimeId: 'repo-runtime-test-1' })
    renderInJsdom(<Harness queryClient={queryClient} />)

    try {
      await queryClient.fetchQuery({
        queryKey: repoProjectionQueryKey('goblin+file:///repo', repo.workspaceRuntimeId, null, 'full'),
        queryFn: async () => projection(0),
        staleTime: Number.POSITIVE_INFINITY,
      })

      expect(getRepoOperationsQueryData('goblin+file:///repo', repo.workspaceRuntimeId, queryClient)).toBeUndefined()
      expect(useWorkspacesStore.getState().repoSnapshotCache['goblin+file:///repo']).toBeUndefined()
      expect(pruneTerminals).not.toHaveBeenCalled()
    } finally {
      queryClient.clear()
    }
  })

  test('skips projection fetches invalidated while in flight', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const pruneTerminals = vi.fn(async () => ({ pruned: 0, remaining: 0 }))
    const releases: Array<(projection: WorkspaceRuntimeProjection) => void> = []
    installGoblinTestBridge({
      'terminal.prune': pruneTerminals,
      'repo.projection': () =>
        new Promise<WorkspaceRuntimeProjection>((resolve) => {
          releases.push(resolve)
        }),
    })
    const repo = seedRepoShellForTest({ id: 'goblin+file:///repo', workspaceRuntimeId: 'repo-runtime-test-1' })
    renderInJsdom(<Harness queryClient={queryClient} />)
    setRepoOperationsQueryData(
      'goblin+file:///repo',
      repo.workspaceRuntimeId,
      false,
      { operations: [], loadedAt: 0 },
      queryClient,
    )
    const observer = new QueryObserver(
      queryClient,
      repoProjectionQueryOptions('goblin+file:///repo', repo.workspaceRuntimeId, null, 'full'),
    )
    const unsubscribe = observer.subscribe(() => {})
    try {
      await vi.waitFor(() => {
        expect(releases).toHaveLength(1)
      })

      invalidateRepoRuntimeProjectionQueries('goblin+file:///repo', repo.workspaceRuntimeId, queryClient)
      releases[0]!(projection(1, 'stale'))
      await vi.waitFor(() => {
        expect(releases).toHaveLength(2)
      })

      expect(getRepoOperationsQueryData('goblin+file:///repo', repo.workspaceRuntimeId, queryClient)?.loadedAt).toBe(0)
      expect(useWorkspacesStore.getState().repoSnapshotCache['goblin+file:///repo']).toBeUndefined()
      expect(pruneTerminals).not.toHaveBeenCalled()

      releases[1]!(projection(2, 'fresh'))
      await vi.waitFor(() => {
        expect(getRepoOperationsQueryData('goblin+file:///repo', repo.workspaceRuntimeId, queryClient)?.loadedAt).toBe(
          2,
        )
      })
      expect(useWorkspacesStore.getState().repoSnapshotCache['goblin+file:///repo']).toBeUndefined()
      expect(pruneTerminals).not.toHaveBeenCalled()
    } finally {
      unsubscribe()
      queryClient.clear()
    }
  })

  test('skips projection fetches invalidated by repo data invalidations', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const pruneTerminals = vi.fn(async () => ({ pruned: 0, remaining: 0 }))
    const releases: Array<(projection: WorkspaceRuntimeProjection) => void> = []
    installGoblinTestBridge({
      'terminal.prune': pruneTerminals,
      'repo.projection': () =>
        new Promise<WorkspaceRuntimeProjection>((resolve) => {
          releases.push(resolve)
        }),
    })
    const repo = seedRepoShellForTest({ id: 'goblin+file:///repo', workspaceRuntimeId: 'repo-runtime-test-1' })
    renderInJsdom(<Harness queryClient={queryClient} />)
    setRepoOperationsQueryData(
      'goblin+file:///repo',
      repo.workspaceRuntimeId,
      false,
      { operations: [], loadedAt: 0 },
      queryClient,
    )
    const observer = new QueryObserver(
      queryClient,
      repoProjectionQueryOptions('goblin+file:///repo', repo.workspaceRuntimeId, null, 'full'),
    )
    const unsubscribe = observer.subscribe(() => {})
    try {
      await vi.waitFor(() => {
        expect(releases).toHaveLength(1)
      })

      invalidateRepoDataQueries('goblin+file:///repo', repo.workspaceRuntimeId, queryClient)
      releases[0]!(projection(1, 'stale'))
      await vi.waitFor(() => {
        expect(releases).toHaveLength(2)
      })
      expect(pruneTerminals).not.toHaveBeenCalled()
      expect(getRepoOperationsQueryData('goblin+file:///repo', repo.workspaceRuntimeId, queryClient)?.loadedAt).toBe(0)

      invalidateRepoDataQueries('goblin+file:///repo', repo.workspaceRuntimeId, queryClient)
      releases[1]!(projection(2, 'stale-rerun'))
      await vi.waitFor(() => {
        expect(releases).toHaveLength(3)
      })
      expect(pruneTerminals).not.toHaveBeenCalled()
      expect(getRepoOperationsQueryData('goblin+file:///repo', repo.workspaceRuntimeId, queryClient)?.loadedAt).toBe(0)

      releases[2]!(projection(3, 'fresh'))
      await vi.waitFor(() => {
        expect(getRepoOperationsQueryData('goblin+file:///repo', repo.workspaceRuntimeId, queryClient)?.loadedAt).toBe(
          3,
        )
      })
      expect(useWorkspacesStore.getState().repoSnapshotCache['goblin+file:///repo']).toBeUndefined()
      expect(pruneTerminals).not.toHaveBeenCalled()
    } finally {
      unsubscribe()
      queryClient.clear()
    }
  })

  test('rejects stale projection successes when the effect mounts after the fetch started', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const pruneTerminals = vi.fn(async () => ({ pruned: 0, remaining: 0 }))
    const releases: Array<(projection: WorkspaceRuntimeProjection) => void> = []
    installGoblinTestBridge({
      'terminal.prune': pruneTerminals,
      'repo.projection': () =>
        new Promise<WorkspaceRuntimeProjection>((resolve) => {
          releases.push(resolve)
        }),
    })
    const repo = seedRepoShellForTest({ id: 'goblin+file:///repo', workspaceRuntimeId: 'repo-runtime-test-1' })
    const observer = new QueryObserver(
      queryClient,
      repoProjectionQueryOptions('goblin+file:///repo', repo.workspaceRuntimeId, null, 'full'),
    )
    const unsubscribe = observer.subscribe(() => {})
    try {
      await vi.waitFor(() => {
        expect(releases).toHaveLength(1)
      })

      invalidateRepoRuntimeProjectionQueries('goblin+file:///repo', repo.workspaceRuntimeId, queryClient)
      renderInJsdom(<Harness queryClient={queryClient} />)
      releases[0]!(projection(1, 'stale'))

      await vi.waitFor(() => {
        expect(releases).toHaveLength(2)
      })
      expect(observer.getCurrentResult().data).toBeUndefined()
      expect(useWorkspacesStore.getState().repoSnapshotCache['goblin+file:///repo']).toBeUndefined()
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
