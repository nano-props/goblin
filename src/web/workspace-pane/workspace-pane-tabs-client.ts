import { getClientBridge } from '#/web/client-bridge.ts'
import type { ClientWorkspacePaneTabs } from '#/web/client-bridge-types.ts'

export type WorkspacePaneTabsClient = ClientWorkspacePaneTabs

function getWorkspacePaneTabsClient(): WorkspacePaneTabsClient {
  return getClientBridge().workspacePaneTabs()
}

// The current server transport for workspace-pane tabs still rides over the
// existing realtime socket, but callers depend on this workspace-pane API
// instead of importing the terminal client directly.
export const workspacePaneTabsClient: WorkspacePaneTabsClient = {
  list(input) {
    return getWorkspacePaneTabsClient().list(input)
  },
  replace(input) {
    return getWorkspacePaneTabsClient().replace(input)
  },
  update(input) {
    return getWorkspacePaneTabsClient().update(input)
  },
  onChanged(cb) {
    return getWorkspacePaneTabsClient().onChanged(cb)
  },
}
