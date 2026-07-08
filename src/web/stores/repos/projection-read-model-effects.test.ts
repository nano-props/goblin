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
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { RepoRuntimeProjection } from '#/shared/api-types.ts'

beforeEach(() => {
  resetReposStore()
  primaryWindowQueryClient.clear()
})

describe('repo projection read-model effects', () => {
  function acceptedProjection(): RepoRuntimeProjection {
    return {
      snapshot: {
        branches: [createBranchSnapshot('feature/a'), createBranchSnapshot('feature/b')],
        current: 'feature/a',
      },
      status: [],
      pullRequests: null,
      operations: { operations: [], loadedAt: Date.now() },
      requested: { branch: null, pullRequestMode: 'full' },
      loadedAt: Date.now(),
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

    acceptRepoProjectionReadModel(useReposStore.setState, useReposStore.getState, {
      repoRoot: '/repo',
      repoRuntimeId: repo.repoRuntimeId,
      projection: acceptedProjection(),
    })

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
      acceptRepoProjectionReadModel(useReposStore.setState, useReposStore.getState, {
        repoRoot: '/repo',
        repoRuntimeId: repo.repoRuntimeId,
        projection: acceptedProjection(),
      })
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

    acceptRepoProjectionReadModel(useReposStore.setState, useReposStore.getState, {
      repoRoot: '/repo',
      repoRuntimeId: 'repo-runtime-stale',
      projection: acceptedProjection(),
    })

    expect(pruneTerminals).not.toHaveBeenCalled()
    expect(useReposStore.getState().repoSnapshotCache['/repo']).toBeUndefined()
  })
})
