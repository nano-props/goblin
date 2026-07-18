import { WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS } from '#/shared/workspace-pane-runtime.ts'
import {
  normalizeWorkspacePaneRuntimeCloseResult,
  normalizeWorkspacePaneRuntimeOpenResult,
} from '#/shared/workspace-pane-runtime-validators.ts'
import type { ClientAppRealtime } from '#/web/app-realtime-client.ts'
import type { ClientWorkspacePaneRuntime } from '#/web/client-bridge-types.ts'

export function createServerWorkspacePaneRuntimeClient(realtime: ClientAppRealtime): ClientWorkspacePaneRuntime {
  return {
    open(input) {
      return realtime.request(WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.open, input).then((value) => {
        const result = normalizeWorkspacePaneRuntimeOpenResult(value, input.request.target)
        if (!result) throw new Error('Workspace pane runtime socket response failed: invalid open response')
        return result
      })
    },
    close(input) {
      return realtime.request(WORKSPACE_PANE_RUNTIME_SOCKET_ACTIONS.close, input).then((value) => {
        const result = normalizeWorkspacePaneRuntimeCloseResult(value)
        if (!result) throw new Error('Workspace pane runtime socket response failed: invalid close response')
        return result
      })
    },
  }
}
