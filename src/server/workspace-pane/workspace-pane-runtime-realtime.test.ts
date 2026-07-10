import { describe, expect, test, vi } from 'vitest'
import {
  createWorkspacePaneRuntimeRealtimeHandlers,
  handleWorkspacePaneRuntimeRealtimeRequestMessage,
} from '#/server/workspace-pane/workspace-pane-runtime-realtime.ts'
import type { ServerWorkspacePaneRuntimeHost } from '#/server/workspace-pane/workspace-pane-runtime-host.ts'
import { WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS } from '#/shared/workspace-pane-runtime.ts'

const input = {
  runtimeType: 'terminal' as const,
  request: {
    repoRoot: '/repo',
    repoRuntimeId: 'repo-runtime-test',
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
    expect(openRuntime).toHaveBeenCalledWith('client_a', 'user_a', {
      ...input,
      request: { ...input.request, clientId: 'client_a' },
    })
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
      undefined,
    )

    expect(JSON.parse(socket.send.mock.calls[0]?.[0] ?? '')).toEqual({
      type: 'response',
      requestId: 'request_1',
      ok: false,
      action: WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open,
      error: 'runtime open failed',
    })
  })
})
