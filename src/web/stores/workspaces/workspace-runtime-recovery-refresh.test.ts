// @vitest-environment jsdom

import type { RepoSnapshotResponse } from '#/shared/api-types.ts'
import type { WorkspaceRefreshResult, WorkspaceSettledProbeState } from '#/shared/workspace-runtime.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'
import { workspacesStore } from '#/web/stores/workspaces/store.ts'
import { reconcileOpenWorkspaceRuntimeMemberships } from '#/web/stores/workspaces/workspace-runtime-membership-recovery.ts'
import {
  createBranchSnapshot,
  resetWorkspacesStore,
  seedRepoWithReadModelForTest,
} from '#/web/test-utils/repo-store.ts'
import { installGoblinTestBridge } from '#/web/test-utils/bridge.ts'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///tmp/runtime-recovery-refresh')
const NEXT_RUNTIME_ID = 'repo-runtime-recovery-refresh-123456789'

function readyGitProbe(): WorkspaceSettledProbeState {
  return {
    status: 'ready' as const,
    capabilities: {
      files: { read: true, write: true },
      terminal: { available: true },
      git: { status: 'available' as const, worktrees: true, pullRequests: { provider: 'none' as const } },
    },
    diagnostics: [],
  }
}

function repoSnapshotResponse(): RepoSnapshotResponse {
  return {
    snapshot: {
      branches: [createBranchSnapshot('main', { isCurrent: true })],
      current: 'main',
      remote: {
        remotes: [],
        hasRemotes: false,
        hasBrowserRemote: false,
        remoteProviders: {},
        hasGitHubRemote: false,
      },
    },
  }
}

describe('workspace runtime recovery Refresh boundary', () => {
  beforeEach(() => {
    resetWorkspacesStore()
    seedRepoWithReadModelForTest({ id: WORKSPACE_ID, branches: [], currentBranch: '' })
  })

  test('releases a changed local target only after the real Refresh commits its new-runtime projection', async () => {
    const refreshResponse = Promise.withResolvers<WorkspaceRefreshResult>()
    const refresh = vi.fn(() => refreshResponse.promise)
    const snapshot = vi.fn(async () => repoSnapshotResponse())
    installGoblinTestBridge({
      'workspace.runtimeReconcile': async () => ({
        runtimes: [
          {
            workspaceId: WORKSPACE_ID,
            workspaceRuntimeId: NEXT_RUNTIME_ID,
            workspaceProbe: { status: 'probing' as const },
          },
        ],
      }),
      'workspace.refresh': refresh,
      'repo.snapshot': snapshot,
    })

    let settled = false
    const recovery = reconcileOpenWorkspaceRuntimeMemberships(
      workspacesStore.setState,
      workspacesStore.getState,
    ).finally(() => {
      settled = true
    })
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce())

    expect(settled).toBe(false)
    expect(workspacesStore.getState().workspaces[WORKSPACE_ID]).toMatchObject({
      workspaceRuntimeId: NEXT_RUNTIME_ID,
      capability: { kind: 'probing' },
    })

    refreshResponse.resolve({ kind: 'committed', probe: readyGitProbe() })

    await expect(recovery).resolves.toMatchObject({
      kind: 'settled',
      targets: [{ workspaceId: WORKSPACE_ID, workspaceRuntimeId: NEXT_RUNTIME_ID }],
    })
    expect(refresh).toHaveBeenCalledOnce()
    expect(refresh).toHaveBeenCalledWith({ workspaceId: WORKSPACE_ID, workspaceRuntimeId: NEXT_RUNTIME_ID })
    expect(snapshot).toHaveBeenCalledOnce()
    expect(workspacesStore.getState().workspaces[WORKSPACE_ID]).toMatchObject({
      workspaceRuntimeId: NEXT_RUNTIME_ID,
      capability: { kind: 'git', probe: { status: 'ready' } },
    })
  })

  test('keeps the new membership authoritative but omits a stale Refresh target without retrying', async () => {
    const refresh = vi.fn(async (): Promise<WorkspaceRefreshResult> => ({ kind: 'stale-runtime' }))
    installGoblinTestBridge({
      'workspace.runtimeReconcile': async () => ({
        runtimes: [
          {
            workspaceId: WORKSPACE_ID,
            workspaceRuntimeId: NEXT_RUNTIME_ID,
            workspaceProbe: { status: 'probing' as const },
          },
        ],
      }),
      'workspace.refresh': refresh,
    })

    await expect(
      reconcileOpenWorkspaceRuntimeMemberships(workspacesStore.setState, workspacesStore.getState),
    ).resolves.toMatchObject({
      kind: 'settled',
      targets: [],
      changedTargets: [{ workspaceId: WORKSPACE_ID, workspaceRuntimeId: NEXT_RUNTIME_ID }],
    })
    expect(refresh).toHaveBeenCalledOnce()
    expect(workspacesStore.getState().workspaces[WORKSPACE_ID]).toMatchObject({
      workspaceRuntimeId: NEXT_RUNTIME_ID,
      capability: { kind: 'probing' },
    })
  })
})
