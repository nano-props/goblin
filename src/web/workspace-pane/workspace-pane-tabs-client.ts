import { getClientBridge } from '#/web/bridge/client.ts'
import type { ClientWorkspacePaneTabs } from '#/web/bridge/types.ts'

export type WorkspacePaneTabsClient = ClientWorkspacePaneTabs

function getWorkspacePaneTabsClient(): WorkspacePaneTabsClient {
  return getClientBridge().workspacePaneTabs()
}

// Workspace-pane tabs are a sibling app-realtime capability. They share the
// app realtime transport with terminal, but do not depend on terminal client
// ownership.
export const workspacePaneTabsClient: WorkspacePaneTabsClient = {
  list(input) {
    return getWorkspacePaneTabsClient().list(input)
  },
  update(input) {
    return getWorkspacePaneTabsClient().update(input)
  },
  onChanged(cb) {
    return getWorkspacePaneTabsClient().onChanged(cb)
  },
}
