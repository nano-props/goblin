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
import type { WorkspaceRuntimeProjection } from '#/shared/api-types.ts'

beforeEach(() => {
  resetReposStore()
  primaryWindowQueryClient.clear()
})

describe('repo projection read-model effects', () => {
  function acceptedProjection(branch: string | null = null, mode: 'summary' | 'full' = 'full'): WorkspaceRuntimeProjection {
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
      id: 'goblin+file:///repo',
      workspaceRuntimeId: 'repo-runtime-test-2',
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
        repoRoot: 'goblin+file:///repo',
        workspaceRuntimeId: repo.workspaceRuntimeId,
        projection: acceptedProjection(),
      },
      { scope: 'repo-read-model' },
    )

    expect(useReposStore.getState().repoSnapshotCache['goblin+file:///repo']).toMatchObject({
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
      id: 'goblin+file:///repo',
      workspaceRuntimeId: 'repo-runtime-test-2',
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
          repoRoot: 'goblin+file:///repo',
          workspaceRuntimeId: repo.workspaceRuntimeId,
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
      id: 'goblin+file:///repo',
      workspaceRuntimeId: 'repo-runtime-test-2',
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
        repoRoot: 'goblin+file:///repo',
        workspaceRuntimeId: 'repo-runtime-stale',
        projection: acceptedProjection(),
      },
      { scope: 'repo-read-model' },
    )

    expect(pruneTerminals).not.toHaveBeenCalled()
    expect(useReposStore.getState().repoSnapshotCache['goblin+file:///repo']).toBeUndefined()
  })

  test('same-millisecond core projection changes are accepted', () => {
    installGoblinTestBridge({})
    const repo = seedRepoShellForTest({
      id: 'goblin+file:///repo',
      workspaceRuntimeId: 'repo-runtime-test-2',
      currentBranchName: 'feature/a',
    })
    const loadedAt = 123
    const firstProjection: WorkspaceRuntimeProjection = {
      ...acceptedProjection(),
      snapshot: {
        branches: [createBranchSnapshot('feature/a')],
        current: 'feature/a',
      },
      operations: { operations: [], loadedAt },
      loadedAt,
    }
    const secondProjection: WorkspaceRuntimeProjection = {
      ...firstProjection,
      snapshot: {
        branches: [createBranchSnapshot('feature/b')],
        current: 'feature/b',
      },
    }

    setRepoProjectionQueryData('goblin+file:///repo', repo.workspaceRuntimeId, null, 'full', firstProjection)
    acceptRepoProjectionReadModel(
      useReposStore.setState,
      useReposStore.getState,
      {
        repoRoot: 'goblin+file:///repo',
        workspaceRuntimeId: repo.workspaceRuntimeId,
        projection: firstProjection,
      },
      { scope: 'repo-read-model' },
    )

    setRepoProjectionQueryData('goblin+file:///repo', repo.workspaceRuntimeId, null, 'full', secondProjection)
    acceptRepoProjectionReadModel(
      useReposStore.setState,
      useReposStore.getState,
      {
        repoRoot: 'goblin+file:///repo',
        workspaceRuntimeId: repo.workspaceRuntimeId,
        projection: secondProjection,
      },
      { scope: 'repo-read-model' },
    )

    expect(useReposStore.getState().repoSnapshotCache['goblin+file:///repo']).toMatchObject({
      data: {
        currentBranch: 'feature/b',
        branches: [{ name: 'feature/b' }],
      },
    })
  })

  test('summary projections do not update the core read model cache', () => {
    const pruneTerminals = vi.fn(() => Promise.resolve({ pruned: 0, remaining: 0 }))
    installGoblinTestBridge({
      'terminal.prune': pruneTerminals,
    })
    const repo = seedRepoShellForTest({
      id: 'goblin+file:///repo',
      workspaceRuntimeId: 'repo-runtime-test-2',
      currentBranchName: 'feature/a',
    })
    useReposStore.setState((state) => {
      const current = state.repos['goblin+file:///repo']!
      return {
        repos: {
          ...state.repos,
          'goblin+file:///repo': {
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
        repoRoot: 'goblin+file:///repo',
        workspaceRuntimeId: repo.workspaceRuntimeId,
        projection: acceptedProjection(null, 'summary'),
      },
      { scope: 'query-cache' },
    )

    expect(useReposStore.getState().repos['goblin+file:///repo']?.dataLoads.repoReadModel).toMatchObject({
      phase: 'loading',
      loadedAt: null,
    })
    expect(useReposStore.getState().repoSnapshotCache['goblin+file:///repo']).toBeUndefined()
    expect(pruneTerminals).not.toHaveBeenCalled()
  })
})
