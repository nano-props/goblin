import { describe, expect, test, vi } from 'vitest'
import { createWorkspacePaneTabsRealtimeHandlers } from '#/server/workspace-pane/workspace-pane-tabs-runtime-realtime.ts'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'
import { WORKSPACE_PANE_TABS_SOCKET_ACTIONS } from '#/shared/workspace-pane-tabs.ts'

describe('createWorkspacePaneTabsRealtimeHandlers', () => {
  test('routes canonical workspace pane tab actions to workspace pane host methods', async () => {
    const host = {
      listWorkspaceTabs: vi.fn(async () => []),
      replaceTabs: vi.fn(async (_clientId: string, _userId: string, input: { tabs: unknown[] }) => input.tabs),
      updateTabs: vi.fn(async () => []),
    } as unknown as ServerWorkspacePaneTabsHost
    const handlers = createWorkspacePaneTabsRealtimeHandlers(host)

    await expect(
      handlers[WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list]('client_a', 'user_a', {
        repoRoot: '/repo',
        repoInstanceId: 'repo-instance-test',
      }),
    ).resolves.toEqual([])
    await expect(
      handlers[WORKSPACE_PANE_TABS_SOCKET_ACTIONS.replace]('client_a', 'user_a', {
        repoRoot: '/repo',
        repoInstanceId: 'repo-instance-test',
        branchName: 'main',
        worktreePath: '/repo',
        tabs: [{ type: 'status', tabId: 'workspace-pane:status' }],
      }),
    ).resolves.toEqual([{ type: 'status', tabId: 'workspace-pane:status' }])
    await expect(
      handlers[WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update]('client_a', 'user_a', {
        repoRoot: '/repo',
        repoInstanceId: 'repo-instance-test',
        branchName: 'main',
        worktreePath: '/repo',
        operation: { type: 'open-static', tabType: 'history' },
      }),
    ).resolves.toEqual([])

    expect(host.listWorkspaceTabs).toHaveBeenCalledWith('client_a', 'user_a', {
      repoRoot: '/repo',
      repoInstanceId: 'repo-instance-test',
    })
    expect(host.replaceTabs).toHaveBeenCalledWith('client_a', 'user_a', {
      repoRoot: '/repo',
      repoInstanceId: 'repo-instance-test',
      branchName: 'main',
      worktreePath: '/repo',
      tabs: [{ type: 'status', tabId: 'workspace-pane:status' }],
    })
    expect(host.updateTabs).toHaveBeenCalledWith('client_a', 'user_a', {
      repoRoot: '/repo',
      repoInstanceId: 'repo-instance-test',
      branchName: 'main',
      worktreePath: '/repo',
      operation: { type: 'open-static', tabType: 'history' },
    })
  })
})
