import { describe, expect, test, vi } from 'vitest'
import { defaultServerWorkspaceState } from '#/shared/settings-defaults.ts'
import type { RestoredWorkspaceRuntime } from '#/shared/api-types.ts'
import { projectWorkspacePaneTabsWithMembershipGuard } from '#/server/modules/workspace-pane-tabs-restore.ts'
import { createTestWorkspacePaneTabsHost } from '#/server/test-utils/workspace-pane-tabs-host.ts'
import { workspaceIdForTest } from '#/test-utils/workspace-id.ts'

const WORKSPACE_ID = workspaceIdForTest('goblin+file:///workspace')

describe('workspace pane layout restore admission', () => {
  test('defers a projection envelope without an authoritative snapshot', async () => {
    const workspacePaneTabsHost = createTestWorkspacePaneTabsHost()
    const confirmMembership = vi.fn(async () => ({
      matched: true as const,
      workspace: defaultServerWorkspaceState(),
    }))
    const workspace = {
      entry: { kind: 'local' as const, id: WORKSPACE_ID },
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: 'workspace-runtime-test',
      name: 'workspace',
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
      projection: {
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

    expect(result).toEqual({ matched: true, snapshots: [], repaired: false })
    expect(workspacePaneTabsHost.restoreTabs).not.toHaveBeenCalled()
    expect(confirmMembership).toHaveBeenCalledOnce()
  })
})
