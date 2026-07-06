import { describe, expect, test, vi } from 'vitest'
import { createTerminalRealtimeHandlers, shouldPauseRealtimeRequest } from '#/server/terminal/terminal-runtime-realtime.ts'
import type { ServerTerminalHost } from '#/server/terminal/terminal-host.ts'
import { WORKSPACE_PANE_TABS_SOCKET_ACTIONS } from '#/shared/workspace-pane-tabs.ts'

describe('createTerminalRealtimeHandlers', () => {
  test('pauses every authoritative terminal frame request, including takeover', () => {
    expect(shouldPauseRealtimeRequest('attach')).toBe(true)
    expect(shouldPauseRealtimeRequest('restart')).toBe(true)
    expect(shouldPauseRealtimeRequest('create')).toBe(true)
    expect(shouldPauseRealtimeRequest('takeover')).toBe(true)
    expect(shouldPauseRealtimeRequest('resize')).toBe(false)
  })

  test('routes canonical workspace pane tab actions to workspace pane host methods', async () => {
    const host = {
      listWorkspaceTabs: vi.fn(async () => []),
      replaceTabs: vi.fn(async (_clientId: string, _userId: string, input: { tabs: unknown[] }) => input.tabs),
      updateTabs: vi.fn(async () => []),
    } as unknown as ServerTerminalHost
    const handlers = createTerminalRealtimeHandlers(host)

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

  test('only routes canonical workspace tab socket actions', async () => {
    const host = {
      listWorkspaceTabs: vi.fn(async () => []),
      replaceTabs: vi.fn(async () => []),
      updateTabs: vi.fn(async () => []),
    } as unknown as ServerTerminalHost
    const handlers = createTerminalRealtimeHandlers(host)

    await handlers[WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list]('client_a', 'user_a', {
      repoRoot: '/repo',
      repoInstanceId: 'repo-instance-test',
    })
    await handlers[WORKSPACE_PANE_TABS_SOCKET_ACTIONS.replace]('client_a', 'user_a', {
      repoRoot: '/repo',
      repoInstanceId: 'repo-instance-test',
      branchName: 'main',
      worktreePath: '/repo',
      tabs: [],
    })
    await handlers[WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update]('client_a', 'user_a', {
      repoRoot: '/repo',
      repoInstanceId: 'repo-instance-test',
      branchName: 'main',
      worktreePath: '/repo',
      operation: { type: 'open-static', tabType: 'history' },
    })

    expect(host.listWorkspaceTabs).toHaveBeenCalledTimes(1)
    expect(host.replaceTabs).toHaveBeenCalledTimes(1)
    expect(host.updateTabs).toHaveBeenCalledTimes(1)
  })
})
