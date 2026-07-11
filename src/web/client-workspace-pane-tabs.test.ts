import { describe, expect, test, vi } from 'vitest'
import { WORKSPACE_PANE_TABS_SOCKET_ACTIONS } from '#/shared/workspace-pane-tabs.ts'
import type { ClientAppRealtime } from '#/web/app-realtime-client.ts'
import { createServerWorkspacePaneTabsClient } from '#/web/client-workspace-pane-tabs.ts'

describe('createServerWorkspacePaneTabsClient', () => {
  test.each([
    WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
    WORKSPACE_PANE_TABS_SOCKET_ACTIONS.replace,
    WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update,
  ] as const)('returns the canonical snapshot for %s', async (action) => {
    const snapshot = { revision: 7, entries: [] }
    const request = vi.fn(async () => snapshot)
    const client = createServerWorkspacePaneTabsClient(realtimeWithRequest(request))
    const common = { repoRoot: '/repo', repoRuntimeId: 'repo-runtime-test' }
    const input = {
      ...common,
      branchName: 'main',
      worktreePath: '/repo/worktree',
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

    await expect(client.list({ repoRoot: '/repo', repoRuntimeId: 'repo-runtime-test' })).rejects.toThrow(
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
