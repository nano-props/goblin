import { describe, expect, test, vi } from 'vitest'
import {
  createWorkspacePaneRuntimeRealtimeHandlers,
  handleWorkspacePaneRuntimeRealtimeRequestMessage,
} from '#/server/workspace-pane/workspace-pane-runtime-realtime.ts'
import type { ServerWorkspacePaneRuntimeHost } from '#/server/workspace-pane/workspace-pane-runtime-host.ts'
import { WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS } from '#/shared/workspace-pane-runtime.ts'
import { canonicalWorkspaceLocator } from '#/shared/workspace-locator.ts'
import { BufferedAppRealtimeSocket } from '#/server/realtime/buffered-app-realtime-socket.ts'

const workspaceId = canonicalWorkspaceLocator('goblin+file:///repo')
const worktreeRoot = canonicalWorkspaceLocator('goblin+file:///repo/worktree')
if (!workspaceId || !worktreeRoot) throw new Error('invalid workspace locator fixture')

const input = {
  runtimeType: 'terminal' as const,
  request: {
    workspaceId: '/repo',
    workspaceRuntimeId: 'repo-runtime-test',
    target: { kind: 'git-worktree' as const, workspaceId, workspaceRuntimeId: 'repo-runtime-test', root: worktreeRoot },
    branch: 'main',
    worktreePath: '/repo/worktree',
    kind: 'primary' as const,
  },
}

describe('workspace pane runtime realtime', () => {
  test('routes the application action to the runtime host', async () => {
    const openRuntime = vi.fn(async () => ({
      ok: false as const,
      runtimeType: 'terminal' as const,
      message: 'unavailable',
    }))
    const handlers = createWorkspacePaneRuntimeRealtimeHandlers({
      openRuntime,
      closeRuntime: vi.fn(),
    } satisfies ServerWorkspacePaneRuntimeHost)

    await expect(handlers[WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open]('client_a', 'user_a', input)).resolves.toEqual({
      ok: false,
      runtimeType: 'terminal',
      message: 'unavailable',
    })
    expect(openRuntime).toHaveBeenCalledWith('client_a', 'user_a', input)
  })

  test('serializes handler failures into the application response envelope', async () => {
    const socket = { send: vi.fn(), close: vi.fn() }
    await handleWorkspacePaneRuntimeRealtimeRequestMessage(
      {
        [WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open]: async () => {
          throw new Error('runtime open failed')
        },
        [WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close]: vi.fn(),
      },
      'client_a',
      'user_a',
      socket,
      {
        type: 'request',
        requestId: 'request_1',
        action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
        input,
      },
    )

    expect(JSON.parse(socket.send.mock.calls[0]?.[0] ?? '')).toEqual({
      type: 'response',
      requestId: 'request_1',
      ok: false,
      action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
      error: 'runtime open failed',
    })
  })

  test('sends the open response before flushing committed realtime effects', async () => {
    const socket = { send: vi.fn(), close: vi.fn() }
    const buffered = new BufferedAppRealtimeSocket(socket)
    buffered.enqueueTransition(() =>
      handleWorkspacePaneRuntimeRealtimeRequestMessage(
        {
          [WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open]: async () => {
            buffered.send(
              JSON.stringify({
                type: 'sessions-changed',
                workspaceId: workspaceId,
                workspaceRuntimeId: 'repo-runtime-test',
                revision: 1,
              }),
            )
            return { ok: false as const, runtimeType: 'terminal' as const, message: 'unavailable' }
          },
          [WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close]: vi.fn(),
        },
        'client_a',
        'user_a',
        socket,
        {
          type: 'request',
          requestId: 'request_order',
          action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
          input,
        },
      ),
    )
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(2))

    expect(JSON.parse(socket.send.mock.calls[0]?.[0] ?? '')).toMatchObject({
      type: 'response',
      requestId: 'request_order',
    })
    expect(JSON.parse(socket.send.mock.calls[1]?.[0] ?? '')).toEqual({
      type: 'sessions-changed',
      workspaceId: workspaceId,
      workspaceRuntimeId: 'repo-runtime-test',
      revision: 1,
    })
    expect(socket.send).toHaveBeenCalledTimes(2)
  })
})
