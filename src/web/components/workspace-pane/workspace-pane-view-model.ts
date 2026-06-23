import type { WorkspacePaneViewSummary, TerminalSlotSummary } from '#/web/components/terminal/types.ts'
import type { WorkspacePaneBranchViewType, WorkspacePaneStaticViewType } from '#/shared/workspace-pane.ts'

export function workspacePaneViewIdentity(tab: WorkspacePaneViewSummary): string {
  return `${tab.type}:${tab.id}`
}

export function terminalWorkspacePaneViewIdentity(slotKey: string): string {
  return `terminal:${slotKey}`
}

export const PENDING_TERMINAL_WORKSPACE_PANE_VIEW_IDENTITY = 'terminal:pending'

export function staticWorkspacePaneViewIdentity(
  type: WorkspacePaneBranchViewType | WorkspacePaneStaticViewType,
): string {
  return `${type}:${type}`
}

export function workspacePaneViewButtonId(workspacePaneId: string, index: number): string {
  return index <= 0 ? `${workspacePaneId}-workspace-pane-view` : `${workspacePaneId}-workspace-pane-view-${index}`
}

export function isTerminalWorkspacePaneView(tab: WorkspacePaneViewSummary): tab is TerminalSlotSummary {
  return tab.type === 'terminal'
}
