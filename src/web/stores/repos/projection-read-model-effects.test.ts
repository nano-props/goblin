import { beforeEach, describe, expect, test, vi } from 'vitest'
import { acceptRepoProjectionReadModel } from '#/web/stores/repos/projection-read-model-effects.ts'
import {
  createBranchSnapshot,
  installGoblinTestBridge,
  resetReposStore,
  seedRepoReadModelQueryData,
  seedRepoShellForTest,
} from '#/web/test-utils/bridge.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { setRepoProjectionQueryData } from '#/web/repo-data-query.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { RepoRuntimeProjection } from '#/shared/api-types.ts'

beforeEach(() => {
  resetReposStore()
  primaryWindowQueryClient.clear()
})

describe('repo projection read-model effects', () => {
  function acceptedProjection(branch: string | null = null, mode: 'summary' | 'full' = 'full'): RepoRuntimeProjection {
    const loadedAt = Date.now()
    return {
      snapshot: {
        branches: [createBranchSnapshot('feature/a'), createBranchSnapshot('feature/b')],
        current: 'feature/a',
      },
      pullRequests: null,
      operations: { operations: [], loadedAt },
      requested: { branch, pullRequestMode: mode },
      loadedAt,
    }
  }

  test('snapshot success persists snapshot cache without triggering pull request summary backfill', () => {
    installGoblinTestBridge({})
    const repo = seedRepoShellForTest({
      id: '/repo',
      repoRuntimeId: 'repo-runtime-test-2',
      currentBranchName: 'feature/a',
    })
    seedRepoReadModelQueryData(repo, {
      branches: [createBranchSnapshot('feature/a'), createBranchSnapshot('feature/b')],
      currentBranch: 'feature/a',
    })

    acceptRepoProjectionReadModel(
      useReposStore.setState,
      useReposStore.getState,
      {
        repoRoot: '/repo',
        repoRuntimeId: repo.repoRuntimeId,
        projection: acceptedProjection(),
      },
      { scope: 'repo-read-model' },
    )

    expect(useReposStore.getState().repoSnapshotCache['/repo']).toMatchObject({
      data: {
        currentBranch: 'feature/a',
        branches: [{ name: 'feature/a' }, { name: 'feature/b' }],
      },
    })
  })

  test('snapshot success does not block on terminal prune completion', () => {
    installGoblinTestBridge({
      'terminal.prune': async () => {
        await new Promise<void>(() => {})
        return { pruned: 0, remaining: 0 }
      },
    })
    const repo = seedRepoShellForTest({
      id: '/repo',
      repoRuntimeId: 'repo-runtime-test-2',
      currentBranchName: 'feature/a',
    })
    seedRepoReadModelQueryData(repo, {
      branches: [createBranchSnapshot('feature/a')],
      currentBranch: 'feature/a',
    })

    expect(() => {
      acceptRepoProjectionReadModel(
        useReposStore.setState,
        useReposStore.getState,
        {
          repoRoot: '/repo',
          repoRuntimeId: repo.repoRuntimeId,
          projection: acceptedProjection(),
        },
        { scope: 'repo-read-model' },
      )
    }).not.toThrow()
  })

  test('snapshot success skips side effects when the snapshot is stale', () => {
    const pruneTerminals = vi.fn(() => Promise.resolve({ pruned: 0, remaining: 0 }))
    installGoblinTestBridge({
      'terminal.prune': pruneTerminals,
    })
    const repo = seedRepoShellForTest({
      id: '/repo',
      repoRuntimeId: 'repo-runtime-test-2',
      currentBranchName: 'feature/a',
    })
    seedRepoReadModelQueryData(repo, {
      branches: [createBranchSnapshot('feature/a')],
      currentBranch: 'feature/a',
    })

    acceptRepoProjectionReadModel(
      useReposStore.setState,
      useReposStore.getState,
      {
        repoRoot: '/repo',
        repoRuntimeId: 'repo-runtime-stale',
        projection: acceptedProjection(),
      },
      { scope: 'repo-read-model' },
    )

    expect(pruneTerminals).not.toHaveBeenCalled()
    expect(useReposStore.getState().repoSnapshotCache['/repo']).toBeUndefined()
  })

  test('same-millisecond core projection changes are accepted', () => {
    installGoblinTestBridge({})
    const repo = seedRepoShellForTest({
      id: '/repo',
      repoRuntimeId: 'repo-runtime-test-2',
      currentBranchName: 'feature/a',
    })
    const loadedAt = 123
    const firstProjection: RepoRuntimeProjection = {
      ...acceptedProjection(),
      snapshot: {
        branches: [createBranchSnapshot('feature/a')],
        current: 'feature/a',
      },
      operations: { operations: [], loadedAt },
      loadedAt,
    }
    const secondProjection: RepoRuntimeProjection = {
      ...firstProjection,
      snapshot: {
        branches: [createBranchSnapshot('feature/b')],
        current: 'feature/b',
      },
    }

    setRepoProjectionQueryData('/repo', repo.repoRuntimeId, null, 'full', firstProjection)
    acceptRepoProjectionReadModel(
      useReposStore.setState,
      useReposStore.getState,
      {
        repoRoot: '/repo',
        repoRuntimeId: repo.repoRuntimeId,
        projection: firstProjection,
      },
      { scope: 'repo-read-model' },
    )

    setRepoProjectionQueryData('/repo', repo.repoRuntimeId, null, 'full', secondProjection)
    acceptRepoProjectionReadModel(
      useReposStore.setState,
      useReposStore.getState,
      {
        repoRoot: '/repo',
        repoRuntimeId: repo.repoRuntimeId,
        projection: secondProjection,
      },
      { scope: 'repo-read-model' },
    )

    expect(useReposStore.getState().repoSnapshotCache['/repo']).toMatchObject({
      data: {
        currentBranch: 'feature/b',
        branches: [{ name: 'feature/b' }],
      },
    })
  })

  test('projection acceptance does not settle the independently owned visible status load', () => {
    const repo = seedRepoShellForTest({
      id: '/repo',
      repoRuntimeId: 'repo-runtime-test-2',
      currentBranchName: 'feature/a',
    })
    useReposStore.setState((state) => {
      const current = state.repos['/repo']!
      return {
        repos: {
          ...state.repos,
          '/repo': {
            ...current,
            dataLoads: {
              ...current.dataLoads,
              visibleStatus: { phase: 'loading', loadedAt: null, error: null, stale: false },
            },
          },
        },
      }
    })
    const projection = acceptedProjection()

    acceptRepoProjectionReadModel(
      useReposStore.setState,
      useReposStore.getState,
      {
        repoRoot: '/repo',
        repoRuntimeId: repo.repoRuntimeId,
        projection,
      },
      { scope: 'repo-read-model' },
    )

    expect(useReposStore.getState().repos['/repo']?.dataLoads.visibleStatus).toMatchObject({
      phase: 'loading',
      loadedAt: null,
    })
  })

  test('summary projections do not update the core read model cache', () => {
    const pruneTerminals = vi.fn(() => Promise.resolve({ pruned: 0, remaining: 0 }))
    installGoblinTestBridge({
      'terminal.prune': pruneTerminals,
    })
    const repo = seedRepoShellForTest({
      id: '/repo',
      repoRuntimeId: 'repo-runtime-test-2',
      currentBranchName: 'feature/a',
    })
    useReposStore.setState((state) => {
      const current = state.repos['/repo']!
      return {
        repos: {
          ...state.repos,
          '/repo': {
            ...current,
            dataLoads: {
              ...current.dataLoads,
              repoReadModel: { phase: 'loading', loadedAt: null, error: null, stale: false },
            },
          },
        },
      }
    })

    acceptRepoProjectionReadModel(
      useReposStore.setState,
      useReposStore.getState,
      {
        repoRoot: '/repo',
        repoRuntimeId: repo.repoRuntimeId,
        projection: acceptedProjection(null, 'summary'),
      },
      { scope: 'query-cache' },
    )

    expect(useReposStore.getState().repos['/repo']?.dataLoads.repoReadModel).toMatchObject({
      phase: 'loading',
      loadedAt: null,
    })
    expect(useReposStore.getState().repoSnapshotCache['/repo']).toBeUndefined()
    expect(pruneTerminals).not.toHaveBeenCalled()
  })
})
