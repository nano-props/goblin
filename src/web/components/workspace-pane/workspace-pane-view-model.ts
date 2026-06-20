import type {
  WorkspacePaneViewSummary,
  TerminalSessionSummary,
} from '#/web/components/terminal/types.ts'
import type { WorkspacePaneViewOrderEntry } from '#/shared/workspace-pane.ts'

export function workspacePaneViewIdentity(tab: WorkspacePaneViewSummary): string {
  return `${tab.type}:${tab.id}`
}

export function workspacePaneViewOrderEntry(tab: WorkspacePaneViewSummary): WorkspacePaneViewOrderEntry {
  return { type: tab.type, id: tab.id }
}

export function terminalWorkspacePaneViewIdentity(sessionKey: string): string {
  return `terminal:${sessionKey}`
}

export function staticWorkspacePaneViewIdentity(type: 'status' | 'changes'): string {
  return `${type}:${type}`
}

export function workspacePaneViewButtonId(detailId: string, index: number): string {
  return index <= 0 ? `${detailId}-workspace-pane-view` : `${detailId}-workspace-pane-view-${index}`
}

export function activeWorkspacePaneViewIdentity(
  tabs: WorkspacePaneViewSummary[],
  activeType: WorkspacePaneViewSummary['type'],
): string | null {
  if (activeType === 'terminal') {
    const selectedTerminal = tabs.find(isSelectedTerminalWorkspacePaneView)
    return selectedTerminal ? workspacePaneViewIdentity(selectedTerminal) : null
  }
  const staticWorkspaceView = tabs.find((tab) => tab.type === activeType)
  return staticWorkspaceView ? workspacePaneViewIdentity(staticWorkspaceView) : null
}

export function adjacentWorkspacePaneView(
  tabs: WorkspacePaneViewSummary[],
  activeType: WorkspacePaneViewSummary['type'],
  direction: 1 | -1,
): WorkspacePaneViewSummary | null {
  if (tabs.length === 0) return null
  const activeIdentity = activeWorkspacePaneViewIdentity(tabs, activeType)
  const activeIndex = activeIdentity ? tabs.findIndex((tab) => workspacePaneViewIdentity(tab) === activeIdentity) : -1
  const nextIndex =
    activeIndex === -1 ? (direction === 1 ? 0 : tabs.length - 1) : (activeIndex + direction + tabs.length) % tabs.length
  return tabs[nextIndex] ?? null
}

export function nextWorkspacePaneViewAfterClose(
  tabs: WorkspacePaneViewSummary[],
  closingIdentity: string,
): WorkspacePaneViewSummary | null {
  const index = tabs.findIndex((tab) => workspacePaneViewIdentity(tab) === closingIdentity)
  if (index === -1) return tabs[0] ?? null
  return tabs[index + 1] ?? tabs[index - 1] ?? null
}

export function isTerminalWorkspacePaneView(tab: WorkspacePaneViewSummary): tab is TerminalSessionSummary {
  return tab.type === 'terminal'
}

function isSelectedTerminalWorkspacePaneView(tab: WorkspacePaneViewSummary): tab is TerminalSessionSummary {
  return isTerminalWorkspacePaneView(tab) && tab.selected
}
