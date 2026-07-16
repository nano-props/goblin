import { describe, expect, test, vi } from 'vitest'
import { WORKSPACE_PANE_TABS_SOCKET_ACTIONS } from '#/shared/workspace-pane-tabs.ts'
import type { ClientAppRealtime } from '#/web/app-realtime-client.ts'
import { createServerWorkspacePaneTabsClient } from '#/web/client-workspace-pane-tabs.ts'
import { formatWorkspaceLocator } from '#/shared/workspace-locator.ts'

const WORKSPACE_ID = formatWorkspaceLocator({ transport: 'file', platform: 'posix', path: '/repo' }, 'posix')!
const WORKTREE_ID = formatWorkspaceLocator({ transport: 'file', platform: 'posix', path: '/repo/worktree' }, 'posix')!

describe('createServerWorkspacePaneTabsClient', () => {
  test.each([
    WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
    WORKSPACE_PANE_TABS_SOCKET_ACTIONS.replace,
    WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update,
  ] as const)('returns the canonical snapshot for %s', async (action) => {
    const snapshot = { revision: 7, entries: [] }
    const request = vi.fn(async () => snapshot)
    const client = createServerWorkspacePaneTabsClient(realtimeWithRequest(request))
    const common = { workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'repo-runtime-test' }
    const input = {
      ...common,
      target: {
        kind: 'git-worktree' as const,
        workspaceId: WORKSPACE_ID,
        workspaceRuntimeId: common.workspaceRuntimeId,
        root: WORKTREE_ID,
      },
    }
    const requestInput =
      action === WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list
        ? common
        : action === WORKSPACE_PANE_TABS_SOCKET_ACTIONS.replace
          ? { ...input, tabs: [] }
          : { ...input, operation: { type: 'open-static' as const, tabType: 'status' as const } }
    const result =
      action === WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list
        ? client.list(common)
        : action === WORKSPACE_PANE_TABS_SOCKET_ACTIONS.replace
          ? client.replace({ ...input, tabs: [] })
          : client.update({ ...input, operation: { type: 'open-static', tabType: 'status' } })

    await expect(result).resolves.toEqual(snapshot)
    expect(request).toHaveBeenCalledWith(action, requestInput)
  })

  test('rejects a legacy entry array without a snapshot revision', async () => {
    const client = createServerWorkspacePaneTabsClient(realtimeWithRequest(vi.fn(async () => [])))

    await expect(client.list({ workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'repo-runtime-test' })).rejects.toThrow(
      'invalid list response',
    )
  })
})

function realtimeWithRequest(request: (...args: any[]) => Promise<any>): ClientAppRealtime {
  return {
    request,
    kickReconnect: () => {},
    onMessage: () => () => {},
    onRecovered: () => () => {},
  } as ClientAppRealtime
}
