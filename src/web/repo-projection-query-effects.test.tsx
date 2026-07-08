// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderInJsdom } from '#/test-utils/render.tsx'
import { useRepoProjectionQueryEffects } from '#/web/repo-projection-query-effects.ts'
import { setRepoProjectionQueryData } from '#/web/repo-data-query.ts'
import {
  createBranchSnapshot,
  installGoblinTestBridge,
  resetReposStore,
  seedRepoShellForTest,
} from '#/web/test-utils/bridge.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import type { RepoRuntimeProjection } from '#/shared/api-types.ts'

function Harness() {
  useRepoProjectionQueryEffects()
  return null
}

function projection(loadedAt: number): RepoRuntimeProjection {
  return {
    snapshot: { branches: [createBranchSnapshot('main')], current: 'main' },
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
})
