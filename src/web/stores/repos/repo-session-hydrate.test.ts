import { beforeEach, describe, expect, test } from 'vitest'
import { localRepoSessionEntry, normalizeRemoteTarget, remoteRepoSessionEntry } from '#/shared/remote-repo.ts'
import { useReposStore } from '#/web/stores/repos/store.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { readRepoBranchSnapshotQueryProjection } from '#/web/repo-branch-read-model.ts'
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
import { acceptRemoteLifecycleProjection } from '#/web/stores/repos/remote-lifecycle-projection.ts'
import { defaultClientWorkspaceState } from '#/shared/settings-defaults.ts'
import { workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'

beforeEach(resetLifecycleTest)

describe('repo session hydration', () => {
  test('restores a validated preferred tab for an eagerly projected repo', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({
      repoRoot: REPO_A,
      branchName: 'main',
      worktreePath: null,
    })
    await useReposStore.getState().hydrateRestoredWorkspaceRuntime(
      {
        repos: [
          {
            entry: localRepoSessionEntry(REPO_A),
            repoRoot: REPO_A,
            repoRuntimeId: 'repo-runtime-server-a',
            name: 'server-a',
            projection: {
              snapshot: { branches: [branchSnapshot('main')], current: 'main' },
              pullRequests: null,
              operations: { operations: [], loadedAt: 0 },
              requested: { branch: null, pullRequestMode: 'full' },
              loadedAt: 10,
            },
          },
        ],
        workspacePaneTabs: [
          {
            repoRoot: REPO_A,
            repoRuntimeId: 'repo-runtime-server-a',
            snapshot: {
              revision: 1,
              entries: [
                {
                  repoRoot: REPO_A,
                  branchName: 'main',
                  worktreePath: null,
                  tabs: [workspacePaneStaticTabEntry('history')],
                },
              ],
            },
          },
        ],
        restoredRepoId: REPO_A,
      },
      {
        restoredClientWorkspace: {
          ...defaultClientWorkspaceState(),
          preferredWorkspacePaneTabByTargetByRepo: { [REPO_A]: { [targetKey]: 'history' } },
        },
      },
    )

    expect(useReposStore.getState().repos[REPO_A]?.ui.preferredWorkspacePaneTabByTarget).toEqual({
      [targetKey]: 'history',
    })
    expect(
      useReposStore.getState().restoredClientWorkspaceBaseline?.preferredWorkspacePaneTabByTargetByRepo[REPO_A],
    ).toBeUndefined()
  })

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
    expect(readRepoBranchSnapshotQueryProjection(repo!)?.currentBranch).toBe('server-main')
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

  test('promotes only the matching existing stub without changing workspace membership', async () => {
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
    const projection = {
      snapshot: { branches: [branchSnapshot('main')], current: 'main' },
      pullRequests: null,
      operations: { operations: [], loadedAt: 0 },
      requested: { branch: null, pullRequestMode: 'full' as const },
      loadedAt: 10,
    }

    expect(
      useReposStore.getState().promoteRestoredWorkspaceRepo({
        repo: {
          entry: localRepoSessionEntry(REPO_A),
          repoRoot: REPO_A,
          repoRuntimeId: 'repo-runtime-server-a',
          name: 'server-a',
          projection,
        },
        snapshot: { revision: 3, entries: [] },
      }),
    ).toBe(true)

    const state = useReposStore.getState()
    expect(state.order).toEqual([REPO_A])
    expect(state.restoredRepoId).toBe(REPO_A)
    expect(state.repos[REPO_A]?.session.projectionState).toBe('projected')
    expect(readRepoBranchSnapshotQueryProjection(state.repos[REPO_A]!)?.currentBranch).toBe('main')
    expect(primaryWindowQueryClient.getQueryData(workspacePaneTabsQueryKey(REPO_A, 'repo-runtime-server-a'))).toEqual({
      revision: 3,
      entries: [],
    })
  })

  test('restores preferred tabs when a lazy repo is promoted', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({
      repoRoot: REPO_A,
      branchName: 'main',
      worktreePath: null,
    })
    await useReposStore.getState().hydrateRestoredWorkspaceRuntime(
      {
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
      },
      {
        restoredClientWorkspace: {
          ...defaultClientWorkspaceState(),
          preferredWorkspacePaneTabByTargetByRepo: { [REPO_A]: { [targetKey]: 'history' } },
        },
      },
    )

    useReposStore.getState().promoteRestoredWorkspaceRepo({
      repo: {
        entry: localRepoSessionEntry(REPO_A),
        repoRoot: REPO_A,
        repoRuntimeId: 'repo-runtime-server-a',
        name: 'server-a',
        projection: {
          snapshot: { branches: [branchSnapshot('main')], current: 'main' },
          pullRequests: null,
          operations: { operations: [], loadedAt: 0 },
          requested: { branch: null, pullRequestMode: 'full' },
          loadedAt: 10,
        },
      },
      snapshot: {
        revision: 1,
        entries: [
          {
            repoRoot: REPO_A,
            branchName: 'main',
            worktreePath: null,
            tabs: [workspacePaneStaticTabEntry('history')],
          },
        ],
      },
    })

    expect(useReposStore.getState().repos[REPO_A]?.ui.preferredWorkspacePaneTabByTarget).toEqual({
      [targetKey]: 'history',
    })
    expect(
      useReposStore.getState().restoredClientWorkspaceBaseline?.preferredWorkspacePaneTabByTargetByRepo[REPO_A],
    ).toBeUndefined()
  })

  test('rejects a late promotion after the stub closes or changes runtime epoch', async () => {
    await useReposStore.getState().hydrateRestoredWorkspaceRuntime({
      repos: [
        {
          entry: localRepoSessionEntry(REPO_A),
          repoRoot: REPO_A,
          repoRuntimeId: 'repo-runtime-old',
          name: 'server-a',
          projection: null,
        },
      ],
      workspacePaneTabs: [],
      restoredRepoId: REPO_A,
    })
    const result = {
      repo: {
        entry: localRepoSessionEntry(REPO_A),
        repoRoot: REPO_A,
        repoRuntimeId: 'repo-runtime-old',
        name: 'server-a',
        projection: {
          snapshot: { branches: [branchSnapshot('main')], current: 'main' },
          pullRequests: null,
          operations: { operations: [], loadedAt: 0 },
          requested: { branch: null, pullRequestMode: 'full' as const },
          loadedAt: 10,
        },
      },
      snapshot: null,
    }

    useReposStore.setState((state) => ({
      repos: {
        ...state.repos,
        [REPO_A]: { ...state.repos[REPO_A]!, repoRuntimeId: 'repo-runtime-new' },
      },
    }))
    expect(useReposStore.getState().promoteRestoredWorkspaceRepo(result)).toBe(false)
    expect(useReposStore.getState().repos[REPO_A]?.session.projectionState).toBe('stub')

    useReposStore.setState({ repos: {}, order: [], restoredRepoId: null })
    expect(useReposStore.getState().promoteRestoredWorkspaceRepo(result)).toBe(false)
    expect(useReposStore.getState().repos[REPO_A]).toBeUndefined()
    expect(useReposStore.getState().order).toEqual([])
  })

  test('does not overwrite a newer remote lifecycle while promoting projection state', async () => {
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.test',
      user: 'developer',
      port: 22,
      remotePath: '/repo',
    })!
    const entry = remoteRepoSessionEntry(target)
    const repoRuntimeId = 'repo-runtime-remote'
    await useReposStore.getState().hydrateRestoredWorkspaceRuntime({
      repos: [
        {
          entry,
          repoRoot: entry.id,
          repoRuntimeId,
          name: 'repo',
          projection: null,
        },
      ],
      workspacePaneTabs: [],
      restoredRepoId: entry.id,
    })
    expect(
      acceptRemoteLifecycleProjection(useReposStore.setState, useReposStore.getState, {
        repoRoot: entry.id,
        repoRuntimeId,
        remoteLifecycle: { kind: 'failed', attemptId: 5, reason: 'unreachable', target },
      }),
    ).toBe(true)

    expect(
      useReposStore.getState().promoteRestoredWorkspaceRepo({
        repo: {
          entry,
          repoRoot: entry.id,
          repoRuntimeId,
          name: 'repo',
          target,
          projection: {
            snapshot: { branches: [branchSnapshot('main')], current: 'main' },
            pullRequests: null,
            operations: { operations: [], loadedAt: 0 },
            requested: { branch: null, pullRequestMode: 'full' },
            loadedAt: 10,
          },
        },
        snapshot: null,
      }),
    ).toBe(true)

    expect(useReposStore.getState().repos[entry.id]?.session.projectionState).toBe('projected')
    expect(useReposStore.getState().repos[entry.id]?.remote).toMatchObject({
      lifecycleAttemptId: 5,
      lifecycle: { kind: 'failed', reason: 'unreachable', target },
    })
  })
})
