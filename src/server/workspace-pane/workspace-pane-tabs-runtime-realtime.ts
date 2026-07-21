import type { AppRealtimeResponseMessage } from '#/shared/app-realtime-socket.ts'
import {
  WORKSPACE_PANE_TABS_SOCKET_ACTIONS,
  type WorkspacePaneTabsSocketRequestInputs,
  type WorkspacePaneTabsSocketResponseOutputs,
} from '#/shared/workspace-pane-tabs.ts'
import type { RealtimeSocket } from '#/server/realtime/realtime-broker.ts'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'
import { invokeRealtimeRpcHandler, type RealtimeRpcHandlers } from '#/server/realtime/realtime-rpc-handlers.ts'
import type { RealtimeRpcRequestMessage } from '#/shared/realtime-rpc.ts'

export type WorkspacePaneTabsRealtimeRequestMessage = RealtimeRpcRequestMessage<WorkspacePaneTabsSocketRequestInputs>

export function createWorkspacePaneTabsRealtimeHandlers(
  host: ServerWorkspacePaneTabsHost,
): RealtimeRpcHandlers<WorkspacePaneTabsSocketRequestInputs, WorkspacePaneTabsSocketResponseOutputs> {
  return {
    [WORKSPACE_PANE_TABS_SOCKET_ACTIONS.list](clientId, userId, input) {
      return host.listWorkspaceTabs(clientId, userId, input)
    },
    [WORKSPACE_PANE_TABS_SOCKET_ACTIONS.replace](clientId, userId, input) {
      return host.replaceTabs(clientId, userId, input)
    },
    [WORKSPACE_PANE_TABS_SOCKET_ACTIONS.update](clientId, userId, input) {
      return host.updateTabs(clientId, userId, input)
    },
  }
}

export async function handleWorkspacePaneTabsRealtimeRequestMessage(
  handlers: RealtimeRpcHandlers<WorkspacePaneTabsSocketRequestInputs, WorkspacePaneTabsSocketResponseOutputs>,
  clientId: string,
  userId: string,
  socket: RealtimeSocket,
  message: WorkspacePaneTabsRealtimeRequestMessage,
  onSendFailed?: () => void,
): Promise<void> {
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
  try {
    socket.send(JSON.stringify(response))
  } catch {
    onSendFailed?.()
  }
}
