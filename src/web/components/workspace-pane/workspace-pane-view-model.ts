import type { WorkspacePaneViewSummary, TerminalSessionSummary } from '#/web/components/terminal/types.ts'
import type {
  WorkspacePaneBranchViewType,
  WorkspacePaneStaticViewType,
  WorkspacePaneWorktreeViewOrderEntry,
} from '#/shared/workspace-pane.ts'

export function workspacePaneViewIdentity(tab: WorkspacePaneViewSummary): string {
  return `${tab.type}:${tab.id}`
}

export function workspacePaneViewOrderEntry(tab: WorkspacePaneViewSummary): WorkspacePaneWorktreeViewOrderEntry {
  return { type: tab.type, id: tab.id }
}

export function terminalWorkspacePaneViewIdentity(sessionKey: string): string {
  return `terminal:${sessionKey}`
}

export function staticWorkspacePaneViewIdentity(
  type: WorkspacePaneBranchViewType | WorkspacePaneStaticViewType,
): string {
  return `${type}:${type}`
}

export function workspacePaneViewButtonId(workspacePaneId: string, index: number): string {
  return index <= 0 ? `${workspacePaneId}-workspace-pane-view` : `${workspacePaneId}-workspace-pane-view-${index}`
}

export function isTerminalWorkspacePaneView(tab: WorkspacePaneViewSummary): tab is TerminalSessionSummary {
  return tab.type === 'terminal'
}
