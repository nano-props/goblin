import type { AppRealtimeResponseMessage } from '#/shared/app-realtime-socket.ts'
import {
  WORKSPACE_PANE_TABS_SOCKET_ACTIONS,
  type WorkspacePaneTabsSocketAction,
  type WorkspacePaneTabsSocketRequestInputs,
  type WorkspacePaneTabsSocketResponseOutputs,
} from '#/shared/workspace-pane-tabs.ts'
import type { RealtimeSocket } from '#/server/realtime/realtime-broker.ts'
import type { ServerWorkspacePaneTabsHost } from '#/server/workspace-pane/workspace-pane-tabs-host.ts'

type MaybePromise<T> = T | Promise<T>

export type WorkspacePaneTabsRealtimeRequestMessage = {
  [TAction in WorkspacePaneTabsSocketAction]: {
    type: 'request'
    requestId: string
    action: TAction
    input: WorkspacePaneTabsSocketRequestInputs[TAction]
  }
}[WorkspacePaneTabsSocketAction]

export function createWorkspacePaneTabsRealtimeHandlers(host: ServerWorkspacePaneTabsHost): {
  [TAction in WorkspacePaneTabsSocketAction]: (
    clientId: string,
    userId: string,
    input: WorkspacePaneTabsSocketRequestInputs[TAction],
  ) => MaybePromise<WorkspacePaneTabsSocketResponseOutputs[TAction]>
} {
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
  handlers: {
    [TAction in WorkspacePaneTabsSocketAction]: (
      clientId: string,
      userId: string,
      input: WorkspacePaneTabsSocketRequestInputs[TAction],
    ) => MaybePromise<WorkspacePaneTabsSocketResponseOutputs[TAction]>
  },
  clientId: string,
  userId: string,
  socket: RealtimeSocket,
  message: WorkspacePaneTabsRealtimeRequestMessage,
  onSendFailed?: () => void,
): Promise<void> {
  let response: AppRealtimeResponseMessage
  try {
    const handler = handlers[message.action] as (
      clientId: string,
      userId: string,
      input: WorkspacePaneTabsSocketRequestInputs[typeof message.action],
    ) => MaybePromise<WorkspacePaneTabsSocketResponseOutputs[typeof message.action]>
    const payload = await handler(clientId, userId, message.input)
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
