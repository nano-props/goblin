import type { AppRealtimeResponseMessage } from '#/shared/app-realtime-socket.ts'
import {
  WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS,
  type WorkspacePaneRuntimeSocketAction,
  type WorkspacePaneRuntimeSocketRequestInputs,
  type WorkspacePaneRuntimeSocketResponseOutputs,
} from '#/shared/workspace-pane-runtime.ts'
import type { RealtimeSocket } from '#/server/realtime/realtime-broker.ts'
import type { ServerWorkspacePaneRuntimeHost } from '#/server/workspace-pane/workspace-pane-runtime-host.ts'
import type { BufferedAppRealtimeSocket } from '#/server/realtime/buffered-app-realtime-socket.ts'

type MaybePromise<T> = T | Promise<T>

export type WorkspacePaneRuntimeRealtimeRequestMessage = {
  [TAction in WorkspacePaneRuntimeSocketAction]: {
    type: 'request'
    requestId: string
    action: TAction
    input: WorkspacePaneRuntimeSocketRequestInputs[TAction]
  }
}[WorkspacePaneRuntimeSocketAction]

export function createWorkspacePaneRuntimeRealtimeHandlers(host: ServerWorkspacePaneRuntimeHost): {
  [TAction in WorkspacePaneRuntimeSocketAction]: (
    clientId: string,
    userId: string,
    input: WorkspacePaneRuntimeSocketRequestInputs[TAction],
  ) => MaybePromise<WorkspacePaneRuntimeSocketResponseOutputs[TAction]>
} {
  return {
    [WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open](clientId, userId, input) {
      return host.openRuntime(clientId, userId, bindRuntimeProviderClientId(input, clientId))
    },
    [WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close](clientId, userId, input) {
      return host.closeRuntime(clientId, userId, input)
    },
  }
}

function bindRuntimeProviderClientId(
  input: WorkspacePaneRuntimeSocketRequestInputs['workspace-pane-runtime.open'],
  clientId: string,
): WorkspacePaneRuntimeSocketRequestInputs['workspace-pane-runtime.open'] {
  switch (input.runtimeType) {
    case 'terminal':
      return { ...input, request: { ...input.request, clientId } }
  }
}

export async function handleWorkspacePaneRuntimeRealtimeRequestMessage(
  handlers: {
    [TAction in WorkspacePaneRuntimeSocketAction]: (
      clientId: string,
      userId: string,
      input: WorkspacePaneRuntimeSocketRequestInputs[TAction],
    ) => MaybePromise<WorkspacePaneRuntimeSocketResponseOutputs[TAction]>
  },
  clientId: string,
  userId: string,
  socket: RealtimeSocket,
  message: WorkspacePaneRuntimeRealtimeRequestMessage,
  bufferedSocket?: BufferedAppRealtimeSocket,
): Promise<void> {
  let response: AppRealtimeResponseMessage
  try {
    const handler = handlers[message.action] as (
      clientId: string,
      userId: string,
      input: WorkspacePaneRuntimeSocketRequestInputs[typeof message.action],
    ) => MaybePromise<WorkspacePaneRuntimeSocketResponseOutputs[typeof message.action]>
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
    bufferedSocket?.deactivate()
  }
  // Runtime open now commits terminal metadata only. A newly prepared
  // terminal has no PTY output yet, while output from a reused live terminal
  // must all remain observable because this response carries no snapshot
  // checkpoint that could subsume it.
  bufferedSocket?.resume(null)
}
