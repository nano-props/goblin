import { describe, expect, test, vi } from 'vitest'
import { WORKSPACE_PANE_TABS_SOCKET_ACTIONS } from '#/shared/workspace-pane-tabs.ts'
import type { ClientAppRealtime } from '#/web/app-realtime-client.ts'
import { createServerWorkspacePaneTabsClient } from '#/web/client-workspace-pane-tabs.ts'
import { formatWorkspaceLocator } from '#/shared/workspace-locator.ts'

const WORKSPACE_ID = formatWorkspaceLocator({ transport: 'file', platform: 'posix', path: '/repo' }, 'posix')!
const WORKTREE_ID = formatWorkspaceLocator({ transport: 'file', platform: 'posix', path: '/repo/worktree' }, 'posix')!

describe('createServerWorkspacePaneTabsClient', () => {
  test('returns the canonical snapshot for list', async () => {
    const snapshot = { revision: 7, entries: [] }
    const request = vi.fn(async () => snapshot)
    const client = createServerWorkspacePaneTabsClient(realtimeWithRequest(request))
    const common = { workspaceId: WORKSPACE_ID, workspaceRuntimeId: 'repo-runtime-test' }
    await expect(client.list(common)).resolves.toEqual(snapshot)
    expect(request).toHaveBeenCalledWith(WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list, common)
  })

  test('preserves the update write outcome', async () => {
    const outcome = { kind: 'committed-projection-failed' as const }
    const request = vi.fn(async () => outcome)
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
      operation: { type: 'open-static' as const, tabType: 'status' as const },
    }

    await expect(client.update(input)).resolves.toEqual(outcome)
    expect(request).toHaveBeenCalledWith(WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update, input)
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
