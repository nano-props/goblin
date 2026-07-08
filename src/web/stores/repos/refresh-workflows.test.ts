import { beforeEach, describe, expect, test, vi } from 'vitest'
import { runSnapshotSuccessWorkflow } from '#/web/stores/repos/refresh-workflows.ts'
import {
  createBranchSnapshot,
  installGoblinTestBridge,
  resetReposStore,
  seedRepoReadModelQueryData,
  seedRepoShellForTest,
} from '#/web/test-utils/bridge.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'

beforeEach(() => {
  resetReposStore()
  primaryWindowQueryClient.clear()
})

describe('repo refresh workflows', () => {
  test('snapshot success persists snapshot cache without triggering pull request summary backfill', async () => {
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

    await runSnapshotSuccessWorkflow(useReposStore.setState, useReposStore.getState, {
      id: '/repo',
      repoRuntimeId: repo.repoRuntimeId,
      isSnapshotCurrent: () => true,
    })

    expect(useReposStore.getState().repoSnapshotCache['/repo']).toMatchObject({
      data: {
        currentBranch: 'feature/a',
        branches: [{ name: 'feature/a' }, { name: 'feature/b' }],
      },
    })
  })

  test('snapshot success does not block on terminal prune completion', async () => {
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

    await expect(
      runSnapshotSuccessWorkflow(useReposStore.setState, useReposStore.getState, {
        id: '/repo',
        repoRuntimeId: repo.repoRuntimeId,
        isSnapshotCurrent: () => true,
      }),
    ).resolves.toBeUndefined()
  })

  test('snapshot success skips side effects when the snapshot is stale', async () => {
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

    await runSnapshotSuccessWorkflow(useReposStore.setState, useReposStore.getState, {
      id: '/repo',
      repoRuntimeId: repo.repoRuntimeId,
      isSnapshotCurrent: () => false,
    })

    expect(pruneTerminals).not.toHaveBeenCalled()
    expect(useReposStore.getState().repoSnapshotCache['/repo']).toBeUndefined()
  })
})
