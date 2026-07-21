import { beforeEach, describe, expect, test, vi } from 'vitest'
import { acceptRepoProjectionReadModel } from '#/web/stores/workspaces/projection-read-model-effects.ts'
import {
  createBranchSnapshot,
  createGitWorkspaceProbeForTest,
  installGoblinTestBridge,
  resetWorkspacesStore,
  seedRepoReadModelQueryData,
  seedRepoShellForTest,
} from '#/web/test-utils/bridge.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { setRepoProjectionQueryData } from '#/web/repo-query-cache.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import type { GitWorkspaceRuntimeProjection } from '#/shared/api-types.ts'
import { requireGitWorkspaceForTest } from '#/web/stores/workspaces/git-workspace-projection.test-utils.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace')

beforeEach(() => {
  resetWorkspacesStore()
  primaryWindowQueryClient.clear()
})

describe('repo projection read-model effects', () => {
  function acceptedProjection(
    branch: string | null = null,
    mode: 'summary' | 'full' = 'full',
  ): GitWorkspaceRuntimeProjection {
    const loadedAt = Date.now()
    return {
      snapshot: {
        branches: [createBranchSnapshot('feature/a'), createBranchSnapshot('feature/b')],
        current: 'feature/a',
      },
      pullRequests: null,
      requested: { branch, pullRequestMode: mode },
      loadedAt,
    }
  }

  test('snapshot success persists snapshot cache without triggering pull request summary backfill', () => {
    installGoblinTestBridge({})
    const repo = seedRepoShellForTest({
      id: WORKSPACE_ID,
      workspaceRuntimeId: 'repo-runtime-test-2',
      currentBranchName: 'feature/a',
      workspaceProbe: createGitWorkspaceProbeForTest(),
    })
    seedRepoReadModelQueryData(repo, {
      branches: [createBranchSnapshot('feature/a'), createBranchSnapshot('feature/b')],
      currentBranch: 'feature/a',
    })

    acceptRepoProjectionReadModel(
      useWorkspacesStore.setState,
      useWorkspacesStore.getState,
      {
        repoRoot: WORKSPACE_ID,
        workspaceRuntimeId: repo.workspaceRuntimeId,
        projection: acceptedProjection(),
      },
      { scope: 'repo-read-model' },
    )

    expect(useWorkspacesStore.getState().repoSnapshotCache[WORKSPACE_ID]).toMatchObject({
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
      id: WORKSPACE_ID,
      workspaceRuntimeId: 'repo-runtime-test-2',
      currentBranchName: 'feature/a',
      workspaceProbe: createGitWorkspaceProbeForTest(),
    })
    seedRepoReadModelQueryData(repo, {
      branches: [createBranchSnapshot('feature/a')],
      currentBranch: 'feature/a',
    })

    expect(() => {
      acceptRepoProjectionReadModel(
        useWorkspacesStore.setState,
        useWorkspacesStore.getState,
        {
          repoRoot: WORKSPACE_ID,
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
      id: WORKSPACE_ID,
      workspaceRuntimeId: 'repo-runtime-test-2',
      currentBranchName: 'feature/a',
      workspaceProbe: createGitWorkspaceProbeForTest(),
    })
    seedRepoReadModelQueryData(repo, {
      branches: [createBranchSnapshot('feature/a')],
      currentBranch: 'feature/a',
    })

    acceptRepoProjectionReadModel(
      useWorkspacesStore.setState,
      useWorkspacesStore.getState,
      {
        repoRoot: WORKSPACE_ID,
        workspaceRuntimeId: 'repo-runtime-stale',
        projection: acceptedProjection(),
      },
      { scope: 'repo-read-model' },
    )

    expect(pruneTerminals).not.toHaveBeenCalled()
    expect(useWorkspacesStore.getState().repoSnapshotCache[WORKSPACE_ID]).toBeUndefined()
  })

  test('same-millisecond core projection changes are accepted', () => {
    installGoblinTestBridge({})
    const repo = seedRepoShellForTest({
      id: WORKSPACE_ID,
      workspaceRuntimeId: 'repo-runtime-test-2',
      currentBranchName: 'feature/a',
      workspaceProbe: createGitWorkspaceProbeForTest(),
    })
    const loadedAt = 123
    const firstProjection: GitWorkspaceRuntimeProjection = {
      ...acceptedProjection(),
      snapshot: {
        branches: [createBranchSnapshot('feature/a')],
        current: 'feature/a',
      },
      loadedAt,
    }
    const secondProjection: GitWorkspaceRuntimeProjection = {
      ...firstProjection,
      snapshot: {
        branches: [createBranchSnapshot('feature/b')],
        current: 'feature/b',
      },
    }

    setRepoProjectionQueryData(WORKSPACE_ID, repo.workspaceRuntimeId, null, 'full', firstProjection)
    acceptRepoProjectionReadModel(
      useWorkspacesStore.setState,
      useWorkspacesStore.getState,
      {
        repoRoot: WORKSPACE_ID,
        workspaceRuntimeId: repo.workspaceRuntimeId,
        projection: firstProjection,
      },
      { scope: 'repo-read-model' },
    )

    setRepoProjectionQueryData(WORKSPACE_ID, repo.workspaceRuntimeId, null, 'full', secondProjection)
    acceptRepoProjectionReadModel(
      useWorkspacesStore.setState,
      useWorkspacesStore.getState,
      {
        repoRoot: WORKSPACE_ID,
        workspaceRuntimeId: repo.workspaceRuntimeId,
        projection: secondProjection,
      },
      { scope: 'repo-read-model' },
    )

    expect(useWorkspacesStore.getState().repoSnapshotCache[WORKSPACE_ID]).toMatchObject({
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
      id: WORKSPACE_ID,
      workspaceRuntimeId: 'repo-runtime-test-2',
      currentBranchName: 'feature/a',
      workspaceProbe: createGitWorkspaceProbeForTest(),
    })
    useWorkspacesStore.setState((state) => {
      const current = state.workspaces[WORKSPACE_ID]!
      const git = requireGitWorkspaceForTest(current).capability.git
      return {
        workspaces: {
          ...state.workspaces,
          [WORKSPACE_ID]: {
            ...current,
            capability: {
              ...current.capability,
              git: {
                ...git,
                dataLoads: {
                  ...git.dataLoads,
                  repoReadModel: { phase: 'loading', loadedAt: null, error: null, stale: false },
                },
              },
            },
          },
        },
      }
    })

    acceptRepoProjectionReadModel(
      useWorkspacesStore.setState,
      useWorkspacesStore.getState,
      {
        repoRoot: WORKSPACE_ID,
        workspaceRuntimeId: repo.workspaceRuntimeId,
        projection: acceptedProjection(null, 'summary'),
      },
      { scope: 'query-cache' },
    )

    expect(
      requireGitWorkspaceForTest(useWorkspacesStore.getState().workspaces[WORKSPACE_ID]).capability.git.dataLoads
        .repoReadModel,
    ).toMatchObject({
      phase: 'loading',
      loadedAt: null,
    })
    expect(useWorkspacesStore.getState().repoSnapshotCache[WORKSPACE_ID]).toBeUndefined()
    expect(pruneTerminals).not.toHaveBeenCalled()
  })
})
