import { getClientBridge } from '#/web/client-bridge.ts'
import type { ClientWorkspacePaneRuntime } from '#/web/client-bridge-types.ts'

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
  closeWorktree(input) {
    return getWorkspacePaneRuntimeClient().closeWorktree(input)
  },
}
