import type { AppRealtimeResponseMessage } from '#/shared/app-realtime-socket.ts'
import {
  WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS,
  type WorkspacePaneRuntimeSocketRequestInputs,
  type WorkspacePaneRuntimeSocketResponseOutputs,
} from '#/shared/workspace-pane-runtime.ts'
import type { RealtimeSocket } from '#/server/realtime/realtime-broker.ts'
import type { ServerWorkspacePaneRuntimeHost } from '#/server/workspace-pane/workspace-pane-runtime-host.ts'
import { invokeRealtimeRpcHandler, type RealtimeRpcHandlers } from '#/server/realtime/realtime-rpc-handlers.ts'
import type { RealtimeRpcRequestMessage } from '#/shared/realtime-rpc.ts'

export type WorkspacePaneRuntimeRealtimeRequestMessage =
  RealtimeRpcRequestMessage<WorkspacePaneRuntimeSocketRequestInputs>

export function createWorkspacePaneRuntimeRealtimeHandlers(
  host: ServerWorkspacePaneRuntimeHost,
): RealtimeRpcHandlers<WorkspacePaneRuntimeSocketRequestInputs, WorkspacePaneRuntimeSocketResponseOutputs> {
  return {
    [WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open](clientId, userId, input) {
      return host.openRuntime(clientId, userId, input)
    },
    [WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close](clientId, userId, input) {
      return host.closeRuntime(clientId, userId, input)
    },
  }
}

export async function handleWorkspacePaneRuntimeRealtimeRequestMessage(
  handlers: RealtimeRpcHandlers<WorkspacePaneRuntimeSocketRequestInputs, WorkspacePaneRuntimeSocketResponseOutputs>,
  clientId: string,
  userId: string,
  socket: RealtimeSocket,
  message: WorkspacePaneRuntimeRealtimeRequestMessage,
): Promise<null> {
  let response: AppRealtimeResponseMessage
  try {
    const payload = await invokeRealtimeRpcHandler(handlers, clientId, userId, message.action, message.input)
    response = {
      type: 'response',
      requestId: message.requestId,
      ok: true,
      action: message.action,
      payload,
    } as AppRealtimeResponseMessage
  } catch (error) {
    response = {
      type: 'response',
      requestId: message.requestId,
      ok: false,
      action: message.action,
      error: error instanceof Error ? error.message : String(error),
    } as AppRealtimeResponseMessage
  }
  socket.send(JSON.stringify(response))
  return null
}
