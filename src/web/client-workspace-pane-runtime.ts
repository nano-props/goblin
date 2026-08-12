import { WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS } from '#/shared/workspace-pane-runtime.ts'
import {
  workspacePaneRuntimeCloseResultMatchesRequest,
  workspacePaneRuntimeOpenResultMatchesRequest,
} from '#/shared/workspace-pane-runtime-validators.ts'
import type { ClientAppRealtime } from '#/web/app-realtime-client.ts'
import type { ClientWorkspacePaneRuntime } from '#/web/client-bridge-types.ts'
import { ClientRealtimeRequestError } from '#/web/realtime/client-realtime-request-error.ts'

function indeterminateInvalidResponse(message: string): ClientRealtimeRequestError {
  return new ClientRealtimeRequestError(message, {
    kind: 'invalid-response',
    delivery: 'indeterminate',
    outageId: null,
  })
}

export function createServerWorkspacePaneRuntimeClient(realtime: ClientAppRealtime): ClientWorkspacePaneRuntime {
  return {
    open(input) {
      return realtime.request(WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open, input).then((result) => {
        if (!workspacePaneRuntimeOpenResultMatchesRequest(result, input.request.target)) {
          throw indeterminateInvalidResponse('Workspace pane runtime socket response failed: invalid open response')
        }
        return result
      })
    },
    close(input) {
      return realtime.request(WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close, input).then((result) => {
        if (!workspacePaneRuntimeCloseResultMatchesRequest(result, input.sessionId)) {
          throw indeterminateInvalidResponse('Workspace pane runtime socket response failed: invalid close response')
        }
        return result
      })
    },
  }
}
