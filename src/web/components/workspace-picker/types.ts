import type { RemoteWorkspaceConnectionLifecycle } from '#/shared/remote-workspace.ts'
import type { WorkspaceId } from '#/shared/workspace-locator.ts'
export interface WorkspacePickerItem {
  id: WorkspaceId
  name: string
  gitAvailable: boolean
  /** Unread terminal bell count across this workspace's terminal sessions. */
  terminalBellCount?: number
  lifecycle: RemoteWorkspaceConnectionLifecycle | null
}

export interface WorkspacePickerLabels {
  workspaces: string
  filter: string
  filterStatus: string
  close: string
  moveFirst: string
  moveLast: string
  open: string
  openLocal: string
  openRemote: string
  clone: string
  unavailable: string
}
