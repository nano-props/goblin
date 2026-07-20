import { describe, expect, test, vi } from 'vitest'
import { defaultServerWorkspaceState } from '#/shared/settings-defaults.ts'
import type { RestoredWorkspaceRuntime } from '#/shared/api-types.ts'
import { projectWorkspacePaneTabsWithMembershipGuard } from '#/server/modules/workspace-pane-tabs-restore.ts'
import { createTestWorkspacePaneTabsHost } from '#/server/test-utils/workspace-pane-tabs-host.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace')

describe('workspace pane layout restore admission', () => {
  test('restores the workspace-root layout while the Git projection is deferred', async () => {
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()
    const confirmMembership = vi.fn(async () => ({
      matched: true as const,
      workspace: defaultServerWorkspaceState(),
    }))
    const workspace = {
      entry: { id: WORKSPACE_ID },
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'workspace-runtime-test',
      name: 'workspace',
      transport: { kind: 'file' as const },
      workspaceProbe: {
        status: 'ready' as const,
        name: 'workspace',
        capabilities: {
          files: { read: true as const, write: true },
          terminal: { available: true },
          git: { status: 'available' as const, worktrees: true, pullRequests: { provider: 'none' as const } },
        },
        diagnostics: [],
      },
      gitProjection: {
        snapshot: null,
        pullRequests: null,
        operations: { operations: [], loadedAt: 0 },
        requested: { branch: null, pullRequestMode: 'full' as const },
        loadedAt: 1,
      },
    } satisfies RestoredWorkspaceRuntime

    const result = await projectWorkspacePaneTabsWithMembershipGuard({
      restoreInput: {
        userId: 'user-test',
        clientId: 'client-test',
        workspacePaneTabsHost,
      },
      workspaces: [workspace],
      confirmMembership,
      membershipPolicy: 'confirm-after-restore',
    })

    expect(result).toEqual({
      matched: true,
      snapshots: [
        {
          workspaceId: WORKSPACE_ID,
          workspaceRuntimeId: 'workspace-runtime-test',
          snapshot: { revision: 0, entries: [] },
        },
      ],
      repaired: false,
    })
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledWith('user-test', {
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'workspace-runtime-test',
      expectedWorkspaceEntry: workspace.entry,
      targets: [{ kind: 'workspace-root' }],
    })
    expect(confirmMembership).toHaveBeenCalledOnce()
  })
})
