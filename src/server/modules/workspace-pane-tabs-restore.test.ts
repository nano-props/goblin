import { describe, expect, test, vi } from 'vitest'
import { defaultServerWorkspaceState } from '#/shared/settings-defaults.ts'
import type { RestoredWorkspaceRuntime } from '#/shared/api-types.ts'
import { restoreWorkspacePaneTabsForMemberships } from '#/server/modules/workspace-pane-tabs-restore.ts'
import { createTestWorkspacePaneTabsHost } from '#/server/test-utils/workspace-pane-tabs-host.ts'
import { testWorkspaceRuntimeEpochCapability } from '#/server/test-utils/workspace-runtime-capability.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace')
const runtimeCapability = {
  ...testWorkspaceRuntimeEpochCapability({
    userId: 'user-test',
    workspaceId: WORKSPACE_ID,
    workspaceRuntimeId: 'workspace-runtime-test',
  }),
  clientId: 'client-test',
  generation: 1,
}

describe('workspace pane layout restore admission', () => {
  test('restores the workspace-root layout when the Git snapshot is unavailable', async () => {
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()
    const confirmMembership = vi.fn(async () => ({
      matched: true as const,
      workspace: defaultServerWorkspaceState(),
    }))
    const workspace = {
      entry: { id: WORKSPACE_ID },
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'workspace-runtime-test',
      transport: { kind: 'file' as const },
      workspaceProbe: {
        status: 'ready' as const,
        capabilities: {
          files: { read: true as const, write: true },
          terminal: { available: true },
          git: { status: 'available' as const, worktrees: true, pullRequests: { provider: 'none' as const } },
        },
        diagnostics: [],
      },
      repoSnapshot: null,
    } satisfies RestoredWorkspaceRuntime

    const result = await restoreWorkspacePaneTabsForMemberships({
      restoreInput: {
        userId: 'user-test',
        clientId: 'client-test',
        workspacePaneTabsHost,
      },
      workspaces: [{ ...workspace, runtimeCapability }],
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
    expect(workspacePaneTabsHost.restoreTabs).toHaveBeenCalledWith(
      'user-test',
      {
        workspaceId: WORKSPACE_ID,
        workspaceRuntimeId: 'workspace-runtime-test',
        expectedWorkspaceEntry: workspace.entry,
        targets: [{ kind: 'workspace-root' }],
      },
      runtimeCapability,
    )
    expect(confirmMembership).toHaveBeenCalledOnce()
  })
})
