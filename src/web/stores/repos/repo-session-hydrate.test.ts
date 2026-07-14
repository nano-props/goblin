import { beforeEach, describe, expect, test } from 'vitest'
import { localRepoSessionEntry } from '#/shared/remote-repo.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { readRepoBranchQueryProjection } from '#/web/repo-branch-read-model.ts'
import { repoRuntimesQueryKey } from '#/web/repo-runtime-query.ts'
import {
  workspacePaneTabsQueryKey,
  type WorkspacePaneTabsQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import type { RepoRuntimesSnapshot, WorkspaceRuntimeRestoreSnapshot } from '#/shared/api-types.ts'
import {
  branchSnapshot,
  installGoblin,
  REPO_A,
  REPO_B,
  resetLifecycleTest,
} from '#/web/stores/repos/repo-session-test-utils.ts'

beforeEach(resetLifecycleTest)

describe('repo session hydration', () => {
  test('hydrateRestoredWorkspaceRuntime applies the server canonical snapshot as client projection', async () => {
    installGoblin({
      projection: () => new Promise(() => {}),
    })
    primaryWindowQueryClient.setQueryData<RepoRuntimesSnapshot>(repoRuntimesQueryKey(), {
      runtimes: [{ repoRoot: REPO_B, repoRuntimeId: 'repo-runtime-other-window' }],
    })
    const runtime: WorkspaceRuntimeRestoreSnapshot = {
      repos: [
        {
          entry: localRepoSessionEntry(REPO_A),
          repoRoot: REPO_A,
          repoRuntimeId: 'repo-runtime-server-a',
          name: 'server-a',
          projection: {
            snapshot: { branches: [branchSnapshot('server-main')], current: 'server-main' },
            status: [],
            pullRequests: null,
            operations: { operations: [], loadedAt: 0 },
            requested: { branch: null, pullRequestMode: 'full' },
            loadedAt: 10,
          },
        },
      ],
      workspacePaneTabs: [
        { repoRoot: REPO_A, repoRuntimeId: 'repo-runtime-server-a', snapshot: { revision: 2, entries: [] } },
      ],
      restoredRepoId: REPO_A,
    }

    await useReposStore.getState().hydrateRestoredWorkspaceRuntime(runtime)

    const repo = useReposStore.getState().repos[REPO_A]
    expect(repo?.repoRuntimeId).toBe('repo-runtime-server-a')
    expect(repo?.session).toEqual({
      entry: localRepoSessionEntry(REPO_A),
      projectionState: 'projected',
    })
    expect(useReposStore.getState().order).toEqual([REPO_A])
    expect(useReposStore.getState().restoredRepoId).toBe(REPO_A)
    expect(useReposStore.getState().workspaceMembershipReady).toBe(true)
    expect(readRepoBranchQueryProjection(repo!)?.currentBranch).toBe('server-main')
    expect(primaryWindowQueryClient.getQueryData<RepoRuntimesSnapshot>(repoRuntimesQueryKey())).toEqual({
      runtimes: [
        { repoRoot: REPO_B, repoRuntimeId: 'repo-runtime-other-window' },
        { repoRoot: REPO_A, repoRuntimeId: 'repo-runtime-server-a' },
      ],
    })
    expect(
      primaryWindowQueryClient.getQueryData<WorkspacePaneTabsQueryData>(
        workspacePaneTabsQueryKey(REPO_A, 'repo-runtime-server-a'),
      ),
    ).toEqual({ revision: 2, entries: [] })
  })

  test('hydrateRestoredWorkspaceRuntime clears the workspace restore skeleton for an empty snapshot', async () => {
    await useReposStore
      .getState()
      .hydrateRestoredWorkspaceRuntime({ repos: [], workspacePaneTabs: [], restoredRepoId: null })

    expect(useReposStore.getState().order).toEqual([])
    expect(useReposStore.getState().restoredRepoId).toBeNull()
    expect(useReposStore.getState().workspaceMembershipReady).toBe(true)
  })

  test('hydrateRestoredWorkspaceRuntime keeps stub state explicit when warm cache seeds loadedAt', async () => {
    const savedAt = Date.now()
    useReposStore.setState({
      repoSnapshotCache: {
        [REPO_A]: {
          savedAt,
          name: 'cached-a',
          data: {
            branches: [branchSnapshot('cached-main')],
            currentBranch: 'cached-main',
          },
          ui: { branchViewMode: 'all' },
        },
      },
    })

    await useReposStore.getState().hydrateRestoredWorkspaceRuntime({
      repos: [
        {
          entry: localRepoSessionEntry(REPO_A),
          repoRoot: REPO_A,
          repoRuntimeId: 'repo-runtime-server-a',
          name: 'server-a',
          projection: null,
        },
      ],
      workspacePaneTabs: [],
      restoredRepoId: REPO_A,
    })

    const repo = useReposStore.getState().repos[REPO_A]
    expect(repo?.session).toEqual({
      entry: localRepoSessionEntry(REPO_A),
      projectionState: 'stub',
    })
    expect(repo?.dataLoads.repoReadModel.loadedAt).toBe(savedAt)
  })
})
