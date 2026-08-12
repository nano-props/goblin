import { describe, expect, test, vi } from 'vitest'
import {
  createWorkspacePaneTabsRealtimeHandlers,
  handleWorkspacePaneTabsRealtimeRequestMessage,
} from '#/server/workspace-pane/workspace-pane-tabs-runtime-realtime.ts'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'
import { WORKSPACE_PANE_TABS_SOCKET_ACTIONS } from '#/shared/workspace-pane-tabs.ts'
import { formatWorkspaceLocator } from '#/shared/workspace-locator.ts'

const WORKSPACE_ID = formatWorkspaceLocator({ transport: 'file', platform: 'posix', path: '/repo' }, 'posix')!
const WORKSPACE_RUNTIME_ID = 'repo-runtime-test'
const TARGET = {
  kind: 'git-worktree' as const,
  workspaceId: WORKSPACE_ID,
  workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
  root: WORKSPACE_ID,
}

describe('createWorkspacePaneTabsRealtimeHandlers', () => {
  test('routes canonical workspace pane tab actions to workspace pane host methods', async () => {
    const emptySnapshot = { revision: 0, entries: [] }
    const projected = { kind: 'projected' as const, snapshot: emptySnapshot }
    const host = {
      listWorkspaceTabs: vi.fn(async () => emptySnapshot),
      updateTabs: vi.fn(async () => projected),
    } as unknown as ServerWorkspacePaneTabsHost
    const handlers = createWorkspacePaneTabsRealtimeHandlers(host)

    await expect(
      handlers[WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list]('client_a', 'user_a', {
        workspaceId: WORKSPACE_ID,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      }),
    ).resolves.toEqual(emptySnapshot)
    await expect(
      handlers[WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update]('client_a', 'user_a', {
        workspaceId: WORKSPACE_ID,
        workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
        target: TARGET,
        operation: { type: 'open-static', tabType: 'history' },
      }),
    ).resolves.toEqual(projected)

    expect(host.listWorkspaceTabs).toHaveBeenCalledWith('client_a', 'user_a', {
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
    })
    expect(host.updateTabs).toHaveBeenCalledWith('client_a', 'user_a', {
      workspaceId: WORKSPACE_ID,
      workspaceRuntimeId: WORKSPACE_RUNTIME_ID,
      target: TARGET,
      operation: { type: 'open-static', tabType: 'history' },
    })
  })

  test('notifies the transport when sending a response fails', async () => {
    const emptySnapshot = { revision: 0, entries: [] }
    const projected = { kind: 'projected' as const, snapshot: emptySnapshot }
    const handlers = {
      [WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list]: vi.fn(async () => emptySnapshot),
      [WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update]: vi.fn(async () => projected),
    }
    const socket = {
      send: vi.fn(() => {
        throw new Error('socket closed')
      }),
      close: vi.fn(),
    }
    const onSendFailed = vi.fn()

    await handleWorkspacePaneTabsRealtimeRequestMessage(
      handlers,
      'client_a',
      'user_a',
      socket,
      {
        type: 'request',
        requestId: 'request_1',
        action: WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list,
        input: { workspaceId: WORKSPACE_ID, workspaceRuntimeId: WORKSPACE_RUNTIME_ID },
      },
      onSendFailed,
    )

    expect(onSendFailed).toHaveBeenCalledTimes(1)
  })
})
