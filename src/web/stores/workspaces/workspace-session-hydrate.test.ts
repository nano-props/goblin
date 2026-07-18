import { beforeEach, describe, expect, test } from 'vitest'
import { localWorkspaceSessionEntry, normalizeRemoteTarget, remoteWorkspaceSessionEntry } from '#/shared/remote-repo.ts'
import { useWorkspacesStore } from '#/web/stores/workspaces/store.ts'
import { primaryWindowQueryClient } from '#/web/primary-window-queries.ts'
import { readRepoBranchSnapshotQueryProjection } from '#/web/repo-branch-read-model.ts'
import { workspaceRuntimesQueryKey } from '#/web/workspace-runtime-query.ts'
import {
  workspacePaneTabsQueryKey,
  type WorkspacePaneTabsQueryData,
} from '#/web/workspace-pane/workspace-pane-tabs-query.ts'
import type { WorkspaceRuntimesSnapshot, WorkspaceRuntimeRestoreSnapshot } from '#/shared/api-types.ts'
import {
  branchSnapshot,
  installGoblin,
  REPO_A,
  REPO_B,
  resetLifecycleTest,
} from '#/web/stores/workspaces/workspace-session-test-utils.ts'
import { acceptRemoteLifecycleProjection } from '#/web/stores/workspaces/remote-lifecycle-projection.ts'
import { defaultClientWorkspaceState } from '#/shared/settings-defaults.ts'
import { workspacePaneRuntimeTabEntry, workspacePaneStaticTabEntry } from '#/shared/workspace-pane.ts'
import { workspacePaneTabsTargetIdentityKey } from '#/shared/workspace-pane-tabs-target.ts'
import { runtimeWorkspacePaneTargetForTest } from '#/web/test-utils/workspace-pane-tabs.ts'

const GIT_WORKSPACE_PROBE = {
  status: 'ready' as const,
  name: 'workspace',
  capabilities: {
    files: { read: true as const, write: true },
    terminal: { available: true },
    git: { status: 'available' as const, worktrees: true, pullRequests: { provider: 'none' as const } },
  },
  diagnostics: [],
}
const DIRECTORY_WORKSPACE_PROBE = {
  ...GIT_WORKSPACE_PROBE,
  capabilities: { ...GIT_WORKSPACE_PROBE.capabilities, git: { status: 'unavailable' as const } },
}

beforeEach(resetLifecycleTest)

describe('repo session hydration', () => {
  test('restores a workspace-root terminal preference without a Git branch projection', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({ kind: 'workspace-root', repoRoot: REPO_A })
    await useWorkspacesStore.getState().hydrateRestoredWorkspaceRuntime(
      {
        workspaces: [
          {
            entry: localWorkspaceSessionEntry(REPO_A),
            workspaceId: REPO_A,
            workspaceRuntimeId: 'repo-runtime-server-a',
            name: 'directory-a',
            workspaceProbe: DIRECTORY_WORKSPACE_PROBE,
            projection: null,
          },
        ],
        workspacePaneTabs: [
          {
            workspaceId: REPO_A,
            workspaceRuntimeId: 'repo-runtime-server-a',
            snapshot: {
              revision: 1,
              entries: [
                {
                  target: runtimeWorkspacePaneTargetForTest({
                    kind: 'workspace-root',
                    repoRoot: REPO_A,
                    workspaceRuntimeId: 'repo-runtime-server-a',
                  }),
                  tabs: [workspacePaneRuntimeTabEntry('terminal', 'term-111111111111111111111')],
                },
              ],
            },
          },
        ],
        restoredWorkspaceId: REPO_A,
      },
      {
        restoredClientWorkspace: {
          ...defaultClientWorkspaceState(),
          preferredWorkspacePaneTabByTargetByWorkspace: { [REPO_A]: { [targetKey]: 'terminal' } },
        },
      },
    )

    expect(useWorkspacesStore.getState().workspaces[REPO_A]?.ui.preferredWorkspacePaneTabByTarget[targetKey]).toBe('terminal')
    expect(
      useWorkspacesStore.getState().restoredClientWorkspaceBaseline?.preferredWorkspacePaneTabByTargetByWorkspace[REPO_A],
    ).toBeUndefined()
  })

  test('restores a validated preferred tab for an eagerly projected repo', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({
      kind: 'git-branch' as const,
      repoRoot: REPO_A,
      branchName: 'main',
    })
    await useWorkspacesStore.getState().hydrateRestoredWorkspaceRuntime(
      {
        workspaces: [
          {
            entry: localWorkspaceSessionEntry(REPO_A),
            workspaceId: REPO_A,
            workspaceRuntimeId: 'repo-runtime-server-a',
            name: 'server-a',
            workspaceProbe: GIT_WORKSPACE_PROBE,
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
            workspaceId: REPO_A,
            workspaceRuntimeId: 'repo-runtime-server-a',
            snapshot: {
              revision: 1,
              entries: [
                {
                  target: runtimeWorkspacePaneTargetForTest({
                    kind: 'git-branch' as const,
                    repoRoot: REPO_A,
                    workspaceRuntimeId: 'repo-runtime-server-a',
                    branchName: 'main',
                  }),
                  tabs: [workspacePaneStaticTabEntry('history')],
                },
              ],
            },
          },
        ],
        restoredWorkspaceId: REPO_A,
      },
      {
        restoredClientWorkspace: {
          ...defaultClientWorkspaceState(),
          preferredWorkspacePaneTabByTargetByWorkspace: { [REPO_A]: { [targetKey]: 'history' } },
        },
      },
    )

    expect(useWorkspacesStore.getState().workspaces[REPO_A]?.ui.preferredWorkspacePaneTabByTarget).toEqual({
      [targetKey]: 'history',
    })
    expect(
      useWorkspacesStore.getState().restoredClientWorkspaceBaseline?.preferredWorkspacePaneTabByTargetByWorkspace[REPO_A],
    ).toBeUndefined()
  })

  test('hydrateRestoredWorkspaceRuntime applies the server canonical snapshot as client projection', async () => {
    installGoblin({
      projection: () => new Promise(() => {}),
    })
    primaryWindowQueryClient.setQueryData<WorkspaceRuntimesSnapshot>(workspaceRuntimesQueryKey(), {
      runtimes: [
        { workspaceId: REPO_B, workspaceRuntimeId: 'repo-runtime-other-window', workspaceProbe: { status: 'probing' } },
      ],
    })
    const runtime: WorkspaceRuntimeRestoreSnapshot = {
      workspaces: [
        {
          entry: localWorkspaceSessionEntry(REPO_A),
          workspaceId: REPO_A,
          workspaceRuntimeId: 'repo-runtime-server-a',
          name: 'server-a',
          workspaceProbe: GIT_WORKSPACE_PROBE,
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
        { workspaceId: REPO_A, workspaceRuntimeId: 'repo-runtime-server-a', snapshot: { revision: 2, entries: [] } },
      ],
      restoredWorkspaceId: REPO_A,
    }

    await useWorkspacesStore.getState().hydrateRestoredWorkspaceRuntime(runtime)

    const repo = useWorkspacesStore.getState().workspaces[REPO_A]
    expect(repo?.workspaceRuntimeId).toBe('repo-runtime-server-a')
    expect(repo?.session).toEqual({
      entry: localWorkspaceSessionEntry(REPO_A),
      projectionState: 'projected',
    })
    expect(useWorkspacesStore.getState().workspaceOrder).toEqual([REPO_A])
    expect(useWorkspacesStore.getState().restoredWorkspaceId).toBe(REPO_A)
    expect(useWorkspacesStore.getState().workspaceMembershipReady).toBe(true)
    expect(readRepoBranchSnapshotQueryProjection(repo!)?.currentBranch).toBe('server-main')
    expect(primaryWindowQueryClient.getQueryData<WorkspaceRuntimesSnapshot>(workspaceRuntimesQueryKey())).toEqual({
      runtimes: [
        { workspaceId: REPO_B, workspaceRuntimeId: 'repo-runtime-other-window', workspaceProbe: { status: 'probing' } },
        { workspaceId: REPO_A, workspaceRuntimeId: 'repo-runtime-server-a', workspaceProbe: { status: 'probing' } },
      ],
    })
    expect(
      primaryWindowQueryClient.getQueryData<WorkspacePaneTabsQueryData>(
        workspacePaneTabsQueryKey(REPO_A, 'repo-runtime-server-a'),
      ),
    ).toEqual({ revision: 2, entries: [] })
  })

  test('hydrateRestoredWorkspaceRuntime clears the workspace restore skeleton for an empty snapshot', async () => {
    await useWorkspacesStore
      .getState()
      .hydrateRestoredWorkspaceRuntime({ workspaces: [], workspacePaneTabs: [], restoredWorkspaceId: null })

    expect(useWorkspacesStore.getState().workspaceOrder).toEqual([])
    expect(useWorkspacesStore.getState().restoredWorkspaceId).toBeNull()
    expect(useWorkspacesStore.getState().workspaceMembershipReady).toBe(true)
  })

  test('hydrateRestoredWorkspaceRuntime keeps stub state explicit when warm cache seeds loadedAt', async () => {
    const savedAt = Date.now()
    useWorkspacesStore.setState({
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

    await useWorkspacesStore.getState().hydrateRestoredWorkspaceRuntime({
      workspaces: [
        {
          entry: localWorkspaceSessionEntry(REPO_A),
          workspaceId: REPO_A,
          workspaceRuntimeId: 'repo-runtime-server-a',
          name: 'server-a',
          workspaceProbe: GIT_WORKSPACE_PROBE,
          projection: null,
        },
      ],
      workspacePaneTabs: [],
      restoredWorkspaceId: REPO_A,
    })

    const repo = useWorkspacesStore.getState().workspaces[REPO_A]
    expect(repo?.session).toEqual({
      entry: localWorkspaceSessionEntry(REPO_A),
      projectionState: 'stub',
    })
    expect(repo?.dataLoads.repoReadModel.loadedAt).toBe(savedAt)
  })

  test('promotes only the matching existing stub without changing workspace membership', async () => {
    await useWorkspacesStore.getState().hydrateRestoredWorkspaceRuntime({
      workspaces: [
        {
          entry: localWorkspaceSessionEntry(REPO_A),
          workspaceId: REPO_A,
          workspaceRuntimeId: 'repo-runtime-server-a',
          name: 'server-a',
          workspaceProbe: GIT_WORKSPACE_PROBE,
          projection: null,
        },
      ],
      workspacePaneTabs: [],
      restoredWorkspaceId: REPO_A,
    })
    const projection = {
      snapshot: { branches: [branchSnapshot('main')], current: 'main' },
      pullRequests: null,
      operations: { operations: [], loadedAt: 0 },
      requested: { branch: null, pullRequestMode: 'full' as const },
      loadedAt: 10,
    }

    expect(
      useWorkspacesStore.getState().promoteRestoredWorkspace({
        workspace: {
          entry: localWorkspaceSessionEntry(REPO_A),
          workspaceId: REPO_A,
          workspaceRuntimeId: 'repo-runtime-server-a',
          name: 'server-a',
          workspaceProbe: GIT_WORKSPACE_PROBE,
          projection,
        },
        snapshot: { revision: 3, entries: [] },
      }),
    ).toBe(true)

    const state = useWorkspacesStore.getState()
    expect(state.workspaceOrder).toEqual([REPO_A])
    expect(state.restoredWorkspaceId).toBe(REPO_A)
    expect(state.workspaces[REPO_A]?.session.projectionState).toBe('projected')
    expect(readRepoBranchSnapshotQueryProjection(state.workspaces[REPO_A]!)?.currentBranch).toBe('main')
    expect(primaryWindowQueryClient.getQueryData(workspacePaneTabsQueryKey(REPO_A, 'repo-runtime-server-a'))).toEqual({
      revision: 3,
      entries: [],
    })
  })

  test('restores preferred tabs when a lazy repo is promoted', async () => {
    const targetKey = workspacePaneTabsTargetIdentityKey({
      kind: 'git-branch' as const,
      repoRoot: REPO_A,
      branchName: 'main',
    })
    await useWorkspacesStore.getState().hydrateRestoredWorkspaceRuntime(
      {
        workspaces: [
          {
            entry: localWorkspaceSessionEntry(REPO_A),
            workspaceId: REPO_A,
            workspaceRuntimeId: 'repo-runtime-server-a',
            name: 'server-a',
            workspaceProbe: GIT_WORKSPACE_PROBE,
            projection: null,
          },
        ],
        workspacePaneTabs: [],
        restoredWorkspaceId: REPO_A,
      },
      {
        restoredClientWorkspace: {
          ...defaultClientWorkspaceState(),
          preferredWorkspacePaneTabByTargetByWorkspace: { [REPO_A]: { [targetKey]: 'history' } },
        },
      },
    )

    useWorkspacesStore.getState().promoteRestoredWorkspace({
      workspace: {
        entry: localWorkspaceSessionEntry(REPO_A),
        workspaceId: REPO_A,
        workspaceRuntimeId: 'repo-runtime-server-a',
        name: 'server-a',
        workspaceProbe: GIT_WORKSPACE_PROBE,
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
            target: runtimeWorkspacePaneTargetForTest({
              kind: 'git-branch' as const,
              repoRoot: REPO_A,
              workspaceRuntimeId: 'repo-runtime-server-a',
              branchName: 'main',
            }),
            tabs: [workspacePaneStaticTabEntry('history')],
          },
        ],
      },
    })

    expect(useWorkspacesStore.getState().workspaces[REPO_A]?.ui.preferredWorkspacePaneTabByTarget).toEqual({
      [targetKey]: 'history',
    })
    expect(
      useWorkspacesStore.getState().restoredClientWorkspaceBaseline?.preferredWorkspacePaneTabByTargetByWorkspace[REPO_A],
    ).toBeUndefined()
  })

  test('rejects a late promotion after the stub closes or changes runtime epoch', async () => {
    await useWorkspacesStore.getState().hydrateRestoredWorkspaceRuntime({
      workspaces: [
        {
          entry: localWorkspaceSessionEntry(REPO_A),
          workspaceId: REPO_A,
          workspaceRuntimeId: 'repo-runtime-old',
          name: 'server-a',
          workspaceProbe: GIT_WORKSPACE_PROBE,
          projection: null,
        },
      ],
      workspacePaneTabs: [],
      restoredWorkspaceId: REPO_A,
    })
    const result = {
      workspace: {
        entry: localWorkspaceSessionEntry(REPO_A),
        workspaceId: REPO_A,
        workspaceRuntimeId: 'repo-runtime-old',
        name: 'server-a',
        workspaceProbe: GIT_WORKSPACE_PROBE,
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

    useWorkspacesStore.setState((state) => ({
      workspaces: {
        ...state.workspaces,
        [REPO_A]: { ...state.workspaces[REPO_A]!, workspaceRuntimeId: 'repo-runtime-new' },
      },
    }))
    expect(useWorkspacesStore.getState().promoteRestoredWorkspace(result)).toBe(false)
    expect(useWorkspacesStore.getState().workspaces[REPO_A]?.session.projectionState).toBe('stub')

    useWorkspacesStore.setState({ workspaces: {}, workspaceOrder: [], restoredWorkspaceId: null })
    expect(useWorkspacesStore.getState().promoteRestoredWorkspace(result)).toBe(false)
    expect(useWorkspacesStore.getState().workspaces[REPO_A]).toBeUndefined()
    expect(useWorkspacesStore.getState().workspaceOrder).toEqual([])
  })

  test('does not overwrite a newer remote lifecycle while promoting projection state', async () => {
    const target = normalizeRemoteTarget({
      alias: 'example',
      host: 'example.test',
      user: 'developer',
      port: 22,
      remotePath: '/repo',
    })!
    const entry = remoteWorkspaceSessionEntry(target)
    const workspaceRuntimeId = 'repo-runtime-remote'
    await useWorkspacesStore.getState().hydrateRestoredWorkspaceRuntime({
      workspaces: [
        {
          entry,
          workspaceId: entry.id,
          workspaceRuntimeId,
          name: 'repo',
          workspaceProbe: GIT_WORKSPACE_PROBE,
          projection: null,
        },
      ],
      workspacePaneTabs: [],
      restoredWorkspaceId: entry.id,
    })
    expect(
      acceptRemoteLifecycleProjection(useWorkspacesStore.setState, useWorkspacesStore.getState, {
        workspaceId: entry.id,
        workspaceRuntimeId,
        remoteLifecycle: { kind: 'failed', attemptId: 5, reason: 'unreachable', target },
      }),
    ).toBe(true)

    expect(
      useWorkspacesStore.getState().promoteRestoredWorkspace({
        workspace: {
          entry,
          workspaceId: entry.id,
          workspaceRuntimeId,
          name: 'repo',
          target,
          workspaceProbe: GIT_WORKSPACE_PROBE,
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

    expect(useWorkspacesStore.getState().workspaces[entry.id]?.session.projectionState).toBe('projected')
    expect(useWorkspacesStore.getState().workspaces[entry.id]?.remote).toMatchObject({
      lifecycleAttemptId: 5,
      lifecycle: { kind: 'failed', reason: 'unreachable', target },
    })
  })
})
