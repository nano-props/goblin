import { getClientBridge } from '#/web/bridge/client.ts'
import type { ClientWorkspacePaneRuntime } from '#/web/bridge/types.ts'

function getWorkspacePaneRuntimeClient(): ClientWorkspacePaneRuntime {
  return getClientBridge().workspacePaneRuntime()
}

export const workspacePaneRuntimeClient: ClientWorkspacePaneRuntime = {
  open(input) {
    return getWorkspacePaneRuntimeClient().open(input)
  },
  close(input) {
    return getWorkspacePaneRuntimeClient().close(input)
  },
}
